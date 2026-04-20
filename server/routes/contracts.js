const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware');
const { broadcast } = require('../websocket');
const { pushToUser } = require('../engine/push');
const { stripTags } = require('../sanitize');

const router = express.Router();

// Enrich a contract row with live order book state
const bestYesBidStmt = db.prepare("SELECT MAX(price) as best FROM orders WHERE contract_id = ? AND side = 'YES' AND status IN ('open','partial')");
const bestNoBidStmt  = db.prepare("SELECT MAX(price) as best FROM orders WHERE contract_id = ? AND side = 'NO'  AND status IN ('open','partial')");
const hasTradesStmt  = db.prepare("SELECT COUNT(*) as cnt FROM trades WHERE contract_id = ?");
// Total coins that have changed hands = sum of quantity × 100 across all executed trades.
const volumeStmt     = db.prepare("SELECT COALESCE(SUM(quantity * 100), 0) as vol FROM trades WHERE contract_id = ?");
// Distinct non-bot users who have ever traded or have an outstanding order on this contract.
const traderCountStmt = db.prepare(`
  SELECT COUNT(DISTINCT x.user_id) as n FROM (
    SELECT user_id FROM positions WHERE contract_id = ?
    UNION
    SELECT user_id FROM orders    WHERE contract_id = ?
  ) x
  JOIN users u ON u.id = x.user_id
  WHERE u.is_bot = 0
`);

function enrichContract(c) {
  return {
    ...c,
    best_yes_bid: bestYesBidStmt.get(c.id)?.best ?? null,
    best_no_bid:  bestNoBidStmt.get(c.id)?.best  ?? null,
    has_trades:   hasTradesStmt.get(c.id).cnt > 0,
    volume:       volumeStmt.get(c.id).vol,
    trader_count: traderCountStmt.get(c.id, c.id).n,
  };
}

// List contracts (with filter). Non-admins only see active + resolved.
router.get('/', requireAuth, (req, res) => {
  const { status } = req.query;
  const user = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(req.session.userId);
  const isAdmin = !!user?.is_admin;

  const where = [];
  const params = [];
  if (status) { where.push('c.status = ?'); params.push(status); }
  if (!isAdmin) where.push("c.status IN ('active','resolved')");

  let query = 'SELECT c.*, u.username as creator FROM contracts c LEFT JOIN users u ON c.created_by = u.id';
  if (where.length) query += ' WHERE ' + where.join(' AND ');
  query += ' ORDER BY c.created_at DESC';
  const contracts = db.prepare(query).all(...params).map(enrichContract);
  res.json({ contracts });
});

// Get single contract. Draft/cancelled return 404 to non-admins (don't leak existence).
router.get('/:id', requireAuth, (req, res) => {
  const contract = db.prepare('SELECT c.*, u.username as creator FROM contracts c LEFT JOIN users u ON c.created_by = u.id WHERE c.id = ?').get(req.params.id);
  if (!contract) return res.status(404).json({ error: 'Contract not found' });
  if (contract.status === 'draft' || contract.status === 'cancelled') {
    const user = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(req.session.userId);
    if (!user?.is_admin) return res.status(404).json({ error: 'Contract not found' });
  }
  res.json({ contract: enrichContract(contract) });
});

