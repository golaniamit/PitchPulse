import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

/**
 * Per-user trade-by-trade history.
 * Each row: which contract, the side you ended up on, quantity, price, running cost/payout.
 */
export default function TradeHistory() {
  const { user } = useAuth();
  const [trades, setTrades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/users/trades', { credentials: 'include' });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        setTrades(d.trades || []);
      } catch (e) { setErr(e.message); }
      finally { setLoading(false); }
    })();
  }, []);

  const fmt = (ts) => {
    if (!ts) return '';
    const d = new Date(ts.replace(' ', 'T') + 'Z');
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <div className="flex items-center gap-2 mb-4">
        <Link to="/portfolio" className="text-xs font-medium text-gray-500 hover:text-navy-800 dark:text-gray-400 dark:hover:text-gray-200 transition-colors">← Portfolio</Link>
      </div>
      <h1 className="font-bold text-gray-900 dark:text-gray-100 text-xl mb-1">Trade history</h1>
      <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">Every trade you've been part of, newest first. Last 50 shown.</p>

      {loading && <p className="text-center text-gray-400 text-sm py-8">Loading…</p>}
      {err && <p className="text-center text-red-600 text-sm py-8">{err}</p>}

      {!loading && !err && trades.length === 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-8 text-center">
          <p className="text-sm text-gray-500 dark:text-gray-400">No trades yet</p>
          <Link to="/" className="text-xs text-navy-800 dark:text-blue-400 font-semibold hover:underline mt-1 inline-block">
            Go to Markets →
          </Link>
        </div>
      )}

      {trades.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
          <div className="divide-y divide-gray-50 dark:divide-gray-700">
            {trades.map(t => {
              // The endpoint marks the side *this user* ended up on; the price in the row is the trade execution price (for YES side).
              // Cost for YES buyer = quantity * price. Cost for NO buyer = quantity * (100 - price).
              const yourCost = t.side === 'YES'
                ? t.quantity * t.price
                : t.quantity * (100 - t.price);
              return (
                <Link
                  key={t.id}
                  to={`/contract/${t.contract_id}`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/40 transition-colors"
                >
                  <span className={`text-xs font-bold px-2 py-1 rounded-lg flex-shrink-0 ${
                    t.side === 'YES'
                      ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400'
                      : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400'
                  }`}>
                    {t.side}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{t.contract_title}</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500">
                      {t.quantity} × {t.side === 'YES' ? t.price : 100 - t.price}¢ · {fmt(t.executed_at)}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">🪙 {yourCost}</p>
                    <p className="text-[11px] text-gray-400">paid</p>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
