const db = require('./db');

const CACHE_MS = 3000;
const cache = new Map();

function getSetting(key, defaultValue = null) {
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && now - cached.at < CACHE_MS) return cached.value;
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
  const value = row ? row.value : defaultValue;
  cache.set(key, { value, at: now });
  return value;
}

function setSetting(key, value) {
  const str = String(value);
  db.prepare(`
    INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `).run(key, str);
  cache.set(key, { value: str, at: Date.now() });
}

function getIntSetting(key, defaultValue = 0) {
  const v = getSetting(key, null);
  if (v === null) return defaultValue;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : defaultValue;
}

module.exports = { getSetting, setSetting, getIntSetting };
