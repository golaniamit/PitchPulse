const db = require('../db');
const { broadcast } = require('../websocket');

/**
 * Core order matching engine.
 * Binary market: buyer of YES and buyer of NO are counterparties.
 * A match exists when: YES bid price + NO bid price >= 100
 * i.e., the YES buyer's price + the NO buyer's price (= 100 - YES ask price) >= 100
 *
 * Bids = YES buyers sorted descending by price
 * Asks = NO buyers (equivalent to YES sellers) sorted ascending by (100 - their price)
 * Match when: highest YES bid + highest NO bid >= 100
 *   trade price for YES buyer = their bid price
 *   trade price for NO buyer = 100 - YES bid price
 */

function getOrderBook(contractId) {
  const bids = db.prepare(`
    SELECT o.*, u.username FROM orders o
    JOIN users u ON o.user_id = u.id
    WHERE o.contract_id = ? AND o.side = 'YES' AND o.status IN ('open', 'partial')
    ORDER BY o.price DESC, o.created_at ASC
  `).all(contractId);

  const asks = db.prepare(`
    SELECT o.*, u.username FROM orders o
    JOIN users u ON o.user_id = u.id
    WHERE o.contract_id = ? AND o.side = 'NO' AND o.status IN ('open', 'partial')
    ORDER BY o.price DESC, o.created_at ASC
  `).all(contractId);

  return { bids, asks };
}

function matchOrders(contractId) {
  let tradesExecuted = 0;

  while (true) {
    // Get best YES bid (highest YES price)
    const yesBid = db.prepare(`
      SELECT * FROM orders
      WHERE contract_id = ? AND side = 'YES' AND status IN ('open', 'partial')
      ORDER BY price DESC, created_at ASC LIMIT 1
    `).get(contractId);

    if (!yesBid) break;

    // Find best NO bid from a DIFFERENT user, that is matchable
    const noBid = db.prepare(`
      SELECT * FROM orders
      WHERE contract_id = ? AND side = 'NO' AND status IN ('open', 'partial')
        AND user_id != ?
        AND (price + ?) >= 100
      ORDER BY price DESC, created_at ASC LIMIT 1
    `).get(contractId, yesBid.user_id, yesBid.price);

    if (!noBid) break;

    // Match condition: YES price + NO price >= 100 (already filtered above)
    if (yesBid.price + noBid.price < 100) break;

    // Trade at the YES bid price (maker sets price)
    const tradePrice = yesBid.created_at <= noBid.created_at ? yesBid.price : (100 - noBid.price);

    const yesRemaining = yesBid.quantity - yesBid.quantity_filled;
    const noRemaining = noBid.quantity - noBid.quantity_filled;
    const qty = Math.min(yesRemaining, noRemaining);

    // Record trade
    db.prepare(`
      INSERT INTO trades (contract_id, buyer_order_id, seller_order_id, price, quantity)
      VALUES (?, ?, ?, ?, ?)
    `).run(contractId, yesBid.id, noBid.id, tradePrice, qty);

    // Record price history
    db.prepare('INSERT INTO price_history (contract_id, price) VALUES (?, ?)').run(contractId, tradePrice);

    // Update contract current price
    db.prepare('UPDATE contracts SET current_price = ? WHERE id = ?').run(tradePrice, contractId);

    // Update YES order
    const yesNewFilled = yesBid.quantity_filled + qty;
    const yesStatus = yesNewFilled >= yesBid.quantity ? 'filled' : 'partial';
    db.prepare('UPDATE orders SET quantity_filled = ?, status = ? WHERE id = ?').run(yesNewFilled, yesStatus, yesBid.id);

    // Update NO order
    const noNewFilled = noBid.quantity_filled + qty;
    const noStatus = noNewFilled >= noBid.quantity ? 'filled' : 'partial';
    db.prepare('UPDATE orders SET quantity_filled = ?, status = ? WHERE id = ?').run(noNewFilled, noStatus, noBid.id);

    // Update positions
    upsertPosition(yesBid.user_id, contractId, 'YES', qty, tradePrice);
    upsertPosition(noBid.user_id, contractId, 'NO', qty, 100 - tradePrice);

    // Refund any overpayment if taker got a better price
    // YES buyer locked yesBid.price per contract; trade executes at tradePrice
    const yesRefund = (yesBid.price - tradePrice) * qty;
    if (yesRefund > 0) {
      db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(yesRefund, yesBid.user_id);
    }
    // NO buyer locked (100 - noBid.price) per contract; actual cost at trade = (100 - tradePrice)
    // Refund = locked - actual = (100 - noBid.price) - (100 - tradePrice) = tradePrice - noBid.price
    const noRefund = (tradePrice - noBid.price) * qty;
    if (noRefund > 0) {
      db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(noRefund, noBid.user_id);
    }

    // Broadcast events
    const yesBalance = db.prepare('SELECT balance FROM users WHERE id = ?').get(yesBid.user_id).balance;
    const noBalance = db.prepare('SELECT balance FROM users WHERE id = ?').get(noBid.user_id).balance;

    broadcast({ type: 'trade_executed', contractId, price: tradePrice, quantity: qty, timestamp: new Date().toISOString() });
    broadcast({ type: 'price_update', contractId, price: tradePrice, timestamp: new Date().toISOString() });
    broadcast({ type: 'balance_update', userId: yesBid.user_id, newBalance: yesBalance });
    broadcast({ type: 'balance_update', userId: noBid.user_id, newBalance: noBalance });

    tradesExecuted++;
  }

  if (tradesExecuted > 0) {
    const { bids, asks } = getOrderBook(contractId);
    broadcast({ type: 'orderbook_update', contractId, bids, asks });
  }

  return tradesExecuted;
}

function upsertPosition(userId, contractId, side, qty, price) {
  const existing = db.prepare('SELECT * FROM positions WHERE user_id = ? AND contract_id = ? AND side = ?').get(userId, contractId, side);
  if (existing) {
    const newQty = existing.quantity + qty;
    const newAvg = (existing.avg_price * existing.quantity + price * qty) / newQty;
    db.prepare('UPDATE positions SET quantity = ?, avg_price = ? WHERE id = ?').run(newQty, newAvg, existing.id);
  } else {
    db.prepare('INSERT INTO positions (user_id, contract_id, side, quantity, avg_price) VALUES (?, ?, ?, ?, ?)').run(userId, contractId, side, qty, price);
  }
}

module.exports = { matchOrders, getOrderBook };
