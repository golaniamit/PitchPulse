const express = require('express');
const db = require('../db');
const { requireAuth, rateLimit } = require('../middleware');
const { matchOrders, getOrderBook } = require('../engine/orderBook');
const { broadcast } = require('../websocket');

const router = express.Router();

// Rate limits — protect the matching engine and WS broadcast loop from a
// buggy client or mischief. Balances already bound real-money abuse.
const placeLimiter  = rateLimit({ windowMs: 60_000, max: 60,  name: 'orders' });
const cancelLimiter = rateLimit({ windowMs: 60_000, max: 120, name: 'cancels' });

// Place an order
router.post('/', requireAuth, placeLimiter, (req, res) => {
  const { contract_id, side, price, quantity } = req.body;

  // Presence check uses `== null` (not `!x`) so that price=0 or quantity=0
  // falls through to the bounds check below with a clear message, rather
  // than being reported as "missing".
  if (contract_id == null || side == null || price == null || quantity == null) {
    return res.status(400).json({ error: 'contract_id, side, price, quantity required' });
  }
  if (!['YES', 'NO'].includes(side)) return res.status(400).json({ error: 'Side must be YES or NO' });
  if (!Number.isInteger(price) || price < 1 || price > 99) {
    return res.status(400).json({ error: 'Price must be a whole number from 1 to 99' });
  }
  if (!Number.isInteger(quantity) || quantity < 1) {
    return res.status(400).json({ error: 'Quantity must be a whole number ≥ 1' });
  }

  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(contract_id);
  if (!contract) return res.status(404).json({ error: 'Contract not found' });
  if (contract.status !== 'active') return res.status(400).json({ error: 'Contract is not active' });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);

  // Square-off: cancel user's own resting orders on the opposite side that
  // would be crossed by this new order (price + resting > 100). Without this,
  // the user would lock coins on both sides on an overlapping position that
  // the engine refuses to self-match — i.e. a waste.
  const oppositeSide = side === 'YES' ? 'NO' : 'YES';
  const crossingOrders = db.prepare(`
    SELECT * FROM orders
    WHERE contract_id = ? AND user_id = ? AND side = ?
      AND status IN ('open', 'partial')
      AND (price + ?) >= 100
    ORDER BY price DESC, created_at ASC
  `).all(contract_id, user.id, oppositeSide, price);

  // First pass: plan the cancellations without touching the DB, so we can
  // validate balance against the post-square-off state before mutating.
  let remainingQty = quantity;
  let plannedRefund = 0;
  const plan = [];
  for (const r of crossingOrders) {
    if (remainingQty <= 0) break;
    const resting = r.quantity - r.quantity_filled;
    const cancelQty = Math.min(resting, remainingQty);
    const pricePerUnit = r.side === 'YES' ? r.price : (100 - r.price);
    plannedRefund += cancelQty * pricePerUnit;
    plan.push({ order: r, cancelQty, fullCancel: cancelQty >= resting });
    remainingQty -= cancelQty;
  }

  const costForRemainder = side === 'YES' ? price * remainingQty : (100 - price) * remainingQty;
  if (user.balance + plannedRefund < costForRemainder) {
    return res.status(400).json({ error: 'Insufficient balance' });
  }

  // Execute the planned cancellations.
  const squaredOff = [];
  for (const p of plan) {
    const { order: r, cancelQty, fullCancel } = p;
    const refund = cancelQty * (r.side === 'YES' ? r.price : (100 - r.price));
    db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(refund, user.id);
    if (fullCancel) {
      db.prepare("UPDATE orders SET status = 'cancelled' WHERE id = ?").run(r.id);
    } else {
      db.prepare('UPDATE orders SET quantity = ? WHERE id = ?').run(r.quantity - cancelQty, r.id);
    }
    squaredOff.push({ order_id: r.id, side: r.side, price: r.price, cancelled_qty: cancelQty });
  }

  // If the new order is fully absorbed by square-offs, don't register it as a bet.
  if (remainingQty <= 0) {
    const newBalance = db.prepare('SELECT balance FROM users WHERE id = ?').get(user.id).balance;
    broadcast({ type: 'balance_update', userId: user.id, newBalance });
    const book = getOrderBook(contract_id);
    broadcast({ type: 'orderbook_update', contractId: contract_id, bids: book.bids, asks: book.asks });
    return res.status(200).json({ squared_off: squaredOff, order: null, newBalance });
  }

  // Deduct balance (locked in order) for the remaining quantity
  db.prepare('UPDATE users SET balance = balance - ? WHERE id = ?').run(costForRemainder, user.id);

  // Insert order
  const result = db.prepare(`
    INSERT INTO orders (contract_id, user_id, side, price, quantity)
    VALUES (?, ?, ?, ?, ?)
  `).run(contract_id, user.id, side, price, remainingQty);

  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(result.lastInsertRowid);

  // Broadcast updated order book before matching
  const bookBefore = getOrderBook(contract_id);
  broadcast({ type: 'orderbook_update', contractId: contract_id, bids: bookBefore.bids, asks: bookBefore.asks });

  // Attempt to match
  matchOrders(contract_id);

  const newBalance = db.prepare('SELECT balance FROM users WHERE id = ?').get(user.id).balance;
  broadcast({ type: 'balance_update', userId: user.id, newBalance });

  res.status(201).json({ order, newBalance, squared_off: squaredOff });
});

// Cancel an order
router.delete('/:id', requireAuth, cancelLimiter, (req, res) => {
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
