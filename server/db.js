const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// In production, use /data volume (Railway persistent storage)
// In dev, use local market.db
const DB_PATH = process.env.NODE_ENV === 'production'
  ? '/data/market.db'
  : path.join(__dirname, '..', 'market.db');

// Create directory if it doesn't exist (needed on first Railway boot)
const DB_DIR = path.dirname(DB_PATH);
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      display_name TEXT,
      balance INTEGER DEFAULT 10000,
      is_admin INTEGER DEFAULT 0,
      is_bot INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS contracts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      type TEXT NOT NULL,
      condition_json TEXT,
      match_id TEXT,
      over_number INTEGER,
      status TEXT DEFAULT 'draft',
      resolution TEXT,
      resolve_mode TEXT DEFAULT 'auto',
      current_price INTEGER DEFAULT 50,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      resolved_at DATETIME,
      FOREIGN KEY (created_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contract_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      side TEXT NOT NULL,
      price INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      quantity_filled INTEGER DEFAULT 0,
      status TEXT DEFAULT 'open',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (contract_id) REFERENCES contracts(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contract_id INTEGER NOT NULL,
      buyer_order_id INTEGER NOT NULL,
      seller_order_id INTEGER NOT NULL,
      price INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      executed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (contract_id) REFERENCES contracts(id)
    );

    CREATE TABLE IF NOT EXISTS positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      contract_id INTEGER NOT NULL,
      side TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      avg_price REAL NOT NULL,
      UNIQUE(user_id, contract_id, side),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (contract_id) REFERENCES contracts(id)
    );

    CREATE TABLE IF NOT EXISTS price_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contract_id INTEGER NOT NULL,
      price INTEGER NOT NULL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (contract_id) REFERENCES contracts(id)
    );

    CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      username TEXT NOT NULL,
      category TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Web Push subscriptions (one row per (user, browser install)).
    -- Endpoint is the unique id coming back from the browser's PushManager.subscribe.
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    -- IPL teams. Logos are static SVGs in client/public/logos/.
    CREATE TABLE IF NOT EXISTS teams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      short_code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      primary_colour TEXT,
      logo_path TEXT
    );

    -- IPL players. Used by Admin's player picker (filtered by team_id) and
    -- joined onto contracts so the card can show a headshot. Headshot may be
    -- NULL — the UI then falls back to initials on the team's primary colour.
    CREATE TABLE IF NOT EXISTS players (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT UNIQUE,
      team_id INTEGER REFERENCES teams(id),
      role TEXT,
      headshot_path TEXT,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_players_team ON players(team_id);
  `);
}

initSchema();

// Migrations — safe to run on every boot (IF NOT EXISTS / try-catch)
try { db.exec(`ALTER TABLE users ADD COLUMN display_name TEXT`); } catch (_) {}
try { db.exec(`ALTER TABLE users ADD COLUMN email TEXT`); } catch (_) {}
try { db.exec(`ALTER TABLE users ADD COLUMN is_verified INTEGER DEFAULT 0`); } catch (_) {}
try { db.exec(`ALTER TABLE users ADD COLUMN verify_token TEXT`); } catch (_) {}
try { db.exec(`ALTER TABLE users ADD COLUMN verify_token_expires INTEGER`); } catch (_) {}
try { db.exec(`ALTER TABLE users ADD COLUMN reset_token TEXT`); } catch (_) {}
try { db.exec(`ALTER TABLE users ADD COLUMN reset_token_expires INTEGER`); } catch (_) {}
try { db.exec(`ALTER TABLE users ADD COLUMN tour_seen INTEGER DEFAULT 0`); } catch (_) {}
try { db.exec(`ALTER TABLE users ADD COLUMN is_test INTEGER DEFAULT 0`); } catch (_) {}
try { db.exec(`ALTER TABLE users ADD COLUMN avatar_emoji TEXT`); } catch (_) {}
try { db.exec(`ALTER TABLE users ADD COLUMN balance_at_day_start INTEGER`); } catch (_) {}
try { db.exec(`ALTER TABLE users ADD COLUMN snapshot_date TEXT`); } catch (_) {}

// Google sign-in columns. google_id is the stable Google account identifier
// (the `sub` claim). google_email is kept separately from `email` because
// Google users can later change their app email in Settings without losing
// the link to their Google account. needs_username = 1 is set for brand-new
// Google signups until the user picks a username on first login — the UI
// routes them to the picker while this flag is on.
try { db.exec(`ALTER TABLE users ADD COLUMN google_id TEXT`); } catch (_) {}
try { db.exec(`ALTER TABLE users ADD COLUMN google_email TEXT`); } catch (_) {}
try { db.exec(`ALTER TABLE users ADD COLUMN needs_username INTEGER DEFAULT 0`); } catch (_) {}
try { db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id) WHERE google_id IS NOT NULL`); } catch (_) {}

