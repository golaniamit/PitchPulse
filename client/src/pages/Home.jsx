import { useState, useEffect, useMemo } from 'react';
import { useSocket } from '../context/SocketContext';
import { useAuth } from '../context/AuthContext';
import ContractCard from '../components/ContractCard';

/* ─── Dummy contracts shown during the onboarding tour ────────────── */
const DEMO_CONTRACTS = [
  {
    id: 'tour-demo-1',
    title: 'Will Kohli score 50+ runs today?',
    type: 'batsman_milestone',
    status: 'active',
    current_price: 50,
    best_yes_bid: null, best_no_bid: null, has_trades: false, resolution: null,
    creator: 'admin',
  },
  {
    id: 'tour-demo-2',
    title: 'Will RCB hit 10+ runs in over 8?',
    type: 'runs_over',
    status: 'active',
    current_price: 68,
    best_yes_bid: 68, best_no_bid: 35, has_trades: true, resolution: null,
    creator: 'admin',
  },
];

// Sort options for the dropdown. Keys map to reducer functions applied to the
// filtered list. Keep to 4 — more feels like clutter.
const SORTS = {
  newest:     { label: 'Newest',            fn: (a, b) => (b.id || 0) - (a.id || 0) },
  traded:     { label: 'Most traded',       fn: (a, b) => (b.volume || 0) - (a.volume || 0) },
  traders:    { label: 'Most traders',      fn: (a, b) => (b.trader_count || 0) - (a.trader_count || 0) },
  resolving:  { label: 'Closest to resolve', fn: (a, b) => {
    // over contracts first (by ascending over), then by_over, then match.
    const rank = c => {
      if (c.phase === 'over') return 1000 + (c.over_number || 99);
      if (c.phase === 'by_over' || c.phase === 'powerplay' || c.phase === 'death') return 2000 + (c.over_number || 99);
      if (c.phase === 'match') return 3000;
      if (c.phase === 'season') return 9000;
      return 4000;
    };
    return rank(a) - rank(b);
  }},
};

// Group contract types into filter buckets. Less overwhelming than listing all 17.
const TYPE_BUCKETS = {
  runs:       ['runs_over', 'team_total', 'runs_powerplay', 'runs_death', 'innings_score'],
  wickets:    ['wicket_over', 'team_wickets_by_over', 'wickets_powerplay', 'wickets_death', 'bowler_wickets_by_over'],
  boundaries: ['boundary_over', 'boundaries_powerplay', 'boundaries_death'],
  player:     ['batsman_milestone', 'bowler_wickets_by_over', 'player_match_stat'],
  winner:     ['match_winner', 'toss_winner', 'season_team_finish', 'season_team_wins_title'],
};

