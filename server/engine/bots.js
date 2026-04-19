const db = require('../db');
const bcrypt = require('bcryptjs');
const { matchOrders } = require('./orderBook');
const { broadcast } = require('../websocket');
const { getIntSetting } = require('../settings');

const BOT_ACCOUNTS = [
  { username: 'bot_momentum', personality: 'momentum' },
  { username: 'bot_contrarian', personality: 'contrarian' },
  { username: 'bot_noise', personality: 'noise' },
  { username: 'bot_informed', personality: 'informed' },
];

// Intensity dial — 0 = off, 1 = low, 2 = moderate, 3 = high.
// probMul scales each personality's own action probability.
// cooldownMs rate-limits each bot on each contract.
// maxBotShare makes bots back off when they already dominate recent trades.
const LEVELS = {
  0: { probMul: 0,   maxQty: 0, cooldownMs: Infinity, maxBotShare: 0     },
  1: { probMul: 0.2, maxQty: 1, cooldownMs: 120_000,  maxBotShare: 0.30  },
  2: { probMul: 0.6, maxQty: 2, cooldownMs: 30_000,   maxBotShare: 0.50  },
  3: { probMul: 1.0, maxQty: 3, cooldownMs: 15_000,   maxBotShare: 0.70  },
};

const VOLUME_SHARE_TTL_MS = 10_000;
const VOLUME_SHARE_LOOKBACK = 10;

let botIntervals = [];
let resolutionHints = {}; // contractId -> 'YES' | 'NO'
const lastOrderAt = new Map(); // `${botId}_${contractId}` -> timestamp
const volumeShareCache = new Map(); // contractId -> { share, at }

async function seedBotAccounts() {
  const hash = await bcrypt.hash('bot_password_internal', 10);
  for (const bot of BOT_ACCOUNTS) {
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(bot.username);
    if (!existing) {
      db.prepare('INSERT INTO users (username, password_hash, balance, is_bot) VALUES (?, ?, ?, 1)').run(bot.username, hash, 10000);
      console.log(`Bot account created: ${bot.username}`);
    }
  }
}

function getBotId(username) {
  return db.prepare('SELECT id FROM users WHERE username = ?').get(username)?.id;
}