// New contract metadata columns — drive the 3-slot card layout.
//   phase         : 'over' | 'by_over' | 'toss' | 'match' | 'season'  (RIGHT badge token)
//   subject_kind  : 'team' | 'player' | 'matchup' | 'match_generic' (LEFT slot variant)
//   team_id       : single-team subjects (also the batsman's team for player cards)
//   opponent_team_id : matchup subjects (auto-derived for match-generic)
//   player_id     : player subjects
try { db.exec(`ALTER TABLE contracts ADD COLUMN phase TEXT`); } catch (_) {}
try { db.exec(`ALTER TABLE contracts ADD COLUMN subject_kind TEXT`); } catch (_) {}
try { db.exec(`ALTER TABLE contracts ADD COLUMN team_id INTEGER REFERENCES teams(id)`); } catch (_) {}
try { db.exec(`ALTER TABLE contracts ADD COLUMN opponent_team_id INTEGER REFERENCES teams(id)`); } catch (_) {}
try { db.exec(`ALTER TABLE contracts ADD COLUMN player_id INTEGER REFERENCES players(id)`); } catch (_) {}
// Innings number (1 or 2) — only used when phase='match' for innings-scoped
// bets (innings_score, custom_match with INN badge). Drives the 1ST INN /
// 2ND INN badge variant on the card.
try { db.exec(`ALTER TABLE contracts ADD COLUMN innings_number INTEGER`); } catch (_) {}
// Season identifier (e.g. 'IPL26') — only set when phase='season'. Lets us
// keep season-long contracts from different years separate in future and
// drives the season-badge label on the card.
try { db.exec(`ALTER TABLE contracts ADD COLUMN season_code TEXT`); } catch (_) {}
// Populated by the resolver on every evaluation of an active auto contract.
// Null when result is known (contract about to settle) or contract is manual/
// not yet polled. Admin UI surfaces this to explain why a contract is still
// pending.
try { db.exec(`ALTER TABLE contracts ADD COLUMN last_eval_reason TEXT`); } catch (_) {}
try { db.exec(`ALTER TABLE contracts ADD COLUMN last_eval_at DATETIME`); } catch (_) {}

