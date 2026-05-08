// Game state management and Spixi messaging protocol

const PHASE = { LOBBY: 'lobby', PREFLOP: 'preflop', FLOP: 'flop', TURN: 'turn', RIVER: 'river', SHOWDOWN: 'showdown' };
const ACTION = { FOLD: 'fold', CHECK: 'check', CALL: 'call', RAISE: 'raise', ALL_IN: 'allin' };
const MSG = {
    JOIN: 'join', START: 'start', HOLE_CARDS: 'hole_cards', COMMUNITY: 'community',
    ACTION_REQ: 'action_req', PLAYER_ACTION: 'player_action', STATE: 'state',
    SHOWDOWN_REVEAL: 'showdown_reveal', RESULT: 'result', NEW_ROUND: 'new_round', CHAT: 'chat'
};

const STARTING_STACK = 1000;
const SMALL_BLIND = 10;
const BIG_BLIND = 20;

const GameProtocol = {
    // Local state
    myAddress: null,
    sessionId: null,
    allAddresses: [],   // all players (sorted)
    isHost: false,

    // Game state (host maintains authoritative version, others sync from updates)
    phase: PHASE.LOBBY,
    players: {},        // addr -> { name, stack, bet, folded, allIn, seatIndex }
    dealerIndex: 0,
    pot: 0,
    communityCards: [],
    myHoleCards: [],
    revealedHands: {},  // addr -> cards (for showdown)
    currentTurnAddr: null,
    lastRaiseAddr: null,
    deck: [],           // only host uses this
    actionOrder: [],    // addresses in betting order this round
    actionIndex: 0,
    roundBet: 0,        // current round's highest bet

    init(sessionId, myAddress, remoteAddresses) {
        this.sessionId = sessionId;
        this.myAddress = myAddress;
        this.allAddresses = [myAddress, ...remoteAddresses].sort();
        this.isHost = this.allAddresses[0] === myAddress;

        for (const addr of this.allAddresses) {
            this.players[addr] = {
                name: this._shortAddr(addr),
                stack: STARTING_STACK,
                bet: 0,
                folded: false,
                allIn: false,
                seatIndex: this.allAddresses.indexOf(addr),
                connected: true
            };
        }

        // Announce join
        this._send({ type: MSG.JOIN, address: myAddress, name: this.players[myAddress].name });
    },

    // Host starts the game
    startGame() {
        if (!this.isHost) return;
        this.dealerIndex = 0;
        this._startRound();
    },

    _startRound() {
        this.phase = PHASE.PREFLOP;
        this.pot = 0;
        this.communityCards = [];
        this.revealedHands = {};
        this.deck = PokerEngine.shuffle(PokerEngine.createDeck());

        // Reset player states
        const activePlayers = this._activePlayers();
        for (const addr of activePlayers) {
            this.players[addr].bet = 0;
            this.players[addr].folded = false;
            this.players[addr].allIn = false;
        }

        const sbIndex = (this.dealerIndex + 1) % activePlayers.length;
        const bbIndex = (this.dealerIndex + 2) % activePlayers.length;
        const sbAddr = activePlayers[sbIndex];
        const bbAddr = activePlayers[bbIndex];

        this._placeBet(sbAddr, SMALL_BLIND);
        this._placeBet(bbAddr, BIG_BLIND);
        this.roundBet = BIG_BLIND;

        // Deal hole cards privately
        for (const addr of activePlayers) {
            const cards = [this.deck.pop(), this.deck.pop()];
            if (addr === this.myAddress) {
                this.myHoleCards = cards;
            }
            const payload = JSON.stringify({ type: MSG.HOLE_CARDS, cards });
            SpixiAppSdk.sendNetworkData(payload, addr);
        }

        // Broadcast game start state
        const stacks = {};
        for (const addr of activePlayers) { stacks[addr] = this.players[addr].stack; }
        const bets = {};
        for (const addr of activePlayers) { bets[addr] = this.players[addr].bet; }

        this._broadcast({
            type: MSG.START,
            dealer: activePlayers[this.dealerIndex],
            sb: sbAddr,
            bb: bbAddr,
            players: activePlayers,
            stacks,
            bets,
            pot: this.pot
        });

        // Betting order starts left of BB
        this.actionOrder = this._bettingOrder(activePlayers, (bbIndex + 1) % activePlayers.length);
        this.actionIndex = 0;
        this.lastRaiseAddr = bbAddr;
        this._requestNextAction();
    },

    _requestNextAction() {
        const addr = this._nextActiveInOrder();
        if (!addr) {
            this._advancePhase();
            return;
        }
        this.currentTurnAddr = addr;
        const callAmount = this.roundBet - (this.players[addr]?.bet || 0);
        this._broadcast({
            type: MSG.ACTION_REQ,
            address: addr,
            callAmount: Math.max(0, callAmount),
            pot: this.pot,
            roundBet: this.roundBet
        });
    },

    _nextActiveInOrder() {
        const start = this.actionIndex;
        for (let i = 0; i < this.actionOrder.length; i++) {
            const idx = (start + i) % this.actionOrder.length;
            const addr = this.actionOrder[idx];
            if (!this.players[addr]?.folded && !this.players[addr]?.allIn) {
                this.actionIndex = (idx + 1) % this.actionOrder.length;
                // Check if we've gone full circle without a raise
                if (i > 0 || this.actionIndex !== 0) return addr;
            }
        }
        return null;
    },

    // Process an incoming action (called on host after receiving MSG.PLAYER_ACTION)
    processAction(addr, action, amount) {
        if (!this.isHost) return;
        if (addr !== this.currentTurnAddr) return;

        const player = this.players[addr];
        if (!player || player.folded || player.allIn) return;

        switch (action) {
            case ACTION.FOLD:
                player.folded = true;
                break;
            case ACTION.CHECK:
                // Valid only if no bet to call
                break;
            case ACTION.CALL: {
                const toCall = Math.min(this.roundBet - player.bet, player.stack);
                this._placeBet(addr, toCall);
                break;
            }
            case ACTION.RAISE: {
                const toCall = this.roundBet - player.bet;
                const raiseTotal = toCall + Math.max(amount, BIG_BLIND);
                const actual = Math.min(raiseTotal, player.stack);
                this._placeBet(addr, actual);
                this.roundBet = player.bet;
                this.lastRaiseAddr = addr;
                // Reset action order so everyone acts again
                const active = this._activePlayers();
                const myIdx = active.indexOf(addr);
                this.actionOrder = this._bettingOrder(active, (myIdx + 1) % active.length);
                this.actionIndex = 0;
                break;
            }
            case ACTION.ALL_IN: {
                const allInAmount = player.stack;
                this._placeBet(addr, allInAmount);
                player.allIn = true;
                if (player.bet > this.roundBet) {
                    this.roundBet = player.bet;
                    this.lastRaiseAddr = addr;
                }
                break;
            }
        }

        this._broadcastState();

        // Check if round is over
        const stillActive = this._activePlayers().filter(a => !this.players[a].folded && !this.players[a].allIn);
        if (stillActive.length <= 1) {
            this._advancePhase();
            return;
        }

        // Check if all active players have matched the round bet
        const allMatched = this._activePlayers()
            .filter(a => !this.players[a].folded && !this.players[a].allIn)
            .every(a => this.players[a].bet >= this.roundBet);

        if (allMatched && this._haveAllActed()) {
            this._advancePhase();
        } else {
            this._requestNextAction();
        }
    },

    _haveAllActed() {
        // Simple check: everyone not folded/allIn has bet at least roundBet
        return this._activePlayers()
            .filter(a => !this.players[a].folded && !this.players[a].allIn)
            .every(a => this.players[a].bet >= this.roundBet);
    },

    _advancePhase() {
        // Reset bets for new phase
        for (const addr of Object.keys(this.players)) {
            this.pot += this.players[addr].bet;
            this.players[addr].bet = 0;
        }
        this.roundBet = 0;

        const active = this._activePlayers().filter(a => !this.players[a].folded);
        if (active.length <= 1) {
            this._endRound(active);
            return;
        }

        switch (this.phase) {
            case PHASE.PREFLOP:
                this.phase = PHASE.FLOP;
                this.communityCards = [this.deck.pop(), this.deck.pop(), this.deck.pop()];
                this._broadcastCommunity('flop');
                break;
            case PHASE.FLOP:
                this.phase = PHASE.TURN;
                this.communityCards.push(this.deck.pop());
                this._broadcastCommunity('turn');
                break;
            case PHASE.TURN:
                this.phase = PHASE.RIVER;
                this.communityCards.push(this.deck.pop());
                this._broadcastCommunity('river');
                break;
            case PHASE.RIVER:
                this.phase = PHASE.SHOWDOWN;
                this._startShowdown();
                return;
        }

        const sbIdx = (this.dealerIndex + 1) % active.length;
        this.actionOrder = this._bettingOrder(active, sbIdx);
        this.actionIndex = 0;
        this._requestNextAction();
    },

    _startShowdown() {
        this.phase = PHASE.SHOWDOWN;
        // Ask all active non-folded players to reveal
        const active = this._activePlayers().filter(a => !this.players[a].folded);
        this._broadcast({ type: MSG.SHOWDOWN_REVEAL, players: active, communityCards: this.communityCards });
        // Small delay then resolve
        setTimeout(() => this._resolveShowdown(), 3000);
    },

    _resolveShowdown() {
        const active = this._activePlayers().filter(a => !this.players[a].folded);
        const holeCardsMap = {};
        for (const addr of active) {
            if (this.revealedHands[addr]) holeCardsMap[addr] = this.revealedHands[addr];
        }
        const { winners, hands } = PokerEngine.determineWinners(holeCardsMap, this.communityCards);
        this._endRound(winners, hands);
    },

    _endRound(winners, hands = {}) {
        const totalPot = this.pot + Object.values(this.players).reduce((s, p) => s + p.bet, 0);
        const share = Math.floor(totalPot / winners.length);
        for (const w of winners) {
            this.players[w].stack += share;
        }
        this.pot = 0;

        const handNames = {};
        for (const [addr, h] of Object.entries(hands)) { handNames[addr] = h?.name || ''; }

        this._broadcast({
            type: MSG.RESULT,
            winners,
            pot: totalPot,
            hands: handNames,
            stacks: Object.fromEntries(Object.entries(this.players).map(([a, p]) => [a, p.stack]))
        });

        // Remove busted players
        for (const addr of Object.keys(this.players)) {
            if (this.players[addr].stack <= 0) {
                delete this.players[addr];
                this.allAddresses = this.allAddresses.filter(a => a !== addr);
            }
        }

        // Start new round after delay
        setTimeout(() => {
            const remaining = this._activePlayers();
            if (remaining.length >= 2) {
                this.dealerIndex = (this.dealerIndex + 1) % remaining.length;
                this._broadcast({ type: MSG.NEW_ROUND, dealer: remaining[this.dealerIndex] });
                setTimeout(() => this._startRound(), 2000);
            }
        }, 5000);
    },

    // Handle a message received from another player (or host)
    handleMessage(senderAddr, data) {
        let msg;
        try { msg = JSON.parse(data); } catch { return; }

        switch (msg.type) {
            case MSG.JOIN:
                if (!this.players[msg.address]) {
                    this.players[msg.address] = {
                        name: msg.name || this._shortAddr(msg.address),
                        stack: STARTING_STACK, bet: 0, folded: false, allIn: false,
                        seatIndex: this.allAddresses.indexOf(msg.address), connected: true
                    };
                }
                if (typeof App !== 'undefined') App.onPlayerJoined(msg.address);
                break;

            case MSG.START:
                this.phase = PHASE.PREFLOP;
                this.pot = msg.pot;
                for (const addr of msg.players) {
                    if (this.players[addr]) {
                        this.players[addr].stack = msg.stacks[addr];
                        this.players[addr].bet = msg.bets[addr] || 0;
                        this.players[addr].folded = false;
                        this.players[addr].allIn = false;
                    }
                }
                if (typeof App !== 'undefined') App.onGameStarted(msg);
                break;

            case MSG.HOLE_CARDS:
                if (senderAddr === this.allAddresses[0]) { // only trust host
                    this.myHoleCards = msg.cards;
                    if (typeof App !== 'undefined') App.onHoleCards(msg.cards);
                }
                break;

            case MSG.COMMUNITY:
                this.communityCards = msg.cards;
                this.phase = msg.phase;
                if (typeof App !== 'undefined') App.onCommunityCards(msg.cards, msg.phase);
                break;

            case MSG.ACTION_REQ:
                this.currentTurnAddr = msg.address;
                this.pot = msg.pot;
                if (typeof App !== 'undefined') App.onActionRequest(msg.address, msg.callAmount, msg.pot, msg.roundBet);
                break;

            case MSG.PLAYER_ACTION:
                if (this.isHost) {
                    this.processAction(msg.address, msg.action, msg.amount || 0);
                }
                if (typeof App !== 'undefined') App.onPlayerAction(msg.address, msg.action, msg.amount);
                break;

            case MSG.STATE:
                this.pot = msg.pot;
                for (const [addr, stack] of Object.entries(msg.stacks || {})) {
                    if (this.players[addr]) this.players[addr].stack = stack;
                }
                for (const [addr, bet] of Object.entries(msg.bets || {})) {
                    if (this.players[addr]) this.players[addr].bet = bet;
                }
                for (const [addr, folded] of Object.entries(msg.folded || {})) {
                    if (this.players[addr]) this.players[addr].folded = folded;
                }
                if (typeof App !== 'undefined') App.onStateUpdate(msg);
                break;

            case MSG.SHOWDOWN_REVEAL:
                if (msg.players) {
                    // Host asking everyone to reveal
                    this.communityCards = msg.communityCards || this.communityCards;
                    if (!this.players[this.myAddress]?.folded) {
                        this._send({ type: MSG.SHOWDOWN_REVEAL, address: this.myAddress, cards: this.myHoleCards });
                    }
                    if (typeof App !== 'undefined') App.onShowdown(msg.players, msg.communityCards);
                } else if (msg.address && msg.cards) {
                    // Player revealing their cards
                    this.revealedHands[msg.address] = msg.cards;
                    if (typeof App !== 'undefined') App.onReveal(msg.address, msg.cards);
                }
                break;

            case MSG.RESULT:
                this.phase = PHASE.LOBBY;
                for (const [addr, stack] of Object.entries(msg.stacks || {})) {
                    if (this.players[addr]) this.players[addr].stack = stack;
                }
                if (typeof App !== 'undefined') App.onResult(msg.winners, msg.pot, msg.hands);
                break;

            case MSG.NEW_ROUND:
                if (typeof App !== 'undefined') App.onNewRound();
                break;

            case MSG.CHAT:
                if (typeof App !== 'undefined') App.onChat(senderAddr, msg.text);
                break;
        }
    },

    // Send action as a player
    sendAction(action, amount = 0) {
        const msg = { type: MSG.PLAYER_ACTION, address: this.myAddress, action, amount };
        // Host processes immediately; also broadcast to others
        if (this.isHost) {
            this.processAction(this.myAddress, action, amount);
        }
        this._broadcast(msg);
    },

    sendChat(text) {
        this._broadcast({ type: MSG.CHAT, address: this.myAddress, text });
    },

    // Helpers
    _activePlayers() {
        return this.allAddresses.filter(a => this.players[a] && this.players[a].stack > 0);
    },

    _bettingOrder(players, startIdx) {
        const result = [];
        for (let i = 0; i < players.length; i++) {
            result.push(players[(startIdx + i) % players.length]);
        }
        return result;
    },

    _placeBet(addr, amount) {
        const player = this.players[addr];
        if (!player) return;
        const actual = Math.min(amount, player.stack);
        player.bet = (player.bet || 0) + actual;
        player.stack -= actual;
    },

    _broadcastCommunity(phase) {
        this._broadcast({ type: MSG.COMMUNITY, cards: this.communityCards, phase });
    },

    _broadcastState() {
        const stacks = {}, bets = {}, folded = {};
        for (const [addr, p] of Object.entries(this.players)) {
            stacks[addr] = p.stack;
            bets[addr] = p.bet;
            folded[addr] = p.folded;
        }
        this._broadcast({ type: MSG.STATE, pot: this.pot, stacks, bets, folded });
    },

    _broadcast(msg) {
        SpixiAppSdk.sendNetworkData(JSON.stringify(msg));
        // Also process locally so sender sees state changes
        this.handleMessage(this.myAddress, JSON.stringify(msg));
    },

    _send(msg) {
        SpixiAppSdk.sendNetworkData(JSON.stringify(msg));
    },

    _shortAddr(addr) {
        return addr ? addr.slice(0, 6) + '…' + addr.slice(-4) : 'Unknown';
    }
};