// Create contract (admin only)
router.post('/', requireAdmin, (req, res) => {
  const { title, type, condition_json, match_id, over_number, resolve_mode, status } = req.body;
  if (!title || !type) return res.status(400).json({ error: 'Title and type required' });

  const validTypes = ['runs_over', 'wicket_over', 'team_total', 'batsman_milestone', 'boundary_over', 'manual'];
  if (!validTypes.includes(type)) return res.status(400).json({ error: 'Invalid contract type' });

  // Strip any HTML out of title + condition_json free-text fields (manual
  // question, batsman name, etc.) so stored content is always safe to render.
  const cleanTitle = stripTags(title).slice(0, 200);
  if (!cleanTitle) return res.status(400).json({ error: 'Title required' });
  const cleanedCondition = sanitizeCondition(condition_json);

  const stmt = db.prepare(`
    INSERT INTO contracts (title, type, condition_json, match_id, over_number, resolve_mode, status, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    cleanTitle,
    type,
    cleanedCondition ? JSON.stringify(cleanedCondition) : null,
    match_id || null,
    over_number || null,
    resolve_mode || 'manual',
    status || 'draft',
    req.session.userId
  );

  const contract = db.prepare('SELECT c.*, u.username as creator FROM contracts c LEFT JOIN users u ON c.created_by = u.id WHERE c.id = ?').get(result.lastInsertRowid);

  // Add initial price history point
  db.prepare('INSERT INTO price_history (contract_id, price) VALUES (?, ?)').run(contract.id, 50);

  // Only broadcast once the contract is visible to users
  if (contract.status === 'active') {
    broadcast({ type: 'contract_created', contract: enrichContract(contract) });
  }

  res.status(201).json({ contract: enrichContract(contract) });
});

// Edit a draft contract (admin only). Body fields are the same subset
// as create — title, type, condition_json, resolve_mode — and the status
// can optionally be flipped to 'active' in the same request (Save & Publish).
// Refuses to edit anything that isn't a draft so trading isn't pulled out
// from under users.
router.patch('/:id', requireAdmin, (req, res) => {
  const { title, type, condition_json, resolve_mode, status } = req.body;
  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(req.params.id);
  if (!contract) return res.status(404).json({ error: 'Contract not found' });
  if (contract.status !== 'draft') {
    return res.status(400).json({ error: 'Only draft contracts can be edited' });
  }

  const validTypes = ['runs_over', 'wicket_over', 'team_total', 'batsman_milestone', 'boundary_over', 'manual'];
  if (!validTypes.includes(type)) return res.status(400).json({ error: 'Invalid contract type' });

  const cleanTitle = stripTags(title || '').slice(0, 200);
  if (!cleanTitle) return res.status(400).json({ error: 'Title required' });
  const cleanedCondition = sanitizeCondition(condition_json);

  const nextStatus = (status === 'active' || status === 'draft') ? status : 'draft';

  db.prepare(`
    UPDATE contracts
       SET title = ?, type = ?, condition_json = ?, resolve_mode = ?, status = ?
     WHERE id = ?
  `).run(
    cleanTitle,
    type,
    cleanedCondition ? JSON.stringify(cleanedCondition) : null,
    resolve_mode || 'manual',
    nextStatus,
    req.params.id,
  );

  const updated = db.prepare('SELECT c.*, u.username as creator FROM contracts c LEFT JOIN users u ON c.created_by = u.id WHERE c.id = ?').get(req.params.id);
  // Only broadcast once the contract becomes visible to traders.
  if (nextStatus === 'active') {
    broadcast({ type: 'contract_created', contract: enrichContract(updated) });
  }
  res.json({ contract: enrichContract(updated) });
});

// Update contract status (admin only)
router.patch('/:id/status', requireAdmin, (req, res) => {
  const { status } = req.body;
  const validStatuses = ['draft', 'active', 'cancelled'];
  if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status' });

  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(req.params.id);
  if (!contract) return res.status(404).json({ error: 'Contract not found' });
  if (contract.status === 'resolved') return res.status(400).json({ error: 'Cannot change status of resolved contract' });

  db.prepare('UPDATE contracts SET status = ? WHERE id = ?').run(status, req.params.id);

  if (status === 'cancelled') {
    cancelContractOrders(parseInt(req.params.id));
    // Also close out any positions from trades that happened before cancellation.
    // Each holder is refunded what they originally paid (qty × avg_price), so net P&L is zero.
    // Without this, positions linger in portfolio with no way to cash out.
    closeContractPositions(parseInt(req.params.id));
  }

  const updated = db.prepare('SELECT c.*, u.username as creator FROM contracts c LEFT JOIN users u ON c.created_by = u.id WHERE c.id = ?').get(req.params.id);
  // Only broadcast if it was visible, or is becoming visible — avoids leaking draft titles via draft→cancelled.
  const wasVisible = contract.status === 'active' || contract.status === 'resolved';
  const nowVisible = status === 'active' || status === 'resolved';
  if (wasVisible || nowVisible) {
    broadcast({ type: 'contract_updated', contract: enrichContract(updated) });
  }
  res.json({ contract: enrichContract(updated) });
});

// Manually resolve contract (admin only)
router.post('/:id/resolve', requireAdmin, (req, res) => {
  const { resolution } = req.body;
  if (!['YES', 'NO'].includes(resolution)) return res.status(400).json({ error: 'Resolution must be YES or NO' });

  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(req.params.id);
  if (!contract) return res.status(404).json({ error: 'Contract not found' });
  // Only active contracts can be resolved. Draft / cancelled / already-resolved
  // all fail with a clear reason so the admin can act on it.
  if (contract.status !== 'active') {
    return res.status(400).json({ error: `Cannot resolve a ${contract.status} contract — activate it first` });
  }

  settleContract(parseInt(req.params.id), resolution);

  const updated = db.prepare('SELECT * FROM contracts WHERE id = ?').get(req.params.id);
  res.json({ contract: updated });
});

// Price history for a contract
router.get('/:id/price-history', requireAuth, (req, res) => {
  const history = db.prepare('SELECT price, timestamp FROM price_history WHERE contract_id = ? ORDER BY timestamp ASC').all(req.params.id);
  res.json({ history });
});

// Recursively strip HTML from every string inside a condition_json payload.
// Leaves non-string values (numbers, booleans) alone.
function sanitizeCondition(obj) {
  if (obj == null) return obj;
  if (typeof obj === 'string') return stripTags(obj);
  if (Array.isArray(obj)) return obj.map(sanitizeCondition);
  if (typeof obj === 'object') {
    const out = {};
    for (const k of Object.keys(obj)) out[k] = sanitizeCondition(obj[k]);
    return out;
  }
  return obj;
}

// Close every position for a cancelled contract by refunding each holder
// the coins they paid in (qty × avg_price) and deleting the position row.
// Net P&L zero — contract cancellation should be a no-op for holders.
function closeContractPositions(contractId) {
  const positions = db.prepare('SELECT * FROM positions WHERE contract_id = ?').all(contractId);
  for (const pos of positions) {
    const refund = Math.round(pos.avg_price * pos.quantity);
    db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(refund, pos.user_id);
    db.prepare('DELETE FROM positions WHERE id = ?').run(pos.id);
    const newBalance = db.prepare('SELECT balance FROM users WHERE id = ?').get(pos.user_id).balance;
    broadcast({ type: 'balance_update', userId: pos.user_id, newBalance });
  }
}

// Cancel all open orders for a contract and refund coins
function cancelContractOrders(contractId) {
  const openOrders = db.prepare("SELECT * FROM orders WHERE contract_id = ? AND status IN ('open', 'partial')").all(contractId);
  for (const order of openOrders) {
    const remaining = order.quantity - order.quantity_filled;
    const refund = order.side === 'YES' ? remaining * order.price : remaining * (100 - order.price);
    db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(refund, order.user_id);
    db.prepare("UPDATE orders SET status = 'cancelled' WHERE id = ?").run(order.id);
    broadcast({ type: 'balance_update', userId: order.user_id, newBalance: db.prepare('SELECT balance FROM users WHERE id = ?').get(order.user_id).balance });
  }
}

// Settle a contract: pay winners, cancel open orders
function settleContract(contractId, resolution) {
  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(contractId);
  db.prepare("UPDATE contracts SET status = 'resolved', resolution = ?, resolved_at = CURRENT_TIMESTAMP WHERE id = ?").run(resolution, contractId);

  // Pay out positions
  const positions = db.prepare('SELECT * FROM positions WHERE contract_id = ?').all(contractId);
  for (const pos of positions) {
    const won = pos.side === resolution;
    if (won) {
      const payout = pos.quantity * 100;
      db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(payout, pos.user_id);
      const newBalance = db.prepare('SELECT balance FROM users WHERE id = ?').get(pos.user_id).balance;
      broadcast({ type: 'balance_update', userId: pos.user_id, newBalance });
    }
    // Fire-and-forget push to both winners and losers so they know the outcome.
    // Bots get a no-op (no subscriptions registered), so this is safe.
    const staked = Math.round(pos.avg_price * pos.quantity);
    const pnl = won ? (pos.quantity * 100 - staked) : -staked;
    pushToUser(pos.user_id, {
      title: won ? `You won 🪙 +${pnl}` : `You lost 🪙 ${pnl}`,
      body: `"${contract?.title || 'Your market'}" settled ${resolution}.`,
      url: '/portfolio',
    }).catch(() => {});
  }

  // Cancel remaining open orders and refund
  cancelContractOrders(contractId);

  broadcast({ type: 'contract_resolved', contractId, resolution });
}

module.exports = router;
module.exports.settleContract = settleContract;
