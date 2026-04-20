import { useState, useEffect } from 'react';
import { useSocket } from '../context/SocketContext';
import { useAuth } from '../context/AuthContext';
import ContractCard from '../components/ContractCard';

// "all" is only useful to admins (it's the one tab that includes drafts + cancelled).
// Regular users see Active + Resolved only.
const TABS_USER  = ['active', 'resolved'];
const TABS_ADMIN = ['active', 'resolved', 'all'];

/* ─── Dummy contracts shown during the onboarding tour ──────────────
   Two cards covering the main states users will actually encounter:
   Card 1 — fresh, no bids yet (State A)
   Card 2 — live market, both sides active with real sentiment bar     ─── */
const DEMO_CONTRACTS = [
  {
    id: 'tour-demo-1',
    title: 'Will Kohli score 50+ runs today?',
    type: 'batsman_milestone',
    status: 'active',
    current_price: 50,
    best_yes_bid: null,
    best_no_bid: null,
    has_trades: false,
    resolution: null,
    creator: 'admin',
  },
  {
    id: 'tour-demo-2',
    title: 'Will RCB hit 10+ runs in over 8?',
    type: 'runs_over',
    status: 'active',
    current_price: 68,
    best_yes_bid: 68,
    best_no_bid: 35,
    has_trades: true,
    resolution: null,
    creator: 'admin',
  },
];

export default function Home({ openTour, tourActive }) {
  const { on, send, connected } = useSocket();
  const { user } = useAuth();
  const isAdmin = !!user?.is_admin;
  const [contracts, setContracts] = useState([]);
  const [tab, setTab] = useState('active');
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const TABS = isAdmin ? TABS_ADMIN : TABS_USER;

  async function load() {
    const r = await fetch('/api/contracts', { credentials: 'include' });
    const data = await r.json();
    setContracts(dedupe(data.contracts || []));
    setLoading(false);
  }

  // Guarantees no two contracts in state share an id, regardless of WS/load races.
  function dedupe(list) {
    return [...new Map(list.map(c => [c.id, c])).values()];
  }
  // Replace or prepend a contract, keeping ids unique.
  function upsert(cs, contract) {
    const without = cs.filter(c => c.id !== contract.id);
    return [contract, ...without];
  }

  useEffect(() => {
    load();
  }, []);

  // Non-admins must not see drafts or cancelled contracts arriving via WS.
  const isVisibleStatus = (s) => s === 'active' || s === 'resolved';

  // Live updates
  useEffect(() => {
    const unsubs = [
      on('contract_created', (msg) => setContracts(cs => {
        if (!isAdmin && !isVisibleStatus(msg.contract.status)) return cs;
        return upsert(cs, msg.contract);
      })),
      on('contract_resolved', (msg) => {
        setContracts(cs => cs.map(c =>
          c.id === msg.contractId ? { ...c, status: 'resolved', resolution: msg.resolution } : c
        ));
      }),
      on('price_update', (msg) => {
        setContracts(cs => cs.map(c =>
          c.id === msg.contractId ? { ...c, current_price: msg.price, has_trades: true } : c
        ));
      }),
      on('contract_updated', (msg) => {
        setContracts(cs => {
          // Non-admin: if the new status is hidden, drop it from state (or never add).
          if (!isAdmin && !isVisibleStatus(msg.contract.status)) {
            return cs.filter(c => c.id !== msg.contract.id);
          }
          return upsert(cs, msg.contract);
        });
      }),
      on('orderbook_update', (msg) => {
        setContracts(cs => cs.map(c => {
          if (c.id !== msg.contractId) return c;
          const best_yes_bid = msg.bids.length > 0 ? msg.bids[0].price : null;
          const best_no_bid  = msg.asks.length > 0 ? msg.asks[0].price : null;
          return { ...c, best_yes_bid, best_no_bid };
        }));
      }),
    ];
    return () => unsubs.forEach(fn => fn?.());
  }, [on, isAdmin]);

  // Subscribe to price / orderbook updates for every contract on screen.
  // Re-runs when the set of contract IDs changes or the socket reconnects.
  const contractIdsKey = contracts.map(c => c.id).join('|');
  useEffect(() => {
    if (tourActive || !connected) return;
    const ids = contracts.map(c => c.id).filter(id => typeof id === 'number');
    ids.forEach(id => send({ type: 'subscribe', contractId: id }));
    return () => ids.forEach(id => send({ type: 'unsubscribe', contractId: id }));
  }, [contractIdsKey, tourActive, connected, send]);

  // ── What to display ────────────────────────────────────────────────
  // During the tour: always show the two demo cards (all 'active'),
  // ignoring the real API data. The real data keeps loading in the
  // background so the switch back is instant when the tour ends.
  const countSource = tourActive ? DEMO_CONTRACTS : contracts;
  const q = search.trim().toLowerCase();
  const displayList = tourActive
    ? DEMO_CONTRACTS
    : contracts
        .filter(c => {
          if (tab === 'active')   return c.status === 'active';
          if (tab === 'resolved') return c.status === 'resolved';
          return true;
        })
        .filter(c => !q || c.title.toLowerCase().includes(q));

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">

      {/* Tabs + Search + How it works */}
      <div className="flex items-center gap-2 mb-4">
        <div className="flex flex-1 gap-1 bg-gray-100 dark:bg-gray-800 rounded-xl p-1">
          {TABS.map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-2 rounded-lg text-sm font-semibold capitalize transition-colors ${
                tab === t ? 'bg-white dark:bg-gray-700 text-navy-800 dark:text-white shadow-sm' : 'text-gray-500 dark:text-gray-400'
              }`}
            >
              {t}
              <span className="ml-1 text-xs text-gray-400">
                ({countSource.filter(c => t === 'all' ? true : c.status === t).length})
              </span>
            </button>
          ))}
        </div>
        <button
          onClick={openTour}
          title="How it works"
          className="flex-shrink-0 w-9 h-9 rounded-xl bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors flex items-center justify-center text-sm font-bold"
        >?</button>
      </div>

      {/* Search */}
      {!tourActive && contracts.length > 2 && (
        <div className="mb-6 relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 pointer-events-none">⌕</span>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search markets…"
            className="w-full pl-8 pr-3 py-2 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-navy-800/30"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-sm"
              aria-label="Clear search"
            >✕</button>
          )}
        </div>
      )}

      {!tourActive && loading && (
        <div className="text-center py-12 text-gray-400">Loading markets...</div>
      )}

      {!tourActive && !loading && displayList.length === 0 && (
        <div className="text-center py-12">
          <p className="text-gray-400 text-sm">{q ? `No markets match "${search}"` : `No ${tab} contracts`}</p>
          {!q && tab === 'active' && <p className="text-gray-300 text-xs mt-1">Admin can create contracts in the Admin panel</p>}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {displayList.map((c, i) => (
          <ContractCard
            key={c.id}
            contract={c}
            tourTarget={tourActive ? true : (i === 0 && tab === 'active')}
          />
        ))}
      </div>
    </div>
  );
}
