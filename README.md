# Texas Hold'em — Spixi Mini-App

A multiplayer Texas Hold'em poker game built for the Spixi / Ixian network.

## Structure

```
texas-holdem/
├── appinfo.spixi          # Spixi app metadata
└── app/
    ├── index.html         # Entry point
    ├── css/style.css      # Mobile-first poker UI
    └── js/
        ├── spixi-app-sdk.js   # Official Spixi SDK
        ├── spixi-tools.js     # Spixi utilities
        ├── poker-engine.js    # Deck + hand evaluation
        ├── game-protocol.js   # Game state & P2P messaging
        ├── app.js             # UI logic
        └── mock-sdk.js        # Browser testing mock (3 AI opponents)
```

## Browser Testing

Open `app/index.html` directly in a browser (Firefox recommended for local file access).

The **mock SDK** activates automatically outside Spixi and:
- Assigns you a fake Ixian address
- Adds 3 AI opponents
- Simulates the full P2P messaging layer
- Stores data in `localStorage`

The player with the lexicographically-first address is the **host** (marked 👑). In browser mode the m

## Game Rules

- **2–6 players**, 1000 chip starting stacks
- Blinds: 10 / 20
- Standard betting rounds: Pre-Flop → Flop → Turn → River → Showdown
- Actions: Fold, Check/Call, Raise, All-In
- The host (first address alphabetically) deals and manages game state

## Hand Rankings

Royal Flush > Straight Flush > Four of a Kind > Full House > Flush > Straight > Three of a Kind > Two Pair > One Pair > High Card
