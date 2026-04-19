const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware');
const { broadcast } = require('../websocket');

const router = express.Router();

// Enrich a contract row with live order book state
const bestYesBidStmt = db.prepare("SELECT MAX(price) as best FROM orders WHERE contract_id = ? AND side = 'YES' AND status IN ('open','partial')");
const bestNoBidStmt  = db.prepare("SELECT MAX(price) as best FROM orders WHERE contract_id = ? AND side = 'NO'  AND status IN ('open','partial')");
const hasTradesStmt  = db.prepare("SELECT COUNT(*) as cnt FROM trades WHERE contract_id = ?");

function enrichContract(c) {
  return {
    ...c,
    best_yes_bid: bestYesBidStmt.get(c.id)?.best ?? null,
    best_no_bid:  bestNoBidStmt.get(c.id)?.best  ?? null,
    has_trades:   hasTradesStmt.get(c.id).cnt > 0,
  };
}

// List contracts (with filter)
router.get('/', requireAuth, (req, res) => {
  const { status } = req.query;
  let query = 'SELECT c.*, u.username as creator FROM contracts c LEFT JOIN users u ON c.created_by = u.id';
  const params = [];
  if (status) {
    query += ' WHERE c.status = ?';
    params.push(status);
  }
  query += ' ORDER BY c.created_at DESC';
  const contracts = db.prepare(query).all(...params).map(enrichContract);
  res.json({ contracts });
});

// Get single contract
router.get('/:id', requireAuth, (req, res) => {
  const contract = db.prepare('SELECT c.*, u.username as creator FROM contracts c LEFT JOIN users u ON c.created_by = u.id WHERE c.id = ?').get(req.params.id);
  if (!contract) return res.status(404).json({ error: 'Contract not found' });
  res.json({ contract: enrichContract(contract) });
});

// Create contract (admin only)
router.post('/', requireAdmin, (req, res) => {
  const { title, type, condition_json, match_id, over_number, resolve_mode, status } = req.body;
  if (!title || !type) return res.status(400).json({ error: 'Title and type required' });

  const validTypes = ['runs_over', 'wicket_over', 'team_total', 'batsman_milestone', 'boundary_over', 'manual'];
  if (!validTypes.includes(type)) return res.status(400).json({ error: 'Invalid contract type' });

  const stmt = db.prepare(`
    INSERT INTO contracts (title, type, condition_json, match_id, over_number, resolve_mode, status, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    title,
    type,
    condition_json ? JSON.stringify(condition_json) : null,
    match_id || null,
    over_number || null,
    resolve_mode || 'manual',
    status || 'draft',
    req.session.userId
  );

  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(result.lastInsertRowid);

  // Add initial price history point
  db.prepare('INSERT INTO price_history (contract_id, price) VALUES (?, ?)').run(contract.id, 50);

  if (contract.status === 'active') {
    broadcast({ type: 'contract_created', contract });
  }

  res.status(201).json({ contract });
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
  }

  const updated = db.prepare('SELECT * FROM contracts WHERE id = ?').get(req.params.id);
  broadcast({ type: 'contract_updated', contract: updated });
  res.json({ contract: updated });
});

// Manually resolve contract (admin only)
router.post('/:id/resolve', requireAdmin, (req, res) => {
  const { resolution } = req.body;
  if (!['YES', 'NO'].includes(resolution)) return res.status(400).json({ error: 'Resolution must be YES or NO' });

  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(req.params.id);
  if (!contract) return res.status(404).json({ error: 'Contract not found' });
  if (contract.status === 'resolved') return res.status(400).json({ error: 'Contract already resolved' });

  settleContract(parseInt(req.params.id), resolution);

  const updated = db.prepare('SELECT * FROM contracts WHERE id = ?').get(req.params.id);
  res.json({ contract: updated });
});

// Price history for a contract
router.get('/:id/price-history', requireAuth, (req, res) => {
  const history = db.prepare('SELECT price, timestamp FROM price_history WHERE contract_id = ? ORDER BY timestamp ASC').all(req.params.id);
  res.json({ history });
});

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
  db.prepare("UPDATE contracts SET status = 'resolved', resolution = ?, resolved_at = CURRENT_TIMESTAMP WHERE id = ?").run(resolution, contractId);

  // Pay out positions
  const positions = db.prepare('SELECT * FROM positions WHERE contract_id = ?').all(contractId);
  for (const pos of positions) {
    if (pos.side === resolution) {
      const payout = pos.quantity * 100;
      db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(payout, pos.user_id);
      const newBalance = db.prepare('SELECT balance FROM users WHERE id = ?').get(pos.user_id).balance;
      broadcast({ type: 'balance_update', userId: pos.user_id, newBalance });
    }
  }

  // Cancel remaining open orders and refund
  cancelContractOrders(contractId);

  broadcast({ type: 'contract_resolved', contractId, resolution });
}

module.exports = router;
module.exports.settleContract = settleContract;
