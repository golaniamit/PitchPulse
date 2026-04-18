# CLAUDE.md — IPL Prediction Market App

## What this is

A real-time binary prediction market app for a private group of friends to use during live IPL matches. One person is the admin and creates contracts during a match. Everyone else trades them. Contracts settle at 100 (YES) or 0 (NO). The price at any moment is the crowd's implied probability. Modelled conceptually on Polymarket, built for private use.

---

## How to work

- Work autonomously. Write, run, debug, and fix code yourself.
- Only involve the user when a feature is complete and tested, or when you need visual feedback on a UI screen.
- When checking in, show a clean summary: what was built, what was tested, what the user needs to do (usually just open a browser and look at something).
- Build one phase at a time. Do not start the next phase until the current one works.
- All code goes inside a folder called `ipl-market/`.

---

## Tech stack — agreed during planning

- **Backend:** Node.js + Express
- **Database:** SQLite locally (swap to PostgreSQL on deployment — not now)
- **Real-time:** WebSockets
- **Frontend:** React + Tailwind CSS
- **Charts:** TradingView lightweight-charts
- **Cricket data:** CricAPI free tier for live match data and auto-resolution

---

## Core product decisions — made during ideation

### The trading mechanism
Binary contracts only. Every contract settles at 100 (YES) or 0 (NO). Price = implied probability. Buyer and seller are always on opposite sides. Zero-sum between users. Order matching via continuous double auction — price emerges from whoever is on the other side, not set by the house.

### Contract types — six agreed types for v1
1. Runs in a specific over (team, over number, condition, threshold)
2. Wicket falls in a specific over (batting team, over number, min wickets)
3. Team total by a given over (team, over, condition, threshold)
4. Batsman milestone (batsman name, milestone runs, by which over)
5. Six or four in a specific over (team, over, boundary type)
6. Custom / manual (free text question, no auto-resolution)

New contract types can be added later without touching the core trading engine.

### Admin contract creation
The admin panel uses a structured form builder — not free text input. Six contract type tiles. Selecting a tile shows only the relevant fields for that type. A live preview sentence assembles in real time so the admin can confirm what users will see before publishing. Fields include activation over, expiry over, resolution mode (auto/manual), and visibility (active now / scheduled / draft).

### Auto-resolution
The backend polls CricAPI every 15 seconds. For each active auto-resolve contract, it evaluates the contract's structured condition against live match data and resolves when the condition is definitively met or the relevant over has ended. Manual contracts are resolved by the admin clicking YES or NO in the admin dashboard.

### Bot system for local testing
Four bot personalities run during local development to simulate a live market: a momentum bot, a contrarian bot, a noise trader, and an informed bot that drifts toward the correct answer before resolution. Bots use the same trading engine as real users. Bots are disabled in production automatically.

### Coin economy
Every user starts with 1000 coins. Coins are locked when an order is placed. Winning positions pay 100 coins per contract held. The system is zero-sum between players.

---

## Design direction — agreed during planning

- Polished, consumer-grade. Comparable to Polymarket or a clean fintech app. Not a prototype aesthetic.
- Dark navy for the top navigation and primary action buttons.
- White card surfaces for contracts and panels.
- Green for YES / positive / wins. Red for NO / negative / losses.
- Mobile-first — users will be on their phones while watching the match on TV.
- Smooth live updates — price ticks, order book refreshes, chart animates — all via WebSocket, no manual refresh.

### Screens
1. Home feed — active contracts, current price as probability bar, buy YES / buy NO buttons
2. Contract detail — price history chart, live order book, trade panel with P&L preview
3. Portfolio — open and resolved positions with P&L
4. Leaderboard — ranked by coin balance
5. Admin panel — contract builder + active contract dashboard with resolve controls

---

## Build phases — follow this order

1. Project scaffold, dependencies, folder structure, database schema
2. User auth (register, login, session)
3. Contracts API (create, list, fetch, update status) with admin protection
4. Trading engine (order placement, matching, settlement, position tracking)
5. WebSockets (live price, order book, balance updates)
6. Bot system (four personalities, runs on dev only)
7. Auto-resolver (CricAPI polling, condition evaluation, payout trigger)
8. Frontend (all five screens, wired to live data)
9. Integration testing (full flow with bots, edge cases, simultaneous contracts)

---

## What to leave for later

- Deployment (Railway / Render / PostgreSQL)
- Invite-code system for keeping the deployed app private
- Match selector in admin (one match at a time via env var is fine for now)
- Any new contract types the user thinks of during testing

---

*Decisions above were finalised during ideation. Implementation details are yours to determine during the build.*
