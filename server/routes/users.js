const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware');

const router = express.Router();

// Get portfolio (positions)
router.get('/portfolio', requireAuth, (req, res) => {
  const positions = db.prepare(`
    SELECT p.*, c.title, c.status, c.resolution, c.current_price, c.type
    FROM positions p
    JOIN contracts c ON p.contract_id = c.id
    WHERE p.user_id = ?
    ORDER BY c.created_at DESC
  `).all(req.session.userId);
  res.json({ positions });
});

// Get leaderboard
router.get('/leaderboard', requireAuth, (req, res) => {
  const users = db.prepare(`
    SELECT u.id, u.username, u.balance,
      u.balance - 10000 as pnl,
      (SELECT COUNT(*) FROM trades t
        JOIN orders o ON (t.buyer_order_id = o.id OR t.seller_order_id = o.id)
        WHERE o.user_id = u.id) as trade_count
    FROM users u
    WHERE u.is_bot = 0
    ORDER BY u.balance DESC
  `).all();
  res.json({ leaderboard: users });
});

// Settle a position at current market price (active contracts only)
router.post('/positions/:id/settle', requireAuth, (req, res) => {
  const position = db.prepare(`
    SELECT p.*, c.current_price, c.status
    FROM positions p
    JOIN contracts c ON p.contract_id = c.id
    WHERE p.id = ? AND p.user_id = ?
  `).get(req.params.id, req.session.userId);

  if (!position) return res.status(404).json({ error: 'Position not found' });
  if (position.status !== 'active') return res.status(400).json({ error: 'Can only settle active contracts' });

  const settlePrice = position.side === 'YES'
    ? position.current_price
    : 100 - position.current_price;

  const payout = Math.round(settlePrice * position.quantity);

  // Remove position and refund settle value
  db.prepare('DELETE FROM positions WHERE id = ?').run(position.id);
  db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(payout, req.session.userId);

  const newBalance = db.prepare('SELECT balance FROM users WHERE id = ?').get(req.session.userId).balance;

  const { broadcast } = require('../websocket');
  broadcast({ type: 'balance_update', userId: req.session.userId, newBalance });

  res.json({ payout, newBalance });
});

// Get user's trade history
router.get('/trades', requireAuth, (req, res) => {
  const trades = db.prepare(`
    SELECT t.*, c.title as contract_title,
      CASE WHEN o_yes.user_id = ? THEN 'YES' ELSE 'NO' END as side
    FROM trades t
    JOIN contracts c ON t.contract_id = c.id
    JOIN orders o_yes ON t.buyer_order_id = o_yes.id
    JOIN orders o_no ON t.seller_order_id = o_no.id
    WHERE o_yes.user_id = ? OR o_no.user_id = ?
    ORDER BY t.executed_at DESC
    LIMIT 50
  `).all(req.session.userId, req.session.userId, req.session.userId);
  res.json({ trades });
});

module.exports = router;
