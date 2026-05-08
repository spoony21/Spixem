// Browser testing mock for Spixi SDK
// Replaces SpixiAppSdk when running outside the Spixi app
// Simulates up to 3 AI opponents using a local message bus

(function() {
    // Only activate mock if not in Spixi environment
    const isSpixi = /Spixi|ixian/i.test(navigator.userAgent);
    if (isSpixi) return;

    console.log('[MockSDK] Browser mode — activating test mock');

    const MOCK_ADDRESSES = [
        'ixian1AAAA0000000000000000000000000000000001',
        'ixian1BBBB0000000000000000000000000000000002',
        'ixian1CCCC0000000000000000000000000000000003',
        'ixian1DDDD0000000000000000000000000000000004',
    ];
    const MY_ADDRESS = 'ixian1MMMM0000000000000000000000000000000000';

    // Intercept location.href changes
    const origDescriptor = Object.getOwnPropertyDescriptor(window.location, 'href') ||
        Object.getOwnPropertyDescriptor(Object.getPrototypeOf(window.location), 'href');

    // Patch spixiAction to not navigate but route internally
    SpixiAppSdk.spixiAction = function(actionData, useRequestId = true) {
        let reqId = null;
        let promise;
        if (useRequestId) {
            reqId = ++SpixiAppSdk._requestId;
            actionData.id = reqId;
            promise = new Promise(function(resolve, reject) {
                SpixiAppSdk._pendingRequests[reqId] = { resolve, reject };
            });
        }

        setTimeout(() => MockBus.handle(actionData, reqId), 10);
        return promise;
    };

    const MockBus = {
        playerCount: 3, // number of AI opponents

        handle(action, reqId) {
            if (action.c === 'ds') {
                // Network data send — deliver to all mock peers
                const data = action.d;
                const recipient = action.r;

                if (recipient) {
                    // Private message (hole cards) — just deliver to self if it's for us
                    if (recipient === MY_ADDRESS) {
                        setTimeout(() => SpixiAppSdk.onNetworkData(MOCK_ADDRESSES[0], data), 50);
                    }
                } else {
                    // Broadcast — deliver back to self (already done by _broadcast), and handle AI
                    setTimeout(() => this.handleAIMessage(data), 200);
                }
            } else if (action.c === 'getStorage') {
                const val = localStorage.getItem(`spixi_${action.t}_${action.k}`);
                SpixiAppSdk.ar({ id: reqId, r: val ? btoa(val) : 'null' });
            } else if (action.c === 'setStorage') {
                const decoded = atob(action.v);
                localStorage.setItem(`spixi_${action.t}_${action.k}`, decoded);
                SpixiAppSdk.ar({ id: reqId, r: 'ok' });
            }
        },

        handleAIMessage(data) {
            let msg;
            try { msg = JSON.parse(data); } catch { return; }

            // AI responds to action requests
            if (msg.type === 'action_req') {
                const aiAddr = msg.address;
                if (aiAddr === MY_ADDRESS) return;

                const aiPlayer = GameProtocol.players[aiAddr];
                if (!aiPlayer || aiPlayer.folded) return;

                setTimeout(() => {
                    const callAmount = msg.callAmount || 0;
                    let action, amount = 0;

                    if (callAmount === 0) {
                        // Check or raise 30% of the time
                        if (Math.random() < 0.3) {
                            action = ACTION.RAISE;
                            amount = BIG_BLIND * (1 + Math.floor(Math.random() * 3));
                        } else {
                            action = ACTION.CHECK;
                        }
                    } else if (callAmount >= aiPlayer.stack) {
                        // All-in or fold
                        action = Math.random() < 0.5 ? ACTION.ALL_IN : ACTION.FOLD;
                    } else {
                        // Random strategy
                        const r = Math.random();
                        if (r < 0.2) action = ACTION.FOLD;
                        else if (r < 0.6) action = ACTION.CALL;
                        else { action = ACTION.RAISE; amount = callAmount + BIG_BLIND; }
                    }

                    if (GameProtocol.isHost) {
                        GameProtocol.processAction(aiAddr, action, amount);
                        GameProtocol._broadcast({
                            type: MSG.PLAYER_ACTION, address: aiAddr, action, amount
                        });
                    }
                }, 800 + Math.random() * 1200);
            }

            // AI reveals cards at showdown
            if (msg.type === 'showdown_reveal' && Array.isArray(msg.players)) {
                for (const addr of msg.players) {
                    if (addr === MY_ADDRESS) continue;
                    const cards = GameProtocol.revealedHands[addr] || [];
                    setTimeout(() => {
                        const reveal = JSON.stringify({ type: MSG.SHOWDOWN_REVEAL, address: addr, cards });
                        SpixiAppSdk.onNetworkData(addr, reveal);
                    }, 500);
                }
            }
        }
    };

    // Fire init after a short delay to simulate Spixi handshake
    setTimeout(() => {
        const aiCount = MockBus.playerCount;
        const remotes = MOCK_ADDRESSES.slice(0, aiCount);

        // Simulate AI players joining
        for (const addr of remotes) {
            GameProtocol.players[addr] = {
                name: 'AI ' + addr.slice(5, 6),
                stack: STARTING_STACK, bet: 0, folded: false, allIn: false,
                seatIndex: MOCK_ADDRESSES.indexOf(addr) + 1, connected: true
            };
        }

        SpixiAppSdk.onInit('mock-session-001', MY_ADDRESS, ...remotes);
    }, 300);

    window.MockBus = MockBus;
    console.log('[MockSDK] Ready. My address:', MY_ADDRESS);
})();
