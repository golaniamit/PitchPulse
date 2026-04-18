# IPL Prediction Market App — Handover Document

## What you are building

A real-time binary prediction market app for use with friends during live IPL matches. Users receive a starting balance of coins and trade contracts that resolve to 100 (YES) or 0 (NO). The price of a contract at any moment reflects the crowd's implied probability. One person acts as admin and creates contracts during a match; all other users trade them. The app is modelled on how platforms like Polymarket work, but scoped for a private group of friends.

This document contains everything needed to build the app from scratch, locally, on your machine. Build and test locally first. Deploy only when confident everything works.

---

## Workflow instructions for Claude

- Do as much as possible autonomously — write code, run it, debug it, fix it yourself in your bash environment before involving the user.
- Only bring the user in at two points: (1) when a feature is complete and working and you want sign-off before moving on, and (2) when you need visual feedback on the frontend that you cannot assess yourself.
- The user is non-technical. Never ask them to debug, read error logs, or make code decisions. Handle all of that yourself.
- When handing off a working piece, show a clean summary: what was built, what was tested, what the user needs to do (usually just: open browser, look at this screen).
- Build one feature at a time. Test each before starting the next.
- All code goes into a single folder called `ipl-market` on the user's machine.

---

## Tech stack

### Backend
- **Runtime:** Node.js
- **Framework:** Express.js
- **Database:** SQLite (via `better-sqlite3`) — single file, no setup required locally
- **Real-time:** WebSockets (via `ws` package)
- **Cricket data:** CricAPI free tier for live match data and auto-resolution polling
- **Auth:** Simple session-based auth with `express-session` — no OAuth needed for a friends app

### Frontend
- **Framework:** React (via Vite)
- **Styling:** Tailwind CSS
- **Charts:** TradingView lightweight-charts (for price history graph)
- **WebSocket client:** Native browser WebSocket API

### Deployment target (later, not now)
- **Platform:** Railway or Render
- **Database swap:** SQLite → PostgreSQL (connection string change only)

---

## Folder structure

```
ipl-market/
├── server/
│   ├── index.js              # Express app entry point
│   ├── db.js                 # SQLite connection and schema setup
│   ├── routes/
│   │   ├── auth.js           # Login, logout, session
│   │   ├── contracts.js      # Create, list, resolve contracts
│   │   ├── orders.js         # Place orders, cancel orders
│   │   └── users.js          # User profile, balance, portfolio
│   ├── engine/
│   │   ├── orderBook.js      # Order matching logic (core trading engine)
│   │   ├── resolver.js       # Auto-resolution polling via CricAPI
│   │   └── bots.js           # Simulated bot traders for local testing
│   └── websocket.js          # WebSocket server, broadcast logic
├── client/
│   ├── index.html
│   ├── vite.config.js
│   ├── tailwind.config.js
│   └── src/
│       ├── main.jsx
│       ├── App.jsx
│       ├── context/
│       │   ├── AuthContext.jsx
│       │   └── SocketContext.jsx
│       ├── pages/
│       │   ├── Home.jsx          # Active contracts feed
│       │   ├── Contract.jsx      # Contract detail + trading screen
│       │   ├── Portfolio.jsx     # User's open positions
│       │   ├── Leaderboard.jsx   # Rankings by coin balance
│       │   └── Admin.jsx         # Admin panel (contract creation + resolution)
│       └── components/
│           ├── ContractCard.jsx
│           ├── OrderBook.jsx
│           ├── PriceChart.jsx
│           ├── TradePanel.jsx
│           └── Navbar.jsx
├── package.json              # Root — scripts to run both server and client
└── .env                      # API keys and config (never commit this)
```

---

## Database schema

