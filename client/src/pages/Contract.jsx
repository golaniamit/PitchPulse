import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { useSocket } from '../context/SocketContext';
import PriceChart from '../components/PriceChart';
import OrderBook from '../components/OrderBook';
import TradePanel from '../components/TradePanel';
import MyOpenOrders from '../components/MyOpenOrders';
import InfoTooltip from '../components/InfoTooltip';

export default function Contract() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const { on, send } = useSocket();
  const [contract, setContract] = useState(null);
  const [history, setHistory] = useState([]);
  const [book, setBook] = useState({ bids: [], asks: [] });
  const [loading, setLoading] = useState(true);
  const [showBook, setShowBook] = useState(false);
  const [showNames, setShowNames] = useState(false);
  const chartUpdateRef = useRef(null);

  async function load() {
    const [cRes, hRes, bRes] = await Promise.all([
      fetch(`/api/contracts/${id}`, { credentials: 'include' }),
      fetch(`/api/contracts/${id}/price-history`, { credentials: 'include' }),
      fetch(`/api/orders/book/${id}`, { credentials: 'include' }),
    ]);
    const [cData, hData, bData] = await Promise.all([cRes.json(), hRes.json(), bRes.json()]);
    setContract(cData.contract);
    setHistory(hData.history || []);
    setBook(bData);
    setLoading(false);
  }

  useEffect(() => {
    load();
    send({ type: 'subscribe', contractId: id });
    return () => send({ type: 'unsubscribe', contractId: id });
  }, [id]);

  // Live socket events
  useEffect(() => {
    const unsubs = [
      on('price_update', (msg) => {
        if (String(msg.contractId) !== id) return;
        setContract(c => c ? { ...c, current_price: msg.price } : c);
        chartUpdateRef.current?.(msg.price);
      }),
      on('orderbook_update', (msg) => {
        if (String(msg.contractId) !== id) return;
        setBook({ bids: msg.bids, asks: msg.asks });
        // Keep contract.best_*_bid in sync so the trade panel's
        // Buy-vs-Bid verb reflects the live book, not the stale load().
        setContract(c => c ? {
          ...c,
          best_yes_bid: msg.bids[0]?.price ?? null,
          best_no_bid:  msg.asks[0]?.price ?? null,
        } : c);
      }),
      on('contract_resolved', (msg) => {
        if (String(msg.contractId) !== id) return;
        setContract(c => c ? { ...c, status: 'resolved', resolution: msg.resolution } : c);
      }),
    ];
    return () => unsubs.forEach(fn => fn?.());
  }, [on, id]);

  const handleChartUpdate = useCallback((fn) => {
    chartUpdateRef.current = fn;
  }, []);

  if (loading) return <div className="text-center py-12 text-gray-400">Loading...</div>;
  if (!contract) return <div className="text-center py-12 text-gray-400">Contract not found</div>;

  const statusColor = {
    active: 'bg-green-100 text-green-800',
    resolved: 'bg-blue-100 text-blue-800',
    draft: 'bg-gray-100 text-gray-600',
    cancelled: 'bg-red-100 text-red-800',
  };

  const bookCount = (book.bids?.length || 0) + (book.asks?.length || 0);

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-4">
      {/* Mobile breadcrumb — not shown on sm+ since the top nav is already compact */}
      <Link
        to="/"
        className="sm:hidden inline-flex items-center gap-1 text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-navy-800 dark:hover:text-gray-200 transition-colors"
      >
        ← Markets
      </Link>

      {/* Header */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4">
        <div className="flex items-start justify-between mb-3">
          <h1 className="font-bold text-gray-900 dark:text-gray-100 text-sm leading-snug flex-1 pr-2">{contract.title}</h1>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${statusColor[contract.status]}`}>
            {contract.status}{contract.resolution ? ` · ${contract.resolution}` : ''}
          </span>
        </div>
        {contract.status === 'draft' && (
          <div className="flex items-center gap-2 py-2.5 px-3 bg-gray-50 dark:bg-gray-700/50 rounded-xl">
            <span className="text-base">🕐</span>
            <div>
              <p className="text-sm font-semibold text-gray-500 dark:text-gray-400">Market not yet open</p>
              <p className="text-xs text-gray-400 dark:text-gray-500">This contract hasn't been activated — no price data yet</p>
            </div>
          </div>
        )}
      </div>

      {/* Chart — only render for non-draft contracts */}
      {contract.status !== 'draft' && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4">
          <h2 className="text-sm font-semibold text-gray-600 dark:text-gray-400 mb-3">Price History</h2>
          <PriceChart history={history} contractId={id} onPriceUpdate={handleChartUpdate} />
        </div>
      )}

      {/* Order Book — collapsed by default to reduce visual noise for casual users */}
      <div>
        <div className="flex items-center justify-between mb-2 px-1">
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setShowBook(s => !s)}
              className="flex items-center gap-1.5 text-sm font-semibold text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 transition-colors"
            >
              <span className={`text-xs transition-transform ${showBook ? 'rotate-90' : ''}`}>▸</span>
              Order Book
              <span className="text-xs font-normal text-gray-400 dark:text-gray-500">
                ({bookCount} {bookCount === 1 ? 'order' : 'orders'})
              </span>
            </button>
            <InfoTooltip text="Live list of offers other players have placed but aren't yet matched. YES side shows people willing to bet YES at each price; NO side is the opposite. Think of it as a trading floor — nothing happens until two sides agree." />
          </div>
          {showBook && (
            <button
              onClick={() => setShowNames(s => !s)}
              className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
              title={showNames ? 'Hide usernames' : 'Show usernames'}
            >
              {showNames ? 'Hide names' : 'Show names'}
            </button>
          )}
        </div>
        {showBook && <OrderBook bids={book.bids} asks={book.asks} anonymize={!showNames} />}
      </div>

      {/* Trade Panel */}
      <TradePanel contract={contract} onTraded={load} />

      {/* Your open orders on this market — hidden when empty */}
      <MyOpenOrders contractId={id} />
    </div>
  );
}