function getActiveContracts() {
  return db.prepare("SELECT * FROM contracts WHERE status = 'active'").all();
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function currentLevel() {
  const n = getIntSetting('bots_intensity', 0);
  return LEVELS[n] || LEVELS[0];
}

function getBotVolumeShare(contractId) {
  const cached = volumeShareCache.get(contractId);
  if (cached && Date.now() - cached.at < VOLUME_SHARE_TTL_MS) return cached.share;

  const trades = db.prepare(`
    SELECT bu.is_bot as buyer_bot, su.is_bot as seller_bot
    FROM trades t
    JOIN orders bo ON bo.id = t.buyer_order_id
    JOIN orders so ON so.id = t.seller_order_id
    JOIN users bu ON bu.id = bo.user_id
    JOIN users su ON su.id = so.user_id
    WHERE t.contract_id = ?
    ORDER BY t.executed_at DESC
    LIMIT ?
  `).all(contractId, VOLUME_SHARE_LOOKBACK);

  // Not enough data to judge — treat as "safe to trade".
  if (trades.length < 4) {
    volumeShareCache.set(contractId, { share: null, at: Date.now() });
    return null;
  }
  const botTrades = trades.filter(t => t.buyer_bot || t.seller_bot).length;
  const share = botTrades / trades.length;
  volumeShareCache.set(contractId, { share, at: Date.now() });
  return share;
}

function canTrade(botId, contractId, level) {
  const key = `${botId}_${contractId}`;
  const last = lastOrderAt.get(key) || 0;
  if (Date.now() - last < level.cooldownMs) return false;

  const share = getBotVolumeShare(contractId);
  if (share !== null && share >= level.maxBotShare) return false;

  return true;
}

function placeBotOrder(botId, contractId, side, price, quantity, level) {
  const qty = Math.min(quantity, level.maxQty);
  if (qty <= 0) return;

  const cost = side === 'YES' ? price * qty : (100 - price) * qty;
  const user = db.prepare('SELECT balance FROM users WHERE id = ?').get(botId);
  if (!user || user.balance < cost) return;

  db.prepare('UPDATE users SET balance = balance - ? WHERE id = ?').run(cost, botId);
  db.prepare('INSERT INTO orders (contract_id, user_id, side, price, quantity) VALUES (?, ?, ?, ?, ?)').run(contractId, botId, side, price, qty);

  lastOrderAt.set(`${botId}_${contractId}`, Date.now());
  volumeShareCache.delete(contractId);

  matchOrders(contractId);

  const newBalance = db.prepare('SELECT balance FROM users WHERE id = ?').get(botId).balance;
  broadcast({ type: 'balance_update', userId: botId, newBalance });
}

// ---- BOT PERSONALITIES ----
// Each tick: bail if dial is 0. For each active contract, check rate limit
// and volume-share back-off, then roll against the level's probMul.

function momentumTick(botId) {
  const level = currentLevel();
  if (level.probMul === 0) return;
  for (const c of getActiveContracts()) {
    if (!canTrade(botId, c.id, level)) continue;
    const recent = db.prepare('SELECT price FROM price_history WHERE contract_id = ? ORDER BY timestamp DESC LIMIT 5').all(c.id);
    if (recent.length < 2) continue;
    const trend = recent[0].price - recent[recent.length - 1].price;
    if (Math.abs(trend) < 3) continue;
    if (Math.random() >= level.probMul) continue;

    const side = trend > 0 ? 'YES' : 'NO';
    const price = clamp(c.current_price + (trend > 0 ? randomInt(1, 5) : -randomInt(1, 5)), 5, 95);
    placeBotOrder(botId, c.id, side, price, randomInt(1, 3), level);
  }
}

function contrarianTick(botId) {
  const level = currentLevel();
  if (level.probMul === 0) return;
  for (const c of getActiveContracts()) {
    if (!canTrade(botId, c.id, level)) continue;
    if (Math.random() >= 0.4 * level.probMul) continue;

    const side = c.current_price > 55 ? 'NO' : 'YES';
    const price = clamp(
      side === 'YES' ? c.current_price - randomInt(2, 8) : (100 - c.current_price) - randomInt(2, 8),
      5, 95
    );
    placeBotOrder(botId, c.id, side, price, randomInt(1, 2), level);
  }
}

function noiseTick(botId) {
  const level = currentLevel();
  if (level.probMul === 0) return;
  for (const c of getActiveContracts()) {
    if (!canTrade(botId, c.id, level)) continue;
    if (Math.random() >= 0.5 * level.probMul) continue;

    const side = Math.random() > 0.5 ? 'YES' : 'NO';
    const base = side === 'YES' ? c.current_price : 100 - c.current_price;
    const price = clamp(base + randomInt(-10, 10), 5, 95);
    placeBotOrder(botId, c.id, side, price, randomInt(1, 3), level);
  }
}

function informedTick(botId) {
  const level = currentLevel();
  if (level.probMul === 0) return;
  for (const c of getActiveContracts()) {
    if (!canTrade(botId, c.id, level)) continue;
    const hint = resolutionHints[c.id];

    if (hint) {
      // Level-gated even for informed — otherwise L1 lets it fire every tick.
      if (Math.random() >= level.probMul) continue;
      const targetPrice = hint === 'YES'
        ? clamp(c.current_price + randomInt(3, 10), 60, 95)
        : clamp(c.current_price - randomInt(3, 10), 5, 40);
      const side = hint;
      const price = side === 'YES' ? clamp(targetPrice, 5, 95) : clamp(100 - targetPrice, 5, 95);
      placeBotOrder(botId, c.id, side, price, randomInt(1, 3), level);
    } else {
      if (Math.random() >= 0.4 * level.probMul) continue;
      const side = Math.random() > 0.5 ? 'YES' : 'NO';
      const price = clamp((side === 'YES' ? c.current_price : 100 - c.current_price) + randomInt(-5, 5), 5, 95);
      placeBotOrder(botId, c.id, side, price, randomInt(1, 2), level);
    }
  }
}

function setResolutionHint(contractId, resolution) {
  resolutionHints[contractId] = resolution;
  setTimeout(() => delete resolutionHints[contractId], 120000);
}

async function startBots() {
  await seedBotAccounts();
  console.log('Bots running — activity gated by admin intensity dial (bots_intensity setting)');

  const momentumId = getBotId('bot_momentum');
  const contrarianId = getBotId('bot_contrarian');
  const noiseId = getBotId('bot_noise');
  const informedId = getBotId('bot_informed');

  botIntervals.push(setInterval(() => momentumTick(momentumId), 8000));
  botIntervals.push(setInterval(() => contrarianTick(contrarianId), 12000));
  botIntervals.push(setInterval(() => noiseTick(noiseId), 5000));
  botIntervals.push(setInterval(() => informedTick(informedId), 10000));
}

function stopBots() {
  botIntervals.forEach(clearInterval);
  botIntervals = [];
}

module.exports = { startBots, stopBots, setResolutionHint };