```sql
-- Users
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  balance INTEGER DEFAULT 1000,
  is_admin INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Contracts
CREATE TABLE contracts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  type TEXT NOT NULL,           -- runs_over | wicket_over | team_total | batsman_milestone | boundary_over | manual
  condition_json TEXT,          -- structured condition as JSON string
  match_id TEXT,                -- CricAPI match ID
  over_number INTEGER,
  status TEXT DEFAULT 'draft',  -- draft | active | resolved | cancelled
  resolution TEXT,              -- null | YES | NO
  resolve_mode TEXT DEFAULT 'auto',  -- auto | manual
  current_price INTEGER DEFAULT 50,
  created_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  resolved_at DATETIME,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

-- Orders
CREATE TABLE orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  side TEXT NOT NULL,           -- YES | NO
  price INTEGER NOT NULL,       -- 1–99
  quantity INTEGER NOT NULL,
  quantity_filled INTEGER DEFAULT 0,
  status TEXT DEFAULT 'open',   -- open | filled | cancelled | partial
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (contract_id) REFERENCES contracts(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Trades (matched orders)
CREATE TABLE trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_id INTEGER NOT NULL,
  buyer_order_id INTEGER NOT NULL,
  seller_order_id INTEGER NOT NULL,
  price INTEGER NOT NULL,
  quantity INTEGER NOT NULL,
  executed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (contract_id) REFERENCES contracts(id)
);

-- Positions (holdings per user per contract)
CREATE TABLE positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  contract_id INTEGER NOT NULL,
  side TEXT NOT NULL,           -- YES | NO
  quantity INTEGER NOT NULL,
  avg_price REAL NOT NULL,
  UNIQUE(user_id, contract_id, side),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (contract_id) REFERENCES contracts(id)
);

-- Price history (one row per trade for the chart)
CREATE TABLE price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_id INTEGER NOT NULL,
  price INTEGER NOT NULL,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (contract_id) REFERENCES contracts(id)
);
```

---

## Core trading engine logic

### How binary contracts work
- Every contract settles at exactly **100** (YES) or **0** (NO)
- Price at any moment = implied probability (price of 68 = 68% chance YES)
- Buying YES at price P costs P coins per contract; pays 100 if YES, 0 if NO
- Buying NO at price P costs (100−P) coins per contract; pays 100 if NO, 0 if YES
- Buyer and seller are always on opposite sides of the same contract

### Order book mechanics
- Bids = users wanting to buy YES (sorted highest to lowest price)
- Asks = users wanting to buy NO (equivalent to selling YES, sorted lowest to highest)
- When the highest bid price + lowest ask price = 100, a match exists
- On match: execute trade, update both orders, record trade, update price history, broadcast via WebSocket
- Current price = price of last executed trade
- If no match: order sits in the book waiting

### Settlement on resolution
- Admin (or auto-resolver) marks contract YES or NO
- For each open position:
  - If side matches resolution: user receives 100 × quantity coins
  - If side does not match: user receives 0
- All open unfilled orders for the contract are cancelled and coins returned
- Leaderboard updates

---

## Auto-resolution system

### How it works
- A polling loop runs every 15 seconds on the backend
- On each tick: fetch live match data from CricAPI for the active match
- Loop through all contracts with `status = active` and `resolve_mode = auto`
- Parse the `condition_json` for each contract and evaluate against live data
- If condition is definitively met or definitively failed (over has ended): resolve contract
- Broadcast resolution event via WebSocket to all connected clients

### Condition JSON structure by contract type

```json
// runs_over
{ "type": "runs_over", "team": "CSK", "over": 15, "operator": ">=", "threshold": 10 }

// wicket_over
{ "type": "wicket_over", "batting_team": "CSK", "over": 15, "min_wickets": 1 }

// team_total
{ "type": "team_total", "team": "CSK", "by_over": 15, "operator": ">=", "threshold": 150 }

// batsman_milestone
{ "type": "batsman_milestone", "batsman": "MS Dhoni", "milestone": 50, "by_over": 18 }

// boundary_over
{ "type": "boundary_over", "team": "CSK", "over": 15, "boundary_type": "six" }

// manual — no condition_json, resolver ignores it
{ "type": "manual" }
```

