const db = require('../db');
const { broadcast } = require('../websocket');
const { adjustBalance, readBalance, groupIdForContract } = require('../lib/context');

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
  // All refunds + balance broadcasts for this contract flow to the correct
  // wallet (public users.balance or group_members.balance). Resolved once
  // up front — groupId never changes mid-match.
  const gid = groupIdForContract(contractId);

  while (true) {
    // Find the best matchable pair directly.
    // Price-time priority: highest YES price first, then highest NO price, then oldest orders.
    // Excludes self-matches and requires YES price + NO price >= 100.
    const pair = db.prepare(`
      SELECT
        y.id AS y_id, y.user_id AS y_user, y.price AS y_price,
        y.quantity AS y_qty, y.quantity_filled AS y_filled, y.created_at AS y_created,
        n.id AS n_id, n.user_id AS n_user, n.price AS n_price,
        n.quantity AS n_qty, n.quantity_filled AS n_filled, n.created_at AS n_created
      FROM orders y
      JOIN orders n
        ON n.contract_id = y.contract_id
        AND n.side = 'NO'
        AND n.status IN ('open', 'partial')
        AND n.user_id != y.user_id
        AND (y.price + n.price) >= 100
      WHERE y.contract_id = ? AND y.side = 'YES' AND y.status IN ('open', 'partial')
      ORDER BY y.price DESC, n.price DESC, y.created_at ASC, n.created_at ASC
      LIMIT 1
    `).get(contractId);

    if (!pair) break;

    const yesBid = {
      id: pair.y_id, user_id: pair.y_user, price: pair.y_price,
      quantity: pair.y_qty, quantity_filled: pair.y_filled, created_at: pair.y_created,
    };
    const noBid = {
      id: pair.n_id, user_id: pair.n_user, price: pair.n_price,
      quantity: pair.n_qty, quantity_filled: pair.n_filled, created_at: pair.n_created,
    };

    // Trade at the maker's price (whoever was resting in the book first)
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

    // Refund any overpayment if taker got a better price.
    // YES buyer locked yesBid.price per contract; trade executes at tradePrice.
    const yesRefund = (yesBid.price - tradePrice) * qty;
    if (yesRefund > 0) adjustBalance(yesBid.user_id, gid, yesRefund);
    // NO buyer locked (100 - noBid.price) per contract; actual cost at trade = (100 - tradePrice).
    // Refund = locked - actual = (100 - noBid.price) - (100 - tradePrice) = tradePrice - noBid.price.
    const noRefund = (tradePrice - noBid.price) * qty;
    if (noRefund > 0) adjustBalance(noBid.user_id, gid, noRefund);

    // Broadcast events. All messages carry groupId so the client can filter
    // events that don't belong to its currently-selected context.
    const yesBalance = readBalance(yesBid.user_id, gid);
    const noBalance  = readBalance(noBid.user_id, gid);

    broadcast({ type: 'trade_executed', contractId, price: tradePrice, quantity: qty, timestamp: new Date().toISOString(), groupId: gid });
    broadcast({ type: 'price_update', contractId, price: tradePrice, timestamp: new Date().toISOString(), groupId: gid });
    broadcast({ type: 'balance_update', userId: yesBid.user_id, newBalance: yesBalance, groupId: gid });
    broadcast({ type: 'balance_update', userId: noBid.user_id, newBalance: noBalance, groupId: gid });

    tradesExecuted++;
  }

  if (tradesExecuted > 0) {
    const { bids, asks } = getOrderBook(contractId);
    broadcast({ type: 'orderbook_update', contractId, bids, asks, groupId: gid });
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
