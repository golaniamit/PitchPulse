import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import InfoTooltip from './InfoTooltip';

export default function TradePanel({ contract, onTraded }) {
  const { user } = useAuth();
  const [side, setSide] = useState('YES');
  const [price, setPrice] = useState(contract?.current_price || 50);
  const [quantity, setQuantity] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const cost = side === 'YES' ? price * quantity : (100 - price) * quantity;
  const ifYes = side === 'YES' ? quantity * 100 : 0;
  const ifNo = side === 'NO' ? quantity * 100 : 0;
  const pnlIfWin = (side === 'YES' ? ifYes : ifNo) - cost;
  const pnlIfLose = -cost;

  // "Buy" if this order would cross the book (immediate fill, at least partial).
  // "Bid" if it would just rest waiting for a counterparty.
  // A YES at P matches a NO at Q when P + Q >= 100 (and vice versa).
  const bestOppositeBid = side === 'YES' ? contract?.best_no_bid : contract?.best_yes_bid;
  const wouldMatch = bestOppositeBid != null && (price + bestOppositeBid >= 100);
  const verb = wouldMatch ? 'Buy' : 'Bid';

  async function submit() {
    setError(''); setSuccess('');
    if (cost > user.balance) { setError('Insufficient balance'); return; }
    setLoading(true);
    try {
      const r = await fetch('/api/orders', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contract_id: contract.id, side, price, quantity }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      // Square-off happens when the new order would cross the user's own
      // resting orders on the opposite side — we cancel those instead of
      // self-trading, and only place what's left (if anything).
      const squared = data.squared_off || [];
      const squaredQty = squared.reduce((s, x) => s + x.cancelled_qty, 0);
      if (squaredQty > 0 && !data.order) {
        setSuccess(`Squared off ${squaredQty} of your own ${squared[0].side} @ ${squared[0].price}¢. No new order placed.`);
      } else if (squaredQty > 0 && data.order) {
        setSuccess(`Squared off ${squaredQty} of your own ${squared[0].side} @ ${squared[0].price}¢ and placed ${data.order.quantity} × ${side} @ ${price}¢.`);
      } else {
        setSuccess(`Order placed! Balance: 🪙 ${data.newBalance}`);
      }
      onTraded?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  if (contract.status !== 'active') {
    const messages = {
      draft: { icon: '🕐', title: 'Not yet open for trading', sub: 'The admin will activate this market soon' },
      resolved: { icon: contract.resolution === 'YES' ? '✅' : '❌', title: `Settled ${contract.resolution}`, sub: 'This market has closed' },
      cancelled: { icon: '🚫', title: 'Cancelled', sub: 'This market was cancelled' },
    };
    const msg = messages[contract.status] || { icon: '⏸', title: `Contract is ${contract.status}`, sub: '' };
    return (
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5 text-center space-y-1">
        <div className="text-2xl">{msg.icon}</div>
        <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">{msg.title}</p>
        {msg.sub && <p className="text-xs text-gray-400 dark:text-gray-500">{msg.sub}</p>}
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4 space-y-4">
      <h3 className="font-semibold text-gray-800 dark:text-gray-100">Place Order</h3>

      {/* Side toggle */}
      <div className="flex rounded-xl overflow-hidden border border-gray-200 dark:border-gray-600">
        <button
          className={`flex-1 py-2.5 text-sm font-bold transition-colors ${side === 'YES' ? 'bg-yes text-white' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
          onClick={() => { setSide('YES'); setPrice(contract.current_price); }}
        >YES</button>
        <button
          className={`flex-1 py-2.5 text-sm font-bold transition-colors ${side === 'NO' ? 'bg-no text-white' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
          onClick={() => { setSide('NO'); setPrice(100 - contract.current_price); }}
        >NO</button>
      </div>

      {/* Price slider + "Cost per contract"
          Mobile: label and value stacked above the slider (full-width slider).
          Desktop (sm+): value + label flush right of the slider on a single row. */}
      <div>
        {/* Mobile-only header: label left, value right, above the slider */}
        <div className="sm:hidden flex items-baseline justify-between mb-2">
          <span className="text-sm font-semibold text-gray-600 dark:text-gray-300 flex items-center gap-1">
            Cost per contract
            <InfoTooltip text="The price you're willing to pay per contract, from 1–99. It doubles as the probability you're betting at — price 42 means you think this has a 42% chance of happening. You win 🪙 100 per contract if correct." />
          </span>
          <span className="text-2xl font-bold text-navy-800 dark:text-gray-100 tabular-nums">
            🪙 {price}
          </span>
        </div>
        <div className="flex items-center gap-5">
          <input
            type="range" min={1} max={99} value={price}
            onChange={e => setPrice(+e.target.value)}
            className="flex-1 h-2 accent-navy-800 cursor-pointer"
          />
          {/* Desktop-only right-hand value + label */}
          <div className="hidden sm:flex items-center gap-2 flex-shrink-0">
            <span className="text-2xl font-bold text-navy-800 dark:text-gray-100 tabular-nums">
              🪙 {price}
            </span>
            <span className="text-xs text-gray-500 dark:text-gray-400 font-medium leading-tight max-w-[80px] flex items-center gap-1">
              Cost per contract
              <InfoTooltip text="The price you're willing to pay per contract, from 1–99. It doubles as the probability you're betting at — price 42 means you think this has a 42% chance of happening. You win 🪙 100 per contract if correct." />
            </span>
          </div>
        </div>
      </div>

      {/* Quantity
          Mobile: label on its own line, stepper full-width below.
          Desktop (sm+): label + stepper on a single row. */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
        <label className="text-sm text-gray-600 dark:text-gray-300 font-semibold sm:flex-shrink-0">Quantity</label>
        <div className="flex items-center gap-2 flex-1">
          <button onClick={() => setQuantity(q => Math.max(1, q - 1))} className="w-8 h-8 rounded-lg border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 font-bold">−</button>
          <input
            type="number" min={1} value={quantity}
            onChange={e => setQuantity(Math.max(1, +e.target.value))}
            className="flex-1 text-center border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-lg py-1.5 text-base font-semibold tabular-nums"
          />
          <button onClick={() => setQuantity(q => q + 1)} className="w-8 h-8 rounded-lg border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 font-bold">+</button>
        </div>
      </div>

      {/* P&L preview — Cost is the hero number, outcomes are supporting rows */}
      <div className="bg-gray-50 dark:bg-gray-700 rounded-xl p-4 space-y-2">
        <div className="flex justify-between items-baseline">
          <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">Cost</span>
          <span className="text-2xl font-extrabold text-navy-800 dark:text-gray-100 tabular-nums">🪙 {cost}</span>
        </div>
        <div className="flex justify-between text-xs pt-2 border-t border-gray-200 dark:border-gray-600">
          <span className="text-gray-500 dark:text-gray-400">if {side} wins</span>
          <span className="font-semibold text-yes tabular-nums">+{pnlIfWin} 🪙</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-gray-500 dark:text-gray-400">if {side} loses</span>
          <span className="font-semibold text-no tabular-nums">{pnlIfLose} 🪙</span>
        </div>
      </div>

      {error && <p className="text-red-600 text-sm">{error}</p>}
      {success && <p className="text-green-600 text-sm">{success}</p>}

      <button
        onClick={submit}
        disabled={loading || cost > user.balance}
        className={`w-full py-3 rounded-xl text-white font-bold text-sm transition-colors disabled:opacity-50 ${side === 'YES' ? 'bg-yes hover:bg-yes-light' : 'bg-no hover:bg-no-light'}`}
      >
        {loading ? 'Placing...' : `${verb} ${side} · 🪙 ${cost}`}
      </button>
    </div>
  );
}
