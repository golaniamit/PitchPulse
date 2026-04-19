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

// Grandfather only old accounts (no email = created before verification was added)
// Never touch new registrations that are intentionally unverified
db.exec(`UPDATE users SET is_verified = 1 WHERE email IS NULL`);

// ONE-SHOT: reset all users' tour so they see the updated onboarding tour on next login.
// REMOVE THIS LINE AND REDEPLOY after Railway has booted once with it in place.
db.exec(`UPDATE users SET tour_seen = 0`);

module.exports = db;
