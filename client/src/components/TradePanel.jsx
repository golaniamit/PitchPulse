import { useState } from 'react';
import { useAuth } from '../context/AuthContext';

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
      setSuccess(`Order placed! Balance: 🪙 ${data.newBalance}`);
      onTraded?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  if (contract.status !== 'active') {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4 text-center text-sm text-gray-400 dark:text-gray-500">
        Contract is {contract.status}
        {contract.resolution ? ` · Settled ${contract.resolution}` : ''}
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

      {/* Price */}
      <div>
        <div className="flex justify-between items-center mb-2">
          <label className="text-xs text-gray-500 dark:text-gray-400 font-medium">Price (1–99)</label>
          <div className="w-14 text-center font-bold text-navy-800 dark:text-gray-100 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg py-1.5 text-sm">
            {price}
          </div>
        </div>
        <input
          type="range" min={1} max={99} value={price}
          onChange={e => setPrice(+e.target.value)}
          className="w-full h-2 accent-navy-800 cursor-pointer"
        />
      </div>

      {/* Quantity */}
      <div>
        <label className="text-xs text-gray-500 dark:text-gray-400 font-medium block mb-1">Quantity</label>
        <div className="flex items-center gap-2">
          <button onClick={() => setQuantity(q => Math.max(1, q - 1))} className="w-8 h-8 rounded-lg border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 font-bold">−</button>
          <input
            type="number" min={1} value={quantity}
            onChange={e => setQuantity(Math.max(1, +e.target.value))}
            className="flex-1 text-center border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-lg py-1.5 text-sm font-semibold"
          />
          <button onClick={() => setQuantity(q => q + 1)} className="w-8 h-8 rounded-lg border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 font-bold">+</button>
        </div>
      </div>

      {/* P&L preview */}
      <div className="bg-gray-50 dark:bg-gray-700 rounded-xl p-3 text-sm space-y-1">
        <div className="flex justify-between">
          <span className="text-gray-500 dark:text-gray-400">Cost</span>
          <span className="font-semibold dark:text-gray-100">🪙 {cost}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500 dark:text-gray-400">If {side} wins</span>
          <span className="font-semibold text-yes">+{pnlIfWin} 🪙</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500 dark:text-gray-400">If {side} loses</span>
          <span className="font-semibold text-no">{pnlIfLose} 🪙</span>
        </div>
        <div className="flex justify-between border-t border-gray-200 dark:border-gray-600 pt-1 mt-1">
          <span className="text-gray-500 dark:text-gray-400">Balance after</span>
          <span className={`font-semibold ${user.balance - cost < 0 ? 'text-no' : 'dark:text-gray-100'}`}>
            🪙 {user.balance - cost}
          </span>
        </div>
      </div>

      {error && <p className="text-red-600 text-sm">{error}</p>}
      {success && <p className="text-green-600 text-sm">{success}</p>}

      <button
        onClick={submit}
        disabled={loading || cost > user.balance}
        className={`w-full py-3 rounded-xl text-white font-bold text-sm transition-colors disabled:opacity-50 ${side === 'YES' ? 'bg-yes hover:bg-yes-light' : 'bg-no hover:bg-no-light'}`}
      >
        {loading ? 'Placing...' : `Buy ${side} · 🪙 ${cost}`}
      </button>
    </div>
  );
}