### CricAPI integration
- Free tier endpoint: `https://api.cricapi.com/v1/match_info?apikey=YOUR_KEY&id=MATCH_ID`
- Returns over-by-over data, current score, wickets, ball-by-ball if available
- Sign up at cricapi.com — free tier is sufficient for a friends app
- Store the API key in `.env` as `CRIC_API_KEY`
- Store the active match ID in `.env` as `CRIC_MATCH_ID` — update this each match day

---

## Bot system (local testing only)

Four bot personalities run as background processes during local development. They simulate a live market so the price chart moves, the order book fills, and the system can be stress-tested without real users.

### Bot types
1. **Momentum bot** — watches price direction; buys YES when price rising, buys NO when falling. Mimics herd behaviour.
2. **Contrarian bot** — always fades the crowd. Buys NO when price is high (thinks YES is overpriced), buys YES when price is low.
3. **Noise trader** — places random orders at random prices and random intervals. Creates organic-looking volume and spread.
4. **Informed bot** — has a slightly higher probability of being on the correct side. Starts moving its position 60–90 seconds before resolution. Makes the price drift toward the correct answer before the contract ends — this is what makes the chart interesting.

### Bot behaviour
- Each bot has its own user account in the database (flagged `is_bot = 1`)
- Bots start automatically when the dev server starts (enabled by `ENABLE_BOTS=true` in `.env`)
- Bots are disabled automatically when the app is deployed (production env check)
- Bot trades go through the same order matching engine as real user trades — no shortcuts

---

## WebSocket events

All real-time communication uses these event types. Client subscribes on connection; server broadcasts on state change.

```
Server → Client:
  price_update      { contractId, price, timestamp }
  trade_executed    { contractId, price, quantity, timestamp }
  orderbook_update  { contractId, bids: [], asks: [] }
  contract_resolved { contractId, resolution: 'YES'|'NO' }
  balance_update    { userId, newBalance }
  contract_created  { contract }

Client → Server:
  place_order       { contractId, side, price, quantity }
  cancel_order      { orderId }
  subscribe         { contractId }
  unsubscribe       { contractId }
```

---

## Admin panel features

The admin panel is accessible only to users with `is_admin = 1` in the database. It is a separate page at `/admin`.

### Contract builder form
Six contract types selectable via tiles (not dropdowns):
1. Runs in an over
2. Wicket in an over
3. Team total by over
4. Batsman milestone
5. Six or four in an over
6. Custom / manual

Each type shows only the relevant fields. A live preview assembles the contract title sentence in real time as fields are filled. Admin confirms the preview before publishing.

Fields common to all types: activation timing (which over), expiry (which over), resolution mode (auto/manual), visibility (active immediately / scheduled / draft).

### Admin dashboard
- List of all contracts with current status
- One-click activate / deactivate
- Manual resolve buttons (YES / NO) for manual contracts
- Live view of how many users hold positions on each contract
- Ability to cancel a contract and refund all positions

---

## UI screens

### 1. Home feed (`/`)
- Header shows live match score + current over (polled from CricAPI)
- Tab filter: Active / Resolved / My bets
- Contract cards showing: question, current price as progress bar, implied probability %, Buy YES / Buy NO buttons, volume and trader count
- Wallet balance persistent in header

### 2. Contract detail (`/contract/:id`)
- Full contract question + status badge
- TradingView lightweight-charts price history graph (line chart, updates live via WebSocket)
- Order book (bids left, asks right, depth bars)
- Trade panel: YES/NO toggle, quantity stepper, live P&L preview (cost / if YES / if NO), confirm button

### 3. Portfolio (`/portfolio`)
- Open positions: contract name, side held, quantity, avg buy price, current market price, unrealised P&L
- Resolved positions: same + final P&L

### 4. Leaderboard (`/leaderboard`)
- Ranked by current coin balance
- Show username, balance, change from starting balance, number of trades

