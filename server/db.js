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

// New contract metadata columns — drive the 3-slot card layout.
//   phase         : 'over' | 'by_over' | 'toss' | 'match'  (RIGHT badge token)
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
  const upPlayer = db.prepare(`
    INSERT INTO players (name, slug, team_id, role, headshot_path, is_active)
    VALUES (@name, @slug, @team_id, @role, @headshot_path, 1)
    ON CONFLICT(slug) DO UPDATE SET
      name = excluded.name,
      team_id = excluded.team_id,
      role = excluded.role,
      headshot_path = COALESCE(excluded.headshot_path, players.headshot_path),
      is_active = 1
  `);
  // Auto-detect downloaded headshots. If /players/{slug}.jpg exists
  // on disk, use it — lets the fetch-headshots script populate images
  // without editing the seed file.
  const PLAYERS_PUBLIC_DIR = path.join(__dirname, '..', 'client', 'public', 'players');
  function resolveHeadshot(p) {
    if (p.headshot_path) return p.headshot_path;
    const slug = slugify(p.name);
    const file = path.join(PLAYERS_PUBLIC_DIR, slug + '.jpg');
    return fs.existsSync(file) ? `/players/${slug}.jpg` : null;
  }

  const insertPlayers = db.transaction(rows => {
    deactivateAll.run();
    for (const p of rows) {
      const team_id = teamIdByShort[p.team_short];
      if (!team_id) continue;
      upPlayer.run({
        name: p.name,
        slug: slugify(p.name),
        team_id,
        role: p.role || null,
        headshot_path: resolveHeadshot(p),
      });
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
