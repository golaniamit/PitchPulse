const db = require('../db');
const bcrypt = require('bcryptjs');
const { matchOrders, getOrderBook } = require('./orderBook');
const { broadcast } = require('../websocket');

const BOT_ACCOUNTS = [
  { username: 'bot_momentum', personality: 'momentum' },
  { username: 'bot_contrarian', personality: 'contrarian' },
  { username: 'bot_noise', personality: 'noise' },
  { username: 'bot_informed', personality: 'informed' },
];

let botIntervals = [];
let resolutionHints = {}; // contractId -> 'YES' | 'NO' (set by resolver before resolution)

async function seedBotAccounts() {
  const hash = await bcrypt.hash('bot_password_internal', 10);
  for (const bot of BOT_ACCOUNTS) {
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(bot.username);
    if (!existing) {
      db.prepare('INSERT INTO users (username, password_hash, balance, is_bot) VALUES (?, ?, ?, 1)').run(bot.username, hash, 5000);
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

function placeBotOrder(botId, contractId, side, price, quantity) {
  const cost = side === 'YES' ? price * quantity : (100 - price) * quantity;
  const user = db.prepare('SELECT balance FROM users WHERE id = ?').get(botId);
  if (!user || user.balance < cost) return;

  db.prepare('UPDATE users SET balance = balance - ? WHERE id = ?').run(cost, botId);
  db.prepare('INSERT INTO orders (contract_id, user_id, side, price, quantity) VALUES (?, ?, ?, ?, ?)').run(contractId, botId, side, price, quantity);

  matchOrders(contractId);

  const newBalance = db.prepare('SELECT balance FROM users WHERE id = ?').get(botId).balance;
  broadcast({ type: 'balance_update', userId: botId, newBalance });
}

// ---- BOT PERSONALITIES ----

function momentumTick(botId) {
  const contracts = getActiveContracts();
  for (const c of contracts) {
    const recent = db.prepare('SELECT price FROM price_history WHERE contract_id = ? ORDER BY timestamp DESC LIMIT 5').all(c.id);
    if (recent.length < 2) continue;
    const trend = recent[0].price - recent[recent.length - 1].price;
    if (Math.abs(trend) < 3) continue; // no clear trend

    const side = trend > 0 ? 'YES' : 'NO';
    const price = clamp(c.current_price + (trend > 0 ? randomInt(1, 5) : -randomInt(1, 5)), 5, 95);
    const qty = randomInt(1, 3);
    placeBotOrder(botId, c.id, side, price, qty);
  }
}

function contrarianTick(botId) {
  const contracts = getActiveContracts();
  for (const c of contracts) {
    if (Math.random() > 0.4) continue; // only act sometimes
    // Fade the crowd: if price is high, buy NO; if low, buy YES
    const side = c.current_price > 55 ? 'NO' : 'YES';
    const price = clamp(
      side === 'YES' ? c.current_price - randomInt(2, 8) : (100 - c.current_price) - randomInt(2, 8),
      5, 95
    );
    const qty = randomInt(1, 2);
    placeBotOrder(botId, c.id, side, price, qty);
  }
}

function noiseTick(botId) {
  const contracts = getActiveContracts();
  for (const c of contracts) {
    if (Math.random() > 0.5) continue;
    const side = Math.random() > 0.5 ? 'YES' : 'NO';
    const base = side === 'YES' ? c.current_price : 100 - c.current_price;
    const price = clamp(base + randomInt(-10, 10), 5, 95);
    const qty = randomInt(1, 3);
    placeBotOrder(botId, c.id, side, price, qty);
  }
}

function informedTick(botId) {
  const contracts = getActiveContracts();
  for (const c of contracts) {
    const hint = resolutionHints[c.id];
    let targetPrice;
    if (hint === 'YES') {
      targetPrice = clamp(c.current_price + randomInt(3, 10), 60, 95);
    } else if (hint === 'NO') {
      targetPrice = clamp(c.current_price - randomInt(3, 10), 5, 40);
    } else {
      // No hint: act like a slightly smarter noise trader
      if (Math.random() > 0.6) continue;
      const side = Math.random() > 0.5 ? 'YES' : 'NO';
      const price = clamp((side === 'YES' ? c.current_price : 100 - c.current_price) + randomInt(-5, 5), 5, 95);
      placeBotOrder(botId, c.id, side, price, randomInt(1, 2));
      continue;
    }

    const side = hint === 'YES' ? 'YES' : 'NO';
    const price = side === 'YES' ? clamp(targetPrice, 5, 95) : clamp(100 - targetPrice, 5, 95);
    placeBotOrder(botId, c.id, side, price, randomInt(1, 3));
  }
}

function setResolutionHint(contractId, resolution) {
  resolutionHints[contractId] = resolution;
  // Clear hint after 2 minutes
  setTimeout(() => delete resolutionHints[contractId], 120000);
}

async function startBots() {
  if (process.env.NODE_ENV !== 'development' && process.env.ENABLE_BOTS !== 'true') {
    console.log('Bots disabled (not in dev mode)');
    return;
  }

  await seedBotAccounts();
  console.log('Starting bots...');

  const momentumId = getBotId('bot_momentum');
  const contrarianId = getBotId('bot_contrarian');
  const noiseId = getBotId('bot_noise');
  const informedId = getBotId('bot_informed');

  // Each bot fires on its own interval
  botIntervals.push(setInterval(() => momentumTick(momentumId), 8000));
  botIntervals.push(setInterval(() => contrarianTick(contrarianId), 12000));
  botIntervals.push(setInterval(() => noiseTick(noiseId), 5000));
  botIntervals.push(setInterval(() => informedTick(informedId), 10000));

  console.log('All 4 bots started');
}

function stopBots() {
  botIntervals.forEach(clearInterval);
  botIntervals = [];
}

module.exports = { startBots, stopBots, setResolutionHint };