// Canonical iplt20.com player ID — used to match our players against the
// official squad list and later download headshots from cricbuzz's image CDN.
// Nullable while the column is being backfilled; uniqueness enforced via a
// partial index so pre-backfill rows with NULL don't collide.
try { db.exec(`ALTER TABLE players ADD COLUMN ipl_id INTEGER`); } catch (_) {}
try { db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_players_ipl_id ON players(ipl_id) WHERE ipl_id IS NOT NULL`); } catch (_) {}

// Persists the resolver's in-memory over-snapshot ledger. Cricbuzz's live
// over-by-over page only exposes a rolling ~8-over window, so to resolve
// phase contracts (powerplay, death) after the match has moved past the
// phase we accumulate each over the resolver sees. Without persistence, a
// server restart mid-match loses all history and those phase contracts can
// pend forever. On boot, the resolver loads this table back into memory.
db.exec(`
  CREATE TABLE IF NOT EXISTS over_ledger (
    match_id   TEXT    NOT NULL,
    innings_id INTEGER NOT NULL,
    over_num   INTEGER NOT NULL,
    raw_json   TEXT    NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (match_id, innings_id, over_num)
  );
`);

// ─── Friends-groups feature ─────────────────────────────────────────────────
// A group is a private prediction-market bubble. Its creator is the only admin
// at v1 (can be transferred later). Every member gets a fresh per-group wallet
// (starting_coins) that is ENTIRELY separate from the public users.balance.
// Group contracts (contracts.group_id = groups.id) are only visible to members
// of that group; public contracts keep group_id NULL and work exactly as today.
db.exec(`
  CREATE TABLE IF NOT EXISTS groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    creator_id INTEGER NOT NULL,
    invite_code TEXT NOT NULL UNIQUE,
    starting_coins INTEGER NOT NULL DEFAULT 10000,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (creator_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS group_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',       -- 'admin' or 'member'
    balance INTEGER NOT NULL DEFAULT 0,         -- per-group wallet
    balance_at_day_start INTEGER,               -- for today-leaderboard
    snapshot_date TEXT,                         -- YYYY-MM-DD of last snapshot
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(group_id, user_id),
    FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id)  REFERENCES users(id)  ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_group_members_user ON group_members(user_id);
  CREATE INDEX IF NOT EXISTS idx_group_members_group ON group_members(group_id);
`);

// Nullable group_id on contracts. Null = public marketplace (everyone); set =
// visible only to members of that group. Everything downstream (orders,
// trades, positions) inherits context from their contract, so no schema
// change is needed on those tables.
try { db.exec(`ALTER TABLE contracts ADD COLUMN group_id INTEGER REFERENCES groups(id)`); } catch (_) {}
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_contracts_group ON contracts(group_id)`); } catch (_) {}

// Settlement transparency — admin writes a one-liner when resolving manually.
// Surfaces in the resolution toast + on the contract detail page so members
// see why the call went the way it did. Null for auto-resolved (the resolver
// has its own last_eval_reason for that).
try { db.exec(`ALTER TABLE contracts ADD COLUMN resolve_reason TEXT`); } catch (_) {}

// Per-member notification toggle for group activity. Default ON for admin
// (group creator auto-joins with this = 1), OFF for members unless they opt
// in during the join flow.
try { db.exec(`ALTER TABLE group_members ADD COLUMN notify_enabled INTEGER DEFAULT 0`); } catch (_) {}

// Season round counter. Incremented when an admin clicks "Close this season
// and start fresh". Active contracts get their round stamped at creation;
// reset wipes the group's active orders + positions but preserves resolved
// contract history (so members can still audit past seasons).
try { db.exec(`ALTER TABLE groups ADD COLUMN current_round INTEGER DEFAULT 1`); } catch (_) {}
try { db.exec(`ALTER TABLE contracts ADD COLUMN round_number INTEGER`); } catch (_) {}

// Grandfather only old accounts (no email = created before verification was added)
// Never touch new registrations that are intentionally unverified
db.exec(`UPDATE users SET is_verified = 1 WHERE email IS NULL`);

// Flag obvious existing test users so they're hidden from the leaderboard.
// Additions can be made by flipping the flag directly in the DB.
db.exec(`
  UPDATE users SET is_test = 1 WHERE username IN (
    'testuser1','testuser2','testuser3',
    'tourtest','sqtest',
    'golgames','golgames1','golgames2','golpolmol','aa',
    'pm_reviewer'
  ) AND is_test = 0
`);

// Auto-assign a deterministic emoji avatar to any user that doesn't have one.
// Curated list avoids ambiguous/offensive glyphs.
const EMOJI_POOL = ['🏏','🏆','🎯','🔥','⚡','🦁','🐘','🦅','🐯','🌟','💎','🚀','🦄','🐉','🦈','🦉','🐺','🐬','🦊','🐨'];
(function seedAvatars() {
  const users = db.prepare('SELECT id, username FROM users WHERE avatar_emoji IS NULL').all();
  const upd = db.prepare('UPDATE users SET avatar_emoji = ? WHERE id = ?');
  for (const u of users) {
    let h = 0;
    for (let i = 0; i < u.username.length; i++) h = u.username.charCodeAt(i) + ((h << 5) - h);
    upd.run(EMOJI_POOL[Math.abs(h) % EMOJI_POOL.length], u.id);
  }
})();

