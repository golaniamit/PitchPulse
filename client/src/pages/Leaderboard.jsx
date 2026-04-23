import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { useGroup } from '../context/GroupContext';

export default function Leaderboard() {
  const { user } = useAuth();
  const { on } = useSocket();
  const { currentGroupId, currentGroup } = useGroup();
  const [leaders, setLeaders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState('all');

  async function load(p = period) {
    // Route by context: inside a group → /api/groups/:id/leaderboard, else
    // the public endpoint. Shape is identical so the render code reuses it.
    const url = currentGroupId
      ? `/api/groups/${currentGroupId}/leaderboard?period=${p}&group=${currentGroupId}`
      : `/api/users/leaderboard?period=${p}`;
    const r = await fetch(url, { credentials: 'include' });
    const data = await r.json();
    setLeaders(data.leaderboard || []);
    setLoading(false);
  }

  useEffect(() => { setLoading(true); load(period); }, [period, currentGroupId]);

  // Refresh on balance updates
  useEffect(() => {
    const unsub = on('balance_update', () => load(period));
    return unsub;
  }, [on, period]);

  const medals = ['🥇', '🥈', '🥉'];

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
        <div className="p-4 border-b border-gray-100 dark:border-gray-700">
          <div className="flex items-start justify-between mb-3 gap-3">
            <div>
              <h1 className="font-bold text-gray-900 dark:text-gray-100">
                {currentGroup ? `${currentGroup.name} · Leaderboard` : 'Leaderboard'}
              </h1>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                Starting balance: 🪙 {(currentGroup?.starting_coins ?? 10000).toLocaleString()}
              </p>
            </div>
          </div>
          {/* Period tabs */}
          <div className="flex gap-1 bg-gray-100 dark:bg-gray-900 rounded-xl p-1">
            {[
              ['all',   'All-time'],
              ['today', 'Today'],
            ].map(([key, label]) => (
              <button
                key={key}
                onClick={() => setPeriod(key)}
                className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  period === key
                    ? 'bg-white dark:bg-gray-700 text-navy-800 dark:text-white shadow-sm'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {loading && <div className="text-center py-8 text-gray-400 text-sm">Loading…</div>}

        {!loading && leaders.length === 0 && (
          <div className="text-center py-8 text-gray-400 text-sm">No rankings yet</div>
        )}

        <div className="divide-y divide-gray-50 dark:divide-gray-700">
          {leaders.map((u, i) => {
            const isMe = u.id === user?.id;
            const pnl = period === 'today' ? u.pnl_today : u.pnl_all;
            const displayName = u.display_name || u.username;
            return (
              <div key={u.id} className={`flex items-center px-4 py-3 gap-3 ${isMe ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}>
                <span className="text-lg w-7 text-center">{medals[i] || `${i + 1}`}</span>
                <span className="text-xl" aria-hidden>{u.avatar_emoji || '👤'}</span>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-semibold truncate ${isMe ? 'text-blue-700 dark:text-blue-400' : 'text-gray-900 dark:text-gray-100'}`}>
                    {displayName} {isMe && <span className="text-xs font-normal text-blue-500">(you)</span>}
                  </p>
                  <p className="text-xs text-gray-400 dark:text-gray-500">{u.trade_count} trade{u.trade_count === 1 ? '' : 's'}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="font-bold text-gray-900 dark:text-gray-100">🪙 {u.balance.toLocaleString()}</p>
                  {/* Period suffix ("today" / "all-time") is desktop-only —
                      on mobile the period tab at the top of the card already
                      says which window the PnL is against, and repeating it
                      next to every row added clutter without new info. */}
                  <p className={`text-xs font-medium ${pnl > 0 ? 'text-yes' : pnl < 0 ? 'text-no' : 'text-gray-400'}`}>
                    {pnl > 0 ? '+' : ''}{pnl}
                    <span className="hidden sm:inline text-gray-400 dark:text-gray-500 font-normal ml-1">{period === 'today' ? 'today' : 'all-time'}</span>
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
