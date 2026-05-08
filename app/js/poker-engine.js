// Poker engine: deck creation, shuffling, hand evaluation

const SUITS = ['h', 'd', 'c', 's'];
const SUIT_SYMBOLS = { h: '♥', d: '♦', c: '♣', s: '♠' };
const RANK_NAMES = { 2:'2',3:'3',4:'4',5:'5',6:'6',7:'7',8:'8',9:'9',10:'10',11:'J',12:'Q',13:'K',14:'A' };
const HAND_NAMES = ['High Card','One Pair','Two Pair','Three of a Kind','Straight','Flush','Full House','Four of a Kind','Straight Flush','Royal Flush'];

const PokerEngine = {
    createDeck() {
        const deck = [];
        for (const suit of SUITS) {
            for (let rank = 2; rank <= 14; rank++) {
                deck.push({ rank, suit });
            }
        }
        return deck;
    },

    shuffle(deck) {
        const d = [...deck];
        for (let i = d.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [d[i], d[j]] = [d[j], d[i]];
        }
        return d;
    },

    cardLabel(card) {
        return RANK_NAMES[card.rank] + SUIT_SYMBOLS[card.suit];
    },

    cardHTML(card, faceDown = false) {
        if (faceDown) return '<div class="card face-down">🂠</div>';
        const isRed = card.suit === 'h' || card.suit === 'd';
        const cls = isRed ? 'card red' : 'card black';
        const label = RANK_NAMES[card.rank] + '<span class="suit">' + SUIT_SYMBOLS[card.suit] + '</span>';
        return `<div class="${cls}"><div class="card-rank-top">${label}</div><div class="card-suit-center">${SUIT_SYMBOLS[card.suit]}</div><div class="card-rank-bottom">${label}</div></div>`;
    },

    // Evaluate best 5-card hand from any number of cards (usually 5-7)
    bestHand(cards) {
        if (cards.length < 5) return null;
        const combos = this._combinations(cards, 5);
        let best = null;
        for (const combo of combos) {
            const score = this._scoreHand(combo);
            if (!best || this._compareScores(score, best.score) > 0) {
                best = { cards: combo, score, name: HAND_NAMES[score[0]] };
            }
        }
        return best;
    },

    // Returns array [handRank, ...tiebreakers]
    _scoreHand(cards) {
        const ranks = cards.map(c => c.rank).sort((a, b) => b - a);
        const suits = cards.map(c => c.suit);
        const rankCounts = {};
        for (const r of ranks) rankCounts[r] = (rankCounts[r] || 0) + 1;
        const counts = Object.values(rankCounts).sort((a, b) => b - a);
        const isFlush = suits.every(s => s === suits[0]);
        const isStraight = this._isStraight(ranks);

        if (isFlush && isStraight) {
            const high = Math.max(...ranks);
            return high === 14 ? [9, 14] : [8, high];
        }
        if (counts[0] === 4) return [7, ...this._groupByCount(rankCounts, [4, 1])];
        if (counts[0] === 3 && counts[1] === 2) return [6, ...this._groupByCount(rankCounts, [3, 2])];
        if (isFlush) return [5, ...ranks];
        if (isStraight) return [4, Math.max(...ranks)];
        if (counts[0] === 3) return [3, ...this._groupByCount(rankCounts, [3, 1, 1])];
        if (counts[0] === 2 && counts[1] === 2) return [2, ...this._groupByCount(rankCounts, [2, 2, 1])];
        if (counts[0] === 2) return [1, ...this._groupByCount(rankCounts, [2, 1, 1, 1])];
        return [0, ...ranks];
    },

    _isStraight(sortedRanks) {
        // Check normal straight
        let straight = true;
        for (let i = 0; i < sortedRanks.length - 1; i++) {
            if (sortedRanks[i] - sortedRanks[i + 1] !== 1) { straight = false; break; }
        }
        if (straight) return true;
        // Ace-low straight (A-2-3-4-5)
        const acelow = [5, 4, 3, 2, 1];
        const normalized = sortedRanks.map(r => r === 14 ? 1 : r).sort((a, b) => b - a);
        return JSON.stringify(normalized) === JSON.stringify(acelow);
    },

    _groupByCount(rankCounts, countOrder) {
        const result = [];
        const used = new Set();
        for (const cnt of countOrder) {
            const rank = Object.keys(rankCounts)
                .filter(r => rankCounts[r] === cnt && !used.has(r))
                .sort((a, b) => b - a)[0];
            used.add(rank);
            result.push(Number(rank));
        }
        return result;
    },

    _compareScores(a, b) {
        for (let i = 0; i < Math.max(a.length, b.length); i++) {
            const diff = (a[i] || 0) - (b[i] || 0);
            if (diff !== 0) return diff;
        }
        return 0;
    },

    _combinations(arr, k) {
        const result = [];
        const combo = [];
        function pick(start) {
            if (combo.length === k) { result.push([...combo]); return; }
            for (let i = start; i < arr.length; i++) {
                combo.push(arr[i]);
                pick(i + 1);
                combo.pop();
            }
        }
        pick(0);
        return result;
    },

    // Determine winner(s) from active players with hole cards + community cards
    determineWinners(activePlayers, communityCards) {
        const hands = {};
        for (const [addr, holeCards] of Object.entries(activePlayers)) {
            hands[addr] = this.bestHand([...holeCards, ...communityCards]);
        }
        let bestScore = null;
        let winners = [];
        for (const [addr, hand] of Object.entries(hands)) {
            if (!hand) continue;
            if (!bestScore || this._compareScores(hand.score, bestScore) > 0) {
                bestScore = hand.score;
                winners = [addr];
            } else if (this._compareScores(hand.score, bestScore) === 0) {
                winners.push(addr);
            }
        }
        return { winners, hands };
    }
};
