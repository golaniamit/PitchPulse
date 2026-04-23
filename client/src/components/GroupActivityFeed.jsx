import { useEffect, useState } from 'react';
import { useSocket } from '../context/SocketContext';

// Group activity feed — small rail that lives on the Markets page when the
// user is inside a group. Shows joins, contract posts, trades, wins/losses,
// and resolutions. Polls once on mount + auto-refreshes on any relevant
// WebSocket event so it feels live without hammering the server.
//
// Derived entirely from existing tables on the server; there's no dedicated
// events table. Keeps the data source small and avoids a write on every
// trade.

function timeAgo(ts) {
  if (!ts) return '';
  const diffMs = Date.now() - new Date(ts + 'Z').getTime();
  const s = Math.max(1, Math.round(diffMs / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

function Event({ ev }) {
  // Shared avatar slot — coloured bubble with emoji/initials. User-attributed
  // events show the member; contract-attributed events show a neutral icon.
  const avatar = (() => {
    if (ev.avatar_emoji) return <span>{ev.avatar_emoji}</span>;
    if (ev.username) return <span>{(ev.display_name || ev.username)[0].toUpperCase()}</span>;
    if (ev.kind === 'resolution') return <span>⚖️</span>;
    return <span>•</span>;
  })();
  const name = ev.display_name || ev.username;
  switch (ev.kind) {
    case 'join':
      return (
        <Row avatar={avatar} ts={ev.ts} color="bg-pink-100 dark:bg-pink-900/40">
          <p className="text-slate-700 dark:text-gray-200 leading-snug"><b>{name}</b> joined the group</p>
        </Row>
      );
    case 'contract_created':
      return (
        <Row avatar={<span>📝</span>} ts={ev.ts} color="bg-amber-100 dark:bg-amber-900/40">
          <p className="text-slate-700 dark:text-gray-200 leading-snug"><b>{name}</b> posted a new contract</p>
          <p className="text-slate-500 dark:text-gray-400 text-[11px] truncate italic">"{ev.contract_title}"</p>
        </Row>
      );
    case 'trade':
      return (
        <Row avatar={avatar} ts={ev.ts} color="bg-green-100 dark:bg-green-900/40">
          <p className="text-slate-700 dark:text-gray-200 leading-snug">
            <b>{name}</b> bought <b>{ev.qty}×{ev.side} @ {ev.price}¢</b>
          </p>
          <p className="text-slate-500 dark:text-gray-400 text-[11px] truncate italic">"{ev.contract_title}"</p>
        </Row>
      );
    case 'resolution':
      return (
        <Row avatar={<span>⚖️</span>} ts={ev.ts} color="bg-blue-100 dark:bg-blue-900/40">
          <p className="text-slate-700 dark:text-gray-200 leading-snug">
            Contract resolved
            {' → '}
            <span className={ev.resolution === 'YES' ? 'text-green-700 dark:text-green-400 font-semibold' : 'text-red-700 dark:text-red-400 font-semibold'}>
              {ev.resolution}
            </span>
          </p>
          <p className="text-slate-500 dark:text-gray-400 text-[11px] truncate italic">"{ev.contract_title}"</p>
        </Row>
      );
    default:
      return null;
  }
}

function Row({ avatar, color, ts, children }) {
  return (
    <div className="flex items-start gap-2 text-xs">
      <span className={`w-7 h-7 rounded-full flex items-center justify-center text-sm flex-shrink-0 ${color}`}>
        {avatar}
      </span>
      <div className="flex-1 min-w-0">
        {children}
        <p className="text-slate-400 dark:text-gray-500 text-[10px] mt-0.5">{timeAgo(ts)}</p>
      </div>
    </div>
  );
}

export default function GroupActivityFeed({ groupId }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  // Mobile-only — default shows just the top 3 events so the card doesn't
  // push contracts below the fold. "Show all" expands to the full 20.
  // Desktop always shows 20 via CSS (no state needed there).
  const [mobileExpanded, setMobileExpanded] = useState(false);
  const { on } = useSocket();

  async function load() {
    try {
      const r = await fetch(`/api/groups/${groupId}/activity?group=${groupId}&limit=20`, { credentials: 'include' });
      if (!r.ok) return;
      const d = await r.json();
      setEvents(d.activity || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!groupId) return;
    setLoading(true);
    load();
    // Refresh on any group-scoped WS event. Cheap — backend pulls from
    // existing tables, no write.
    const refresh = (msg) => { if ((msg?.groupId ?? null) === groupId) load(); };
    const unsubs = [
      on('contract_created', refresh),
      on('contract_resolved', refresh),
      on('trade_executed', refresh),
      on('group_reset', refresh),
    ];
    return () => unsubs.forEach(fn => fn?.());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  if (!groupId) return null;

  // Mobile: render only the first 3 events by default, all up to 20 when
  // expanded. Desktop is unaffected — always shows up to 20.
  const mobileLimit = mobileExpanded ? 20 : 3;
  const desktopLimit = 20;
  const visibleOnMobile = events.slice(0, mobileLimit);
  const extraOnDesktop = events.slice(mobileLimit, desktopLimit);
  const hasMoreOnMobile = events.length > 3;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-slate-100 dark:border-gray-700 p-3 sm:p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-2">
          Recent activity
          <span className="text-[10px] font-normal text-slate-400">live</span>
        </p>
      </div>
      {loading ? (
        <p className="text-xs text-slate-400">Loading…</p>
      ) : events.length === 0 ? (
        <p className="text-xs text-slate-400">Nothing's happened yet. Invite friends and post some contracts.</p>
      ) : (
        <>
          <div className="space-y-3">
            {visibleOnMobile.map((ev, i) => <Event key={i} ev={ev} />)}
            {/* Desktop-only: any events beyond the mobile's 3-row default
                render here so desktop keeps its full 20-row view. */}
            {extraOnDesktop.length > 0 && (
              <div className="hidden sm:contents space-y-3">
                {extraOnDesktop.map((ev, i) => <Event key={`d-${i}`} ev={ev} />)}
              </div>
            )}
          </div>
          {hasMoreOnMobile && (
            <button
              onClick={() => setMobileExpanded(e => !e)}
              className="sm:hidden mt-3 text-[11px] font-semibold text-navy-800 dark:text-blue-400 hover:underline"
            >
              {mobileExpanded ? 'Show less' : `Show all (${events.length})`}
            </button>
          )}
        </>
      )}
    </div>
  );
}
