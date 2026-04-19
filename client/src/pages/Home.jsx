import { useState, useEffect } from 'react';
import { useSocket } from '../context/SocketContext';
import ContractCard from '../components/ContractCard';

const TABS = ['active', 'resolved', 'all'];

export default function Home({ openTour }) {
  const { on } = useSocket();
  const [contracts, setContracts] = useState([]);
  const [tab, setTab] = useState('active');
  const [loading, setLoading] = useState(true);

  async function load() {
    const r = await fetch('/api/contracts', { credentials: 'include' });
    const data = await r.json();
    setContracts(data.contracts || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  // Live updates
  useEffect(() => {
    const unsubs = [
      on('contract_created', (msg) => setContracts(cs => [msg.contract, ...cs])),
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
        setContracts(cs => cs.map(c => c.id === msg.contract.id ? msg.contract : c));
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
  }, [on]);

  const filtered = contracts.filter(c => {
    if (tab === 'active') return c.status === 'active';
    if (tab === 'resolved') return c.status === 'resolved';
    return true;
  });

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">

      {/* Tabs + How it works */}
      <div className="flex items-center gap-2 mb-6">
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
                ({contracts.filter(c => t === 'all' ? true : c.status === t).length})
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

      {loading && (
        <div className="text-center py-12 text-gray-400">Loading markets...</div>
      )}

      {!loading && filtered.length === 0 && (
        <div className="text-center py-12">
          <p className="text-gray-400 text-sm">No {tab} contracts</p>
          {tab === 'active' && <p className="text-gray-300 text-xs mt-1">Admin can create contracts in the Admin panel</p>}
        </div>
      )}

      <div className="space-y-3">
        {filtered.map((c, i) => <ContractCard key={c.id} contract={c} tourTarget={i === 0 && tab === 'active'} />)}
      </div>
    </div>
  );
}
