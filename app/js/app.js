// Main application — UI logic and Spixi event handlers

const App = {
    myAddress: null,
    actionCallAmount: 0,
    chatOpen: false,

    init() {
        SpixiAppSdk.onInit = (sessionId, myAddress, ...remoteAddresses) => {
            this.myAddress = myAddress;
            GameProtocol.init(sessionId, myAddress, remoteAddresses);
            this.showScreen('lobby');
            this.renderLobby();
        };

        SpixiAppSdk.onNetworkData = (senderAddr, data) => {
            GameProtocol.handleMessage(senderAddr, data);
        };

        SpixiAppSdk.fireOnLoad();
    },

    // ─── Screen management ───────────────────────────────────────────────────

    showScreen(name) {
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        document.getElementById('screen-' + name)?.classList.add('active');
    },

    // ─── Lobby ───────────────────────────────────────────────────────────────

    renderLobby() {
        const list = document.getElementById('lobby-players');
        if (!list) return;
        list.innerHTML = '';
        for (const [addr, p] of Object.entries(GameProtocol.players)) {
            const li = document.createElement('li');
            li.innerHTML = `<span class="player-dot"></span> ${p.name} <span class="chip-count">${p.stack} chips</span>`;
            list.appendChild(li);
        }
        const startBtn = document.getElementById('btn-start');
        if (startBtn) {
            startBtn.style.display = GameProtocol.isHost ? 'block' : 'none';
        }
        const waitMsg = document.getElementById('wait-msg');
        if (waitMsg) {
            waitMsg.style.display = GameProtocol.isHost ? 'none' : 'block';
        }
    },

    onPlayerJoined(addr) {
        this.renderLobby();
        this.addLog(`${GameProtocol.players[addr]?.name || 'Player'} joined the table`);
    },

    // ─── Game started ────────────────────────────────────────────────────────

    onGameStarted(msg) {
        this.showScreen('game');
        this.renderTable();
        this.addLog(`New hand — Dealer: ${GameProtocol._shortAddr(msg.dealer)}`);
        document.getElementById('actions').style.display = 'none';
    },

    onHoleCards(cards) {
        const el = document.getElementById('my-cards');
        if (!el) return;
        el.innerHTML = cards.map(c => PokerEngine.cardHTML(c)).join('');
        el.classList.add('card-deal');
    },

    onCommunityCards(cards, phase) {
        const el = document.getElementById('community-cards');
        if (!el) return;
        el.innerHTML = cards.map(c => PokerEngine.cardHTML(c)).join('');
        this.addLog(`--- ${phase.toUpperCase()} ---`);
        this.renderTable();
    },

    onActionRequest(addr, callAmount, pot, roundBet) {
        this.actionCallAmount = callAmount;
        document.getElementById('pot-display').textContent = `Pot: ${pot}`;
        this.renderTable();

        const isMyTurn = addr === this.myAddress;
        const actions = document.getElementById('actions');
        if (!actions) return;
        actions.style.display = isMyTurn ? 'flex' : 'none';

        if (isMyTurn) {
            document.getElementById('btn-call').textContent = callAmount > 0 ? `Call ${callAmount}` : 'Check';
            const myStack = GameProtocol.players[this.myAddress]?.stack || 0;
            document.getElementById('raise-slider').max = myStack;
            document.getElementById('raise-slider').value = Math.min(callAmount + BIG_BLIND, myStack);
            this.updateRaiseDisplay();
            this.highlightCurrentPlayer(addr);
        } else {
            this.highlightCurrentPlayer(addr);
        }
    },

    onPlayerAction(addr, action, amount) {
        const name = GameProtocol.players[addr]?.name || GameProtocol._shortAddr(addr);
        let msg = `${name}: ${action.toUpperCase()}`;
        if (amount > 0) msg += ` ${amount}`;
        this.addLog(msg);
        this.renderTable();
    },

    onStateUpdate(state) {
        document.getElementById('pot-display').textContent = `Pot: ${state.pot}`;
        this.renderTable();
    },

    onShowdown(players, communityCards) {
        this.addLog('--- SHOWDOWN ---');
        document.getElementById('actions').style.display = 'none';
        this.renderTable();
    },

    onReveal(addr, cards) {
        const name = GameProtocol.players[addr]?.name || GameProtocol._shortAddr(addr);
        this.addLog(`${name} shows: ${cards.map(c => PokerEngine.cardLabel(c)).join(' ')}`);
        this.renderTable();
    },

    onResult(winners, pot, hands) {
        const winNames = winners.map(a => GameProtocol.players[a]?.name || GameProtocol._shortAddr(a));
        const share = Math.floor(pot / winners.length);
        this.addLog(`🏆 ${winNames.join(' & ')} wins ${share} chips! (${winners.map(w => hands[w]).filter(Boolean).join(', ')})`);
        document.getElementById('actions').style.display = 'none';
        this.renderTable();
        this.showResult(winNames.join(' & '), share, winners.map(w => hands[w]).filter(Boolean).join(', '));
    },

    onNewRound() {
        this.addLog('New round starting…');
        document.getElementById('result-banner')?.classList.remove('show');
        document.getElementById('my-cards').innerHTML = '<div class="card face-down">🂠</div><div class="card face-down">🂠</div>';
        document.getElementById('community-cards').innerHTML = '';
        document.getElementById('actions').style.display = 'none';
    },

    onChat(addr, text) {
        const name = GameProtocol.players[addr]?.name || GameProtocol._shortAddr(addr);
        this.addChatMessage(name, text);
    },

    // ─── Table rendering ─────────────────────────────────────────────────────

    renderTable() {
        const container = document.getElementById('player-seats');
        if (!container) return;
        container.innerHTML = '';
        const players = GameProtocol.allAddresses.filter(a => a !== this.myAddress && GameProtocol.players[a]);
        const total = players.length;

        players.forEach((addr, i) => {
            const p = GameProtocol.players[addr];
            const angle = (i / total) * Math.PI; // top half arc
            const x = 50 + 42 * Math.cos(Math.PI + angle * (total > 1 ? 1 : 0));
            const y = 20 + 35 * Math.sin(Math.PI + angle * (total > 1 ? 1 : 0));

            const seat = document.createElement('div');
            seat.className = 'seat' + (p.folded ? ' folded' : '') + (addr === GameProtocol.currentTurnAddr ? ' active-seat' : '');
            seat.style.left = `${x}%`;
            seat.style.top = `${y}%`;

            const cards = GameProtocol.revealedHands[addr]
                ? GameProtocol.revealedHands[addr].map(c => PokerEngine.cardHTML(c)).join('')
                : (!p.folded ? '<div class="card face-down sm">🂠</div><div class="card face-down sm">🂠</div>' : '');

            seat.innerHTML = `
                <div class="seat-cards">${cards}</div>
                <div class="seat-info">
                    <div class="seat-name">${p.name}${addr === GameProtocol.allAddresses[0] ? ' 👑' : ''}</div>
                    <div class="seat-stack">${p.stack}${p.bet > 0 ? ` <span class="bet-chip">${p.bet}</span>` : ''}</div>
                    ${p.folded ? '<div class="folded-label">FOLDED</div>' : ''}
                    ${p.allIn ? '<div class="allin-label">ALL IN</div>' : ''}
                </div>`;
            container.appendChild(seat);
        });

        // My bet display
        const myBet = GameProtocol.players[this.myAddress]?.bet || 0;
        const myStack = GameProtocol.players[this.myAddress]?.stack || 0;
        const myInfo = document.getElementById('my-info');
        if (myInfo) {
            myInfo.innerHTML = `${myStack} chips${myBet > 0 ? ` <span class="bet-chip">${myBet}</span>` : ''}`;
        }
    },

    highlightCurrentPlayer(addr) {
        document.querySelectorAll('.seat').forEach(s => s.classList.remove('active-seat'));
        // Find and highlight the seat (renderTable handles this via class)
        this.renderTable();
    },

    showResult(winner, amount, handName) {
        const banner = document.getElementById('result-banner');
        if (!banner) return;
        banner.innerHTML = `<div class="result-inner">🏆 ${winner}<br><small>wins ${amount} chips</small>${handName ? `<br><small>${handName}</small>` : ''}</div>`;
        banner.classList.add('show');
    },

    // ─── Actions ─────────────────────────────────────────────────────────────

    fold() { GameProtocol.sendAction(ACTION.FOLD); document.getElementById('actions').style.display = 'none'; },
    check() { GameProtocol.sendAction(ACTION.CHECK); document.getElementById('actions').style.display = 'none'; },
    call() { GameProtocol.sendAction(ACTION.CALL, this.actionCallAmount); document.getElementById('actions').style.display = 'none'; },
    raise() {
        const amount = parseInt(document.getElementById('raise-slider').value, 10);
        GameProtocol.sendAction(ACTION.RAISE, amount);
        document.getElementById('actions').style.display = 'none';
    },
    allIn() { GameProtocol.sendAction(ACTION.ALL_IN); document.getElementById('actions').style.display = 'none'; },

    updateRaiseDisplay() {
        const slider = document.getElementById('raise-slider');
        const display = document.getElementById('raise-amount');
        if (slider && display) display.textContent = slider.value;
    },

    // ─── Chat ────────────────────────────────────────────────────────────────

    toggleChat() {
        this.chatOpen = !this.chatOpen;
        document.getElementById('chat-panel').classList.toggle('open', this.chatOpen);
    },

    sendChat() {
        const input = document.getElementById('chat-input');
        if (!input || !input.value.trim()) return;
        GameProtocol.sendChat(input.value.trim());
        this.addChatMessage('You', input.value.trim());
        input.value = '';
    },

    addChatMessage(name, text) {
        const log = document.getElementById('chat-log');
        if (!log) return;
        const div = document.createElement('div');
        div.className = 'chat-msg';
        div.innerHTML = `<b>${name}:</b> ${text}`;
        log.appendChild(div);
        log.scrollTop = log.scrollHeight;
        // Flash chat button
        document.getElementById('btn-chat')?.classList.add('flash');
        setTimeout(() => document.getElementById('btn-chat')?.classList.remove('flash'), 1000);
    },

    // ─── Log ─────────────────────────────────────────────────────────────────

    addLog(text) {
        const log = document.getElementById('game-log');
        if (!log) return;
        const div = document.createElement('div');
        div.className = 'log-entry';
        div.textContent = text;
        log.appendChild(div);
        log.scrollTop = log.scrollHeight;
    }
};

document.addEventListener('DOMContentLoaded', () => App.init());