// Seed teams + players. Idempotent — uses UPSERT on short_code / slug so re-running
// the seed updates colours / headshot paths without duplicating rows. Safe to run
// on every boot.
function slugify(name) {
  return name.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
             .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

(function seedTeamsAndPlayers() {
  const teamSeed = require('./seeds/teams');
  const upTeam = db.prepare(`
    INSERT INTO teams (short_code, name, primary_colour, logo_path)
    VALUES (@short_code, @name, @primary_colour, @logo_path)
    ON CONFLICT(short_code) DO UPDATE SET
      name = excluded.name,
      primary_colour = excluded.primary_colour,
      logo_path = excluded.logo_path
  `);
  const insertTeams = db.transaction(rows => { for (const r of rows) upTeam.run(r); });
  insertTeams(teamSeed);

  const playerSeed = require('./seeds/players');
  const teamIdByShort = Object.fromEntries(
    db.prepare('SELECT id, short_code FROM teams').all().map(t => [t.short_code, t.id])
  );
  // Every seed run, first mark all existing players inactive. The upsert
  // below then flips is_active=1 for any player present in the current
  // seed. Players no longer in the seed (released, retired) stay in the
  // DB (so existing contract.player_id references still resolve) but
  // become is_active=0 and drop out of the admin's player picker.
  const deactivateAll = db.prepare(`UPDATE players SET is_active = 0`);
  // Prefer ipl_id as the stable identity when present (seed entries carry it
  // after the 2026 audit); fall back to slug-based upsert for legacy rows.
  const findByIplId = db.prepare(`SELECT id FROM players WHERE ipl_id = ?`);
  const upPlayerBySlug = db.prepare(`
    INSERT INTO players (name, slug, team_id, role, headshot_path, ipl_id, is_active)
    VALUES (@name, @slug, @team_id, @role, @headshot_path, @ipl_id, 1)
    ON CONFLICT(slug) DO UPDATE SET
      name = excluded.name,
      team_id = excluded.team_id,
      role = excluded.role,
      headshot_path = COALESCE(excluded.headshot_path, players.headshot_path),
      ipl_id = COALESCE(excluded.ipl_id, players.ipl_id),
      is_active = 1
  `);
  // Keep existing slug — renames don't change the URL identifier. Updating
  // name is fine, but changing slug could break any existing headshot_path
  // that references /players/<slug>.png on disk.
  const upPlayerByIplId = db.prepare(`
    UPDATE players
    SET name = @name,
        team_id = @team_id,
        role = @role,
        headshot_path = COALESCE(@headshot_path, headshot_path),
        is_active = 1
    WHERE id = @id
  `);

  // Auto-detect downloaded headshots. If /players/{slug}.{jpg|png|webp}
  // exists on disk, use it — lets the fetch-headshots script populate images
  // without editing the seed file.
  const PLAYERS_PUBLIC_DIR = path.join(__dirname, '..', 'client', 'public', 'players');
  function resolveHeadshot(p) {
    if (p.headshot_path) return p.headshot_path;
    const slug = slugify(p.name);
    // iplt20 headshots come as .png — prefer those over any old hand-placed
    // .jpg files so the newer source wins on boot. If both exist, the .jpg
    // should be considered an orphan.
    for (const ext of ['png', 'webp', 'jpg', 'jpeg']) {
      const file = path.join(PLAYERS_PUBLIC_DIR, `${slug}.${ext}`);
      if (fs.existsSync(file)) return `/players/${slug}.${ext}`;
    }
    return null;
  }

  const insertPlayers = db.transaction(rows => {
    deactivateAll.run();
    for (const p of rows) {
      const team_id = teamIdByShort[p.team_short];
      if (!team_id) continue;
      const payload = {
        name: p.name,
        slug: slugify(p.name),
        team_id,
        role: p.role || null,
        headshot_path: resolveHeadshot(p),
        ipl_id: p.ipl_id ?? null,
      };
      // If the seed row has an ipl_id and we already have a row with that
      // ipl_id (possibly under a different slug after a rename), UPDATE that
      // row by id rather than creating a duplicate.
      if (payload.ipl_id != null) {
        const existing = findByIplId.get(payload.ipl_id);
        if (existing) { upPlayerByIplId.run({ ...payload, id: existing.id }); continue; }
      }
      upPlayerBySlug.run(payload);
    }
  });
  insertPlayers(playerSeed);
})();

// Backfill existing contracts' phase / subject_kind / team_id / player_id
// from their current type + condition_json. Only touches rows where these
// fields are NULL — idempotent across boots.
(function backfillContracts() {
  const rows = db.prepare(`
    SELECT id, type, condition_json FROM contracts
    WHERE phase IS NULL OR subject_kind IS NULL
  `).all();
  if (rows.length === 0) return;

  // Team short_code & full-name → id
  const teams = db.prepare('SELECT id, short_code, name FROM teams').all();
  const teamIdFromName = (s) => {
    if (!s) return null;
    const norm = String(s).trim().toLowerCase();
    const t = teams.find(x =>
      x.short_code.toLowerCase() === norm || x.name.toLowerCase() === norm);
    return t ? t.id : null;
  };
  // Player name → id (case-insensitive exact match first, then fuzzy slug)
  const allPlayers = db.prepare('SELECT id, name, slug, team_id FROM players').all();
  const playerIdFromName = (s) => {
    if (!s) return null;
    const norm = String(s).trim().toLowerCase();
    const exact = allPlayers.find(p => p.name.toLowerCase() === norm);
    if (exact) return exact.id;
    const slug = slugify(s);
    const bySlug = allPlayers.find(p => p.slug === slug);
    return bySlug ? bySlug.id : null;
  };
  const playerTeamId = (playerId) => allPlayers.find(p => p.id === playerId)?.team_id || null;

  const upd = db.prepare(`
    UPDATE contracts
       SET phase = ?, subject_kind = ?, team_id = ?, opponent_team_id = ?, player_id = ?, over_number = COALESCE(over_number, ?)
     WHERE id = ?
  `);
  let backfilled = 0;
  for (const c of rows) {
    let cond = {};
    try { cond = c.condition_json ? JSON.parse(c.condition_json) : {}; } catch (_) {}
    let phase = null, subject_kind = null, team_id = null, opponent_team_id = null, player_id = null, over_number = null;

    switch (c.type) {
      case 'runs_over':
        phase = 'over'; subject_kind = 'team';
        team_id = teamIdFromName(cond.team); over_number = cond.over || null; break;
      case 'wicket_over':
        phase = 'over'; subject_kind = 'team';
        team_id = teamIdFromName(cond.batting_team || cond.team); over_number = cond.over || null; break;
      case 'team_total':
        phase = 'by_over'; subject_kind = 'team';
        team_id = teamIdFromName(cond.team); over_number = cond.by_over || null; break;
      case 'batsman_milestone':
        phase = 'by_over'; subject_kind = 'player';
        player_id = playerIdFromName(cond.batsman);
        team_id = playerTeamId(player_id); over_number = cond.by_over || null; break;
      case 'boundary_over':
        phase = 'over'; subject_kind = 'team';
        team_id = teamIdFromName(cond.team); over_number = cond.over || null; break;
      case 'manual':
      default:
        phase = 'match'; subject_kind = 'match_generic'; break;
    }
    upd.run(phase, subject_kind, team_id, opponent_team_id, player_id, over_number, c.id);
    backfilled++;
  }
  if (backfilled) console.log(`[migration] Backfilled ${backfilled} contracts with phase/subject_kind`);
})();

module.exports = db;
