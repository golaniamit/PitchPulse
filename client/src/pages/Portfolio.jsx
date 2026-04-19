import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';

export default function Portfolio() {
  const { user } = useAuth();
  const { on } = useSocket();
  const [positions, setPositions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [settling, setSettling] = useState(null);

  async function load() {
    const r = await fetch('/api/users/portfolio', { credentials: 'include' });
    const d = await r.json();
    setPositions(d.positions || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  // Refresh on live price or resolution updates
  useEffect(() => {
    const unsubs = [
      on('price_update', load),
      on('contract_resolved', load),
    ];
    return () => unsubs.forEach(fn => fn?.());
  }, [on]);

  async function settle(positionId) {
    if (settling) return;
    setSettling(positionId);
    try {
      const r = await fetch(`/api/users/positions/${positionId}/settle`, {
        method: 'POST',
        credentials: 'include',
      });
      if (r.ok) load();
    } finally {
      setSettling(null);
    }
  }

  const open = positions.filter(p => p.status === 'active');
  const resolved = positions.filter(p => p.status === 'resolved');

  // Summary numbers
  const totalStaked = open.reduce((sum, p) => sum + Math.round(p.avg_price * p.quantity), 0);
  const ifAllWin = open.reduce((sum, p) => sum + p.quantity * 100, 0);
  const ifAllLose = 0;

  if (loading) return <div className="text-center py-12 text-gray-400">Loading...</div>;

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-5">

      {/* Summary card */}
      <div data-tour="portfolio-summary" className="bg-navy-800 rounded-2xl p-5 text-white">
        <div className="flex justify-between items-start mb-4">
          <div>
            <p className="text-white/50 text-xs mb-1">Wallet balance</p>
            <p className="text-3xl font-bold">🪙 {user?.balance?.toLocaleString()}</p>
          </div>
          <div className="text-right">
            <p className="text-white/50 text-xs mb-1">Started with</p>
            <p className="text-lg font-semibold text-white/60">🪙 1,000</p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-white/10 rounded-xl p-3 text-center">
            <p className="text-green-300 font-bold text-lg">🪙 {ifAllWin.toLocaleString()}</p>
            <p className="text-white/40 text-xs mt-0.5">If all win</p>
          </div>
          <div className="bg-white/10 rounded-xl p-3 text-center">
            <p className="text-red-300 font-bold text-lg">🪙 0</p>
            <p className="text-white/40 text-xs mt-0.5">If all lose</p>
          </div>
          <div className="bg-white/10 rounded-xl p-3 text-center">
            <p className="text-white font-bold text-lg">{open.length}</p>
            <p className="text-white/40 text-xs mt-0.5">Open bets</p>
          </div>
        </div>
      </div>

      {/* Open bets */}
      <div>
        <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">My open bets</p>

        {open.length === 0 && (
          <div className="text-center py-8 text-gray-300 text-sm">
            No open bets — go place one from the Markets tab
          </div>
        )}

        {open.map(pos => {
          const staked = Math.round(pos.avg_price * pos.quantity);
          const getBack = pos.quantity * 100;
          const currentSentiment = pos.current_price; // YES %

          // Settle price for this position's side
          const settlePrice = pos.side === 'YES' ? pos.current_price : 100 - pos.current_price;
          const settleReturn = Math.round(settlePrice * pos.quantity);
          const settlePnl = settleReturn - staked;

          return (
            <div key={pos.id} className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden shadow-sm mb-3">
              {/* Card top */}
              <div className="p-4">
                <div className="flex items-start justify-between mb-3">
                  <Link to={`/contract/${pos.contract_id}`} className="flex-1 pr-2">
                    <p className="font-bold text-gray-900 dark:text-gray-100 text-base leading-snug hover:text-navy-800 dark:hover:text-blue-400 transition-colors">
                      {pos.title}
                    </p>
                  </Link>
                  <span className={`text-sm font-extrabold px-3 py-1.5 rounded-xl flex-shrink-0 ${
                    pos.side === 'YES' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                  }`}>
                    {pos.side} <span className="font-medium text-xs opacity-70">×{pos.quantity}</span>
                  </span>
                </div>

                {/* Three stat boxes */}
                <div className="grid grid-cols-3 gap-2 mb-3">
                  <div className="bg-gray-50 dark:bg-gray-700 rounded-xl p-2.5 text-center">
                    <p className="text-sm font-bold text-gray-800 dark:text-gray-100">🪙 {staked}</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">You staked</p>
                  </div>
                  <div className="bg-blue-50 dark:bg-blue-900/30 rounded-xl p-2.5 text-center">
                    <p className="text-sm font-bold text-blue-700 dark:text-blue-400">🪙 {getBack}</p>
                    <p className="text-xs text-blue-400 dark:text-blue-500 mt-0.5">If correct</p>
                  </div>
                  <div className="bg-gray-100 dark:bg-gray-700 rounded-xl p-2.5 text-center">
                    <p className="text-sm font-bold text-gray-500 dark:text-gray-400">🪙 0</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">If wrong</p>
                  </div>
                </div>

                {/* Mini sentiment bar */}
                <div>
                  <div className="flex justify-between text-xs text-gray-400 dark:text-gray-500 mb-1">
                    <span>Market sentiment</span>
                    <span>{currentSentiment}% on YES</span>
                  </div>
                  <div className="h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-yes to-yes-light rounded-full transition-all duration-500"
                      style={{ width: `${currentSentiment}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* Settle strip */}
              <div className="border-t border-gray-100 dark:border-gray-700 px-4 py-3 bg-gray-50 dark:bg-gray-750 flex items-center justify-between gap-3" style={{backgroundColor: 'inherit'}}>
                <div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Settle now → get back <span className="font-semibold text-gray-700 dark:text-gray-200">🪙 {settleReturn}</span>
                  </p>
                  <p className={`text-xs font-semibold mt-0.5 ${settlePnl >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                    {settlePnl >= 0 ? `+${settlePnl} vs what you staked` : `${settlePnl} vs what you staked`}
                  </p>
                </div>
                <button
                  onClick={() => settle(pos.id)}
                  disabled={settling === pos.id}
                  className={`flex-shrink-0 px-3 py-2 rounded-xl text-xs font-bold border transition-colors disabled:opacity-50 ${
                    settlePnl > 0
                      ? 'bg-green-50 border-green-200 text-green-700 hover:bg-green-100'
                      : settlePnl < 0
                      ? 'bg-red-50 border-red-200 text-red-600 hover:bg-red-100'
                      : 'bg-gray-100 border-gray-200 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {settling === pos.id
                    ? 'Settling...'
                    : settlePnl >= 0
                    ? `Cash out 🪙 ${settleReturn}`
                    : `Cut loss · 🪙 ${settleReturn} back`}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Settled history */}
      {resolved.length > 0 && (
        <div>
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Settled history</p>
          <div className="space-y-2">
            {resolved.map(pos => {
              const staked = Math.round(pos.avg_price * pos.quantity);
              const won = pos.side === pos.resolution;
              const finalReturn = won ? pos.quantity * 100 : 0;
              const pnl = finalReturn - staked;

              return (
                <Link key={pos.id} to={`/contract/${pos.contract_id}`}>
                  <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 px-4 py-3 flex items-center justify-between hover:border-gray-200 dark:hover:border-gray-600 transition-colors">
                    <div className="flex-1 pr-3">
                      <p className="text-sm font-medium text-gray-700 dark:text-gray-200 leading-snug">{pos.title}</p>
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                        {pos.side} ×{pos.quantity} · Settled {pos.resolution} {won ? '✓' : '✗'}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className={`font-bold text-base ${won ? 'text-green-600' : 'text-red-500'}`}>
                        {won ? `+${pnl}` : `−${staked}`} 🪙
                      </p>
                      <p className="text-xs text-gray-400">{won ? `got back ${finalReturn}` : 'nothing back'}</p>
                    </div>
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