### 5. Admin panel (`/admin`)
- Protected route — redirect to home if not admin
- Contract builder form (described above)
- Active contracts dashboard with quick-action buttons

---

## Design direction

The app should look and feel like a polished consumer product — comparable to Polymarket or a clean fintech app. Not a developer prototype.

- Dark navy (`#1a1a2e`) used for the top navigation bar and key action buttons
- Clean white card surfaces for contract cards and panels
- Green (`#2e7d32` family) for YES / bullish / positive P&L
- Red (`#c62828` family) for NO / bearish / negative P&L
- Tailwind utility classes throughout — no custom CSS files except for the chart container
- Mobile-first layout — the app should work on a phone browser since users will be watching the match on TV and trading on their phone
- Smooth transitions on price updates (number flips, colour flash on change)

---

## Environment variables (`.env` file)

```
PORT=3001
SESSION_SECRET=replace_with_a_long_random_string
CRIC_API_KEY=your_cricapi_key_here
CRIC_MATCH_ID=the_match_id_for_todays_game
ENABLE_BOTS=true
NODE_ENV=development
```

---

## Build order

Build strictly in this sequence. Do not start a phase until the previous one is tested and working.

### Phase 1 — Backend foundation
1. Initialise project, install dependencies
2. Set up SQLite database with full schema
3. Express server with basic routes (health check, static file serving)
4. User auth (register, login, logout, session middleware)
5. Test: can create users, log in, get session

### Phase 2 — Contracts API
1. Contract CRUD routes (create, list, get by id, update status)
2. Admin middleware (reject non-admin on protected routes)
3. Test: admin can create a contract, users can list contracts

### Phase 3 — Trading engine
1. Order placement route (validate balance, insert order, attempt match)
2. Order matching logic (continuous double auction)
3. Trade recording and position updating
4. Balance deduction on order placement, refund on cancel
5. Test: two users can place opposing orders, trade executes, balances update correctly

### Phase 4 — WebSockets
1. WebSocket server setup
2. Broadcast on trade execution (price update, orderbook update)
3. Broadcast on contract resolution
4. Broadcast on balance change
5. Test: open two browser tabs, trade on one, watch the other update live

### Phase 5 — Bot system
1. Bot user accounts seeded in database
2. Bot logic for all four personalities
3. Bot activation on server start (dev mode only)
4. Test: bots trading produces moving price chart, order book activity

### Phase 6 — Auto-resolver
1. CricAPI polling loop
2. Condition evaluation logic for all six contract types
3. Resolution trigger and payout calculation
4. Test: create a contract with a condition already true, verify it resolves correctly on next poll

### Phase 7 — Frontend
1. Vite + React + Tailwind setup
2. Auth pages (login / register)
3. Home feed with contract cards (static data first, then live)
4. Contract detail page with order book and trade panel
5. Portfolio page
6. Leaderboard page
7. Admin panel with contract builder form
8. Connect all WebSocket events to live UI updates
9. TradingView chart integration

### Phase 8 — Integration testing
1. Full flow test with bots: create contract → bots trade → price moves → contract resolves → payouts correct
2. Edge cases: user tries to spend more than balance, order partially filled, contract cancelled mid-trading
3. Multiple contracts active simultaneously
4. Admin resolves a manual contract during active bot trading

---

## Notes for later (do not build now)

- **Deployment:** When ready, push to Railway. Swap SQLite for Railway's PostgreSQL. Update `DATABASE_URL` in env. Everything else stays the same.
- **Multiple matches:** Currently one `CRIC_MATCH_ID` in env. Later this can become a match selector in the admin panel.
- **New contract types:** Adding a new type requires: (1) new tile in admin form, (2) new condition JSON structure, (3) new evaluation case in `resolver.js`. Nothing else changes.
- **Invite system:** For deployment, a simple invite-code system on the register page is enough to keep it private — no need for full email verification.

---

*End of handover document.*
