import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';

export default function Leaderboard() {
  const { user } = useAuth();
  const { on } = useSocket();
  const [leaders, setLeaders] = useState([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    const r = await fetch('/api/users/leaderboard', { credentials: 'include' });
    const data = await r.json();
    setLeaders(data.leaderboard || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // Refresh leaderboard on balance updates
    const unsub = on('balance_update', () => load());
    return unsub;
  }, [on]);

  const medals = ['🥇', '🥈', '🥉'];

  if (loading) return <div className="text-center py-12 text-gray-400">Loading...</div>;

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
        <div className="p-4 border-b border-gray-100 dark:border-gray-700">
          <h1 className="font-bold text-gray-900 dark:text-gray-100">Leaderboard</h1>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Starting balance: 🪙 10,000</p>
        </div>

        <div className="divide-y divide-gray-50 dark:divide-gray-700">
          {leaders.map((u, i) => {
            const isMe = u.id === user?.id;
            const pnl = u.balance - 10000;
            return (
              <div key={u.id} className={`flex items-center px-4 py-3 gap-3 ${isMe ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}>
                <span className="text-lg w-7 text-center">{medals[i] || `${i + 1}`}</span>
                <div className="flex-1">
                  <p className={`text-sm font-semibold ${isMe ? 'text-blue-700 dark:text-blue-400' : 'text-gray-900 dark:text-gray-100'}`}>
                    {u.username} {isMe && <span className="text-xs font-normal text-blue-500">(you)</span>}
                  </p>
                  <p className="text-xs text-gray-400 dark:text-gray-500">{u.trade_count} trades</p>
                </div>
                <div className="text-right">
                  <p className="font-bold text-gray-900 dark:text-gray-100">🪙 {u.balance.toLocaleString()}</p>
                  <p className={`text-xs font-medium ${pnl >= 0 ? 'text-yes' : 'text-no'}`}>
                    {pnl >= 0 ? '+' : ''}{pnl}
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