export default function Home({ openTour, tourActive }) {
  const { on, send, connected } = useSocket();
  const { user } = useAuth();
  const isAdmin = !!user?.is_admin;
  const [contracts, setContracts] = useState([]);
  const [liveMatches, setLiveMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState('all');
  const [sort, setSort] = useState('newest');
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterMatch, setFilterMatch] = useState('all');
  const [filterType, setFilterType] = useState('all');

  async function load() {
    const r = await fetch('/api/contracts', { credentials: 'include' });
    const data = await r.json();
    setContracts(dedupe(data.contracts || []));
    setLoading(false);
  }
  async function loadLive() {
    try {
      const r = await fetch('/api/matches/live', { credentials: 'include' });
      if (!r.ok) return;
      const data = await r.json();
      setLiveMatches(data.matches || []);
    } catch { /* ignore */ }
  }

  function dedupe(list) { return [...new Map(list.map(c => [c.id, c])).values()]; }
  function upsert(cs, contract) { return [contract, ...cs.filter(c => c.id !== contract.id)]; }

  useEffect(() => {
    load();
    loadLive();
    const id = setInterval(loadLive, 60_000); // refresh live-match state once a minute
    return () => clearInterval(id);
  }, []);

  const isVisibleStatus = (s) => s === 'active' || s === 'resolved';

  // Live WebSocket updates
  useEffect(() => {
    const unsubs = [
      on('contract_created', (msg) => setContracts(cs => {
        if (!isAdmin && !isVisibleStatus(msg.contract.status)) return cs;
        return upsert(cs, msg.contract);
      })),
      on('contract_resolved', (msg) => setContracts(cs => cs.map(c =>
        c.id === msg.contractId ? { ...c, status: 'resolved', resolution: msg.resolution } : c
      ))),
      on('price_update', (msg) => setContracts(cs => cs.map(c =>
        c.id === msg.contractId ? { ...c, current_price: msg.price, has_trades: true } : c
      ))),
      on('contract_updated', (msg) => setContracts(cs => {
        if (!isAdmin && !isVisibleStatus(msg.contract.status)) return cs.filter(c => c.id !== msg.contract.id);
        return upsert(cs, msg.contract);
      })),
      on('orderbook_update', (msg) => setContracts(cs => cs.map(c => {
        if (c.id !== msg.contractId) return c;
        const best_yes_bid = msg.bids.length > 0 ? msg.bids[0].price : null;
        const best_no_bid  = msg.asks.length > 0 ? msg.asks[0].price : null;
        return { ...c, best_yes_bid, best_no_bid };
      }))),
    ];
    return () => unsubs.forEach(fn => fn?.());
  }, [on, isAdmin]);

  // Subscribe to price / orderbook updates for every visible contract
  const contractIdsKey = contracts.map(c => c.id).join('|');
  useEffect(() => {
    if (tourActive || !connected) return;
    const ids = contracts.map(c => c.id).filter(id => typeof id === 'number');
    ids.forEach(id => send({ type: 'subscribe', contractId: id }));
    return () => ids.forEach(id => send({ type: 'unsubscribe', contractId: id }));
  }, [contractIdsKey, tourActive, connected, send]);

  // ── Derived UI state ────────────────────────────────────────────────

  // Set of match IDs currently in progress. Drives the "Live" tab filter.
  const liveMatchIds = useMemo(() => new Set((liveMatches || []).map(m => String(m.matchId))), [liveMatches]);

  // Human label for the Live tab — single match shows teams, multi shows count,
  // zero shows a neutral "Live" label (tab is still clickable but empty).
  const liveLabel = useMemo(() => {
    const liveContracts = contracts.filter(c => c.match_id && liveMatchIds.has(String(c.match_id)));
    if (liveContracts.length === 0 || liveMatches.length === 0) return null;
    // Pick the first live match that has contracts tagged to it
    for (const m of liveMatches) {
      if (liveContracts.some(c => String(c.match_id) === String(m.matchId))) {
        const teams = (m.teams || []).map(t => t.shortName).filter(Boolean).join(' vs ');
        return teams || 'Match';
      }
    }
    return 'Match';
  }, [contracts, liveMatches, liveMatchIds]);

  // Tab-level buckets (counts shown on each tab label). "All" excludes resolved
  // so the default view stays tradeable-only; resolved contracts live behind
  // their own tab.
  const tabBuckets = useMemo(() => {
    const buckets = { all: [], live: [], season: [], resolved: [] };
    for (const c of contracts) {
      if (c.status === 'active') buckets.all.push(c);
      if (c.match_id && liveMatchIds.has(String(c.match_id)) && c.status === 'active') buckets.live.push(c);
      if (c.phase === 'season' && c.status === 'active') buckets.season.push(c);
      if (c.status === 'resolved') buckets.resolved.push(c);
    }
    return buckets;
  }, [contracts, liveMatchIds]);

  // Distinct match_ids present across all contracts (for the Match filter dropdown)
  const matchOptions = useMemo(() => {
    const map = new Map();
    for (const c of contracts) {
      if (!c.match_id) continue;
      if (map.has(c.match_id)) continue;
      const live = liveMatches.find(m => String(m.matchId) === String(c.match_id));
      const label = live ? (live.teams || []).map(t => t.shortName).filter(Boolean).join(' vs ') : `Match #${c.match_id}`;
      map.set(c.match_id, label);
    }
    return [...map.entries()].map(([id, label]) => ({ id, label }));
  }, [contracts, liveMatches]);

  // ── Display list (tab → filters → sort → search) ────────────────────
  const q = search.trim().toLowerCase();
  const displayList = useMemo(() => {
    if (tourActive) return DEMO_CONTRACTS;
    let list = tabBuckets[tab] || [];
    if (filterMatch !== 'all')       list = list.filter(c => String(c.match_id) === String(filterMatch));
    if (filterType !== 'all' && TYPE_BUCKETS[filterType]) {
      const bucket = new Set(TYPE_BUCKETS[filterType]);
      list = list.filter(c => bucket.has(c.type));
    }
    if (q) list = list.filter(c => c.title.toLowerCase().includes(q));
    return list.slice().sort(SORTS[sort].fn);
  }, [tourActive, tabBuckets, tab, filterMatch, filterType, sort, q]);

  // Subtitle rule: Live tab shows team shortnames when a match is in progress,
  // everyone else shows their count. Keeps line-2 content uniform in length.
  const tabDefs = [
    { id: 'all',      label: 'All',       subtitle: `(${tabBuckets.all.length})` },
    { id: 'live',     label: 'Live',      subtitle: liveLabel || `(${tabBuckets.live.length})`, accent: !!liveLabel },
    { id: 'season',   label: 'Season',    subtitle: `(${tabBuckets.season.length})` },
    { id: 'resolved', label: 'Resolved',  subtitle: `(${tabBuckets.resolved.length})` },
  ];

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">

      {/* Tabs — pill container so each tab flexes to equal width on any screen */}
      <div className="flex items-stretch gap-2 mb-3">
        <div className="flex-1 flex items-stretch gap-1 bg-gray-100 dark:bg-gray-800 rounded-xl p-1">
          {tabDefs.map(t => {
            const active = tab === t.id;
            const labelHighlight = t.id === 'live' && t.accent;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex-1 min-w-0 flex flex-col items-center justify-center leading-tight py-1.5 px-2 rounded-lg transition-colors ${
                  active
                    ? 'bg-white dark:bg-gray-700 shadow-sm text-navy-800 dark:text-white'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                }`}
              >
                <span className={`text-[11px] uppercase tracking-wide font-semibold flex items-center gap-1 ${
                  labelHighlight ? 'text-red-600' : ''
                }`}>
                  {labelHighlight && <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />}
                  {t.label}
                </span>
                <span className={`text-xs font-normal truncate max-w-full ${active ? 'text-gray-700 dark:text-gray-200' : 'text-gray-400'}`}>
                  {t.subtitle}
                </span>
              </button>
            );
          })}
        </div>
        <button
          onClick={openTour}
          title="How it works"
          className="flex-shrink-0 w-9 self-center h-9 rounded-xl bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors flex items-center justify-center text-sm font-bold"
        >?</button>
      </div>

      {/* Sort + filter — compact inline toolbar, right-aligned. Minimal footprint. */}
      {!tourActive && (
        <div className="flex items-center justify-end gap-3 mb-3 text-xs">
          <label className="flex items-center gap-1 text-gray-500 dark:text-gray-400">
            <span className="font-semibold">Sort:</span>
            <select
              value={sort} onChange={e => setSort(e.target.value)}
              className="bg-transparent text-navy-800 dark:text-white font-semibold focus:outline-none cursor-pointer border-none -mx-1"
            >
              {Object.entries(SORTS).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
            </select>
          </label>
          <button
            onClick={() => setFilterOpen(o => !o)}
            className={`px-2 py-1 rounded-md flex items-center gap-1 transition-colors ${
              filterOpen || filterMatch !== 'all' || filterType !== 'all' || search
                ? 'bg-navy-800 text-white dark:bg-white dark:text-navy-800'
                : 'text-gray-500 hover:text-navy-800 dark:text-gray-400 dark:hover:text-white'
            }`}
            aria-label="Filter markets"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
            <span>Filter{(filterMatch !== 'all' || filterType !== 'all' || search) ? ' · on' : ''}</span>
          </button>
        </div>
      )}

      {/* Filter panel (collapsible). Search lives inside so the default view
          isn't cluttered with an always-on search bar. */}
      {!tourActive && filterOpen && (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3 mb-3 space-y-3">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 pointer-events-none text-sm">⌕</span>
            <input
              type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search markets…"
              className="w-full pl-8 pr-8 py-1.5 rounded-md bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-navy-800/30"
            />
            {search && (
              <button onClick={() => setSearch('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-sm"
                      aria-label="Clear search">✕</button>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1">Match</p>
              <select value={filterMatch} onChange={e => setFilterMatch(e.target.value)}
                      className="w-full text-sm border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md px-2 py-1.5">
                <option value="all">All matches</option>
                {matchOptions.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </div>
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1">Type</p>
              <select value={filterType} onChange={e => setFilterType(e.target.value)}
                      className="w-full text-sm border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md px-2 py-1.5">
                <option value="all">All types</option>
                <option value="runs">Runs</option>
                <option value="wickets">Wickets</option>
                <option value="boundaries">Boundaries</option>
                <option value="player">Batsman / bowler</option>
                <option value="winner">Match / toss winner</option>
              </select>
            </div>
          </div>
          {(filterMatch !== 'all' || filterType !== 'all' || search) && (
            <button onClick={() => { setFilterMatch('all'); setFilterType('all'); setSearch(''); }}
                    className="text-xs text-gray-500 dark:text-gray-400 hover:text-navy-800 dark:hover:text-white">
              Reset filters
            </button>
          )}
        </div>
      )}

      {!tourActive && loading && (
        <div className="text-center py-12 text-gray-400">Loading markets...</div>
      )}

      {!tourActive && !loading && displayList.length === 0 && (
        <div className="text-center py-12">
          <p className="text-gray-400 text-sm">
            {q ? `No markets match "${search}"` :
             tab === 'live' ? 'No contracts for the current live match' :
             tab === 'season' ? 'No season contracts yet' :
             tab === 'resolved' ? 'No resolved contracts in the recent window' :
             'No contracts'}
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {displayList.map((c, i) => (
          <ContractCard
            key={c.id}
            contract={c}
            tourTarget={tourActive ? true : (i === 0 && tab === 'all')}
          />
        ))}
      </div>
    </div>
  );
}
