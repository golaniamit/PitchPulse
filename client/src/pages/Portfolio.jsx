import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { useGroup, withGroup } from '../context/GroupContext';

const SORTS = {
  // labelShort is used below sm breakpoint so three sort pills fit in a
  // 375px-wide row next to the "My open bets" heading without wrapping.
  newest:  { label: 'Newest',          labelShort: 'Newest', fn: (a, b) => b.id - a.id },
  biggest: { label: 'Biggest stake',   labelShort: 'Stake',  fn: (a, b) => (b.avg_price * b.quantity) - (a.avg_price * a.quantity) },
  upside:  { label: 'Biggest upside',  labelShort: 'Upside', fn: (a, b) => (b.quantity * 100 - b.avg_price * b.quantity) - (a.quantity * 100 - a.avg_price * a.quantity) },
};

const RECENT_DAYS = 30;

export default function Portfolio() {
  const { user } = useAuth();
  const { on } = useSocket();
  const { currentGroupId, currentGroup } = useGroup();
  const [positions, setPositions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [settling, setSettling] = useState(null);
  const [sort, setSort] = useState('newest');
  const [showArchive, setShowArchive] = useState(false);

  async function load() {
    const r = await fetch(withGroup('/api/users/portfolio', currentGroupId), { credentials: 'include' });
    const d = await r.json();
    setPositions(d.positions || []);
    setLoading(false);
  }

  useEffect(() => {
    setLoading(true);
    load();
  }, [currentGroupId]);

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

  const open = positions.filter(p => p.status === 'active').slice().sort(SORTS[sort].fn);
  const resolvedAll = positions.filter(p => p.status === 'resolved').slice().sort((a, b) => b.id - a.id);
  // Split resolved history: "Recent" = last 30 days (or no resolved_at → keep as recent),
  // "Archive" = everything older. Lives behind a toggle so the default view stays clean.
  const recentCutoff = Date.now() - RECENT_DAYS * 24 * 60 * 60_000;
  const isRecent = p => !p.resolved_at || new Date(p.resolved_at + 'Z').getTime() > recentCutoff;
  const resolvedRecent  = resolvedAll.filter(isRecent);
  const resolvedArchive = resolvedAll.filter(p => !isRecent(p));
  const resolved = showArchive ? resolvedAll : resolvedRecent;

  // Summary numbers
  const totalStaked = open.reduce((sum, p) => sum + Math.round(p.avg_price * p.quantity), 0);
  const ifAllWin = open.reduce((sum, p) => sum + p.quantity * 100, 0);
  const ifAllLose = 0;

  if (loading) return <div className="text-center py-12 text-gray-400">Loading...</div>;

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-5">

      {/* Header with link to trade history */}
      <div className="flex items-center justify-between">
        <h1 className="text-sm font-bold text-gray-400 uppercase tracking-widest">My portfolio</h1>
        <Link to="/trades" className="text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-navy-800 dark:hover:text-gray-200 transition-colors">
          Trade history →
        </Link>
      </div>

      {/* Summary card */}
      <div data-tour="portfolio-summary" className="bg-navy-800 rounded-2xl p-5 text-white">
        <div className="flex justify-between items-start mb-4">
          <div>
            <p className="text-white/50 text-xs mb-1">Wallet balance</p>
            <p className="text-3xl font-bold">🪙 {user?.balance?.toLocaleString()}</p>
          </div>
          <div className="text-right">
            <p className="text-white/50 text-xs mb-1">Started with</p>
            <p className="text-lg font-semibold text-white/60">🪙 10,000</p>
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
        <div className="flex items-end justify-between mb-3 gap-2 flex-wrap">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">My open bets</p>
          {open.length > 1 && (
            <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5">
              {Object.entries(SORTS).map(([k, s]) => (
                <button
                  key={k}
                  onClick={() => setSort(k)}
                  className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
                    sort === k
                      ? 'bg-white dark:bg-gray-700 text-navy-800 dark:text-white shadow-sm'
                      : 'text-gray-500 dark:text-gray-400'
                  }`}
                >
                  <span className="sm:hidden">{s.labelShort}</span>
                  <span className="hidden sm:inline">{s.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>

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
                    pos.side === 'YES'
                      ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400'
                      : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400'
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

                {/* Mini sentiment bar. On mobile drop the "Market sentiment"
                    left label — the right-side "N% YES" readout plus the
                    bar itself are enough, and the label was eating a row per
                    open-bet card. */}
                <div>
                  <div className="flex justify-end sm:justify-between text-xs text-gray-400 dark:text-gray-500 mb-1">
                    <span className="hidden sm:inline">Market sentiment</span>
                    <span>{currentSentiment}% <span className="hidden sm:inline">on </span>YES</span>
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
              <div className="border-t border-gray-100 dark:border-gray-700 px-4 py-3 bg-gray-50 dark:bg-gray-900/40 flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Settle now → get back <span className="font-semibold text-gray-700 dark:text-gray-200">🪙 {settleReturn}</span>
                  </p>
                  {/* "vs what you staked" is dropped on mobile — the sign
                      and the green/red colour already convey P&L direction. */}
                  <p className={`text-xs font-semibold mt-0.5 ${settlePnl >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                    {settlePnl >= 0 ? `+${settlePnl}` : `${settlePnl}`}
                    <span className="hidden sm:inline"> vs what you staked</span>
                  </p>
                </div>
                <button
                  onClick={() => settle(pos.id)}
                  disabled={settling === pos.id}
                  className={`flex-shrink-0 px-3 py-2 rounded-xl text-xs font-bold border transition-colors disabled:opacity-50 ${
                    settlePnl > 0
                      ? 'bg-green-50 border-green-200 text-green-700 hover:bg-green-100 dark:bg-green-900/30 dark:border-green-700 dark:text-green-400 dark:hover:bg-green-900/50'
                      : settlePnl < 0
                      ? 'bg-red-50 border-red-200 text-red-600 hover:bg-red-100 dark:bg-red-900/30 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/50'
                      : 'bg-gray-100 border-gray-200 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-600'
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
      {resolvedAll.length > 0 && (
        <div>
          <div className="flex items-end justify-between mb-3 gap-2 flex-wrap">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">
              Settled {showArchive ? 'history' : `· last ${RECENT_DAYS} days`}
            </p>
            <div className="flex items-center gap-3">
              <p className="text-xs text-gray-400 dark:text-gray-500">
                {(() => {
                  const won = resolved.filter(p => p.side === p.resolution).length;
                  return `${won} won · ${resolved.length - won} lost`;
                })()}
              </p>
              {resolvedArchive.length > 0 && (
                <button onClick={() => setShowArchive(s => !s)}
                        className="text-xs font-medium text-navy-800 dark:text-blue-400 hover:underline">
                  {showArchive ? 'Hide older' : `Show older (${resolvedArchive.length})`}
                </button>
              )}
            </div>
          </div>
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
