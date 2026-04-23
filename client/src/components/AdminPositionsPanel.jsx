import { useEffect, useState } from 'react';

// Transparency panel shown on group-contract detail pages. Tells every member
// whether the group admin has skin in the game on this particular contract
// and which side. The data was always queryable via trades, but surfacing it
// inline removes the "did the admin bet against us and then resolve in their
// favour?" suspicion.

export default function AdminPositionsPanel({ contractId }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/contracts/${contractId}/admin-positions`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : r.json().then(x => Promise.reject(x.error || 'Error')))
      .then(d => { if (!cancelled) setData(d); })
      .catch(e => { if (!cancelled) setErr(String(e)); });
    return () => { cancelled = true; };
  }, [contractId]);

  if (err || !data) return null;
  if (!data.admin) return null;

  const hasPosition = (data.positions || []).some(p => p.quantity > 0);
  const adminName = data.admin.display_name || data.admin.username;
  const adminEmoji = data.admin.avatar_emoji || '⭐';

  return (
    <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-3 flex items-start gap-3">
      <span className="w-8 h-8 rounded-full bg-amber-100 dark:bg-amber-800 flex items-center justify-center text-sm flex-shrink-0">
        {adminEmoji}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-bold text-amber-900 dark:text-amber-200 uppercase tracking-wide">Admin's stake</p>
        {hasPosition ? (
          <div className="mt-1 flex flex-wrap gap-2">
            {data.positions.filter(p => p.quantity > 0).map((p, i) => (
              <span key={i} className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                p.side === 'YES' ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300' : 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300'
              }`}>
                {adminName}: {p.quantity} × {p.side} @ {Math.round(p.avg_price)}¢
              </span>
            ))}
          </div>
        ) : (
          <p className="text-xs text-amber-900 dark:text-amber-200 mt-0.5">
            <b>{adminName}</b> has not placed any bets on this contract.
          </p>
        )}
        <p className="text-[10px] text-amber-800 dark:text-amber-300 mt-1">
          Members can see this to audit whether the admin has a bias when resolving manually.
        </p>
      </div>
    </div>
  );
}
