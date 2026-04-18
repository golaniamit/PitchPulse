const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware');
const { matchOrders, getOrderBook } = require('../engine/orderBook');
const { broadcast } = require('../websocket');

const router = express.Router();

// Place an order
router.post('/', requireAuth, (req, res) => {
  const { contract_id, side, price, quantity } = req.body;

  if (!contract_id || !side || !price || !quantity) {
    return res.status(400).json({ error: 'contract_id, side, price, quantity required' });
  }
  if (!['YES', 'NO'].includes(side)) return res.status(400).json({ error: 'Side must be YES or NO' });
  if (price < 1 || price > 99) return res.status(400).json({ error: 'Price must be 1–99' });
  if (quantity < 1) return res.status(400).json({ error: 'Quantity must be at least 1' });

  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(contract_id);
  if (!contract) return res.status(404).json({ error: 'Contract not found' });
  if (contract.status !== 'active') return res.status(400).json({ error: 'Contract is not active' });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  const cost = side === 'YES' ? price * quantity : (100 - price) * quantity;

  if (user.balance < cost) return res.status(400).json({ error: 'Insufficient balance' });

  // Deduct balance (locked in order)
  db.prepare('UPDATE users SET balance = balance - ? WHERE id = ?').run(cost, user.id);

  // Insert order
  const result = db.prepare(`
    INSERT INTO orders (contract_id, user_id, side, price, quantity)
    VALUES (?, ?, ?, ?, ?)
  `).run(contract_id, user.id, side, price, quantity);

  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(result.lastInsertRowid);

  // Broadcast updated order book before matching
  const bookBefore = getOrderBook(contract_id);
  broadcast({ type: 'orderbook_update', contractId: contract_id, bids: bookBefore.bids, asks: bookBefore.asks });

  // Attempt to match
  matchOrders(contract_id);

  const newBalance = db.prepare('SELECT balance FROM users WHERE id = ?').get(user.id).balance;
  broadcast({ type: 'balance_update', userId: user.id, newBalance });

  res.status(201).json({ order, newBalance });
});

// Cancel an order
router.delete('/:id', requireAuth, (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (order.user_id !== req.session.userId) return res.status(403).json({ error: 'Not your order' });
  if (!['open', 'partial'].includes(order.status)) return res.status(400).json({ error: 'Order cannot be cancelled' });

  const remaining = order.quantity - order.quantity_filled;
  const refund = order.side === 'YES' ? remaining * order.price : remaining * (100 - order.price);

  db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(refund, order.user_id);
  db.prepare("UPDATE orders SET status = 'cancelled' WHERE id = ?").run(order.id);

  const newBalance = db.prepare('SELECT balance FROM users WHERE id = ?').get(order.user_id).balance;
  broadcast({ type: 'balance_update', userId: order.user_id, newBalance });

  const book = getOrderBook(order.contract_id);
  broadcast({ type: 'orderbook_update', contractId: order.contract_id, bids: book.bids, asks: book.asks });

  res.json({ ok: true, newBalance });
});

// Get open orders for current user
router.get('/my', requireAuth, (req, res) => {
  const orders = db.prepare(`
    SELECT o.*, c.title as contract_title FROM orders o
    JOIN contracts c ON o.contract_id = c.id
    WHERE o.user_id = ? AND o.status IN ('open', 'partial')
    ORDER BY o.created_at DESC
  `).all(req.session.userId);
  res.json({ orders });
});

// Get order book for a contract
router.get('/book/:contractId', requireAuth, (req, res) => {
  const book = getOrderBook(req.params.contractId);
  res.json(book);
});

module.exports = router;
