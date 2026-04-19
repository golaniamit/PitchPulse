import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useSocket } from '../context/SocketContext';
import PriceChart from '../components/PriceChart';
import OrderBook from '../components/OrderBook';
import TradePanel from '../components/TradePanel';

export default function Contract() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const { on, send } = useSocket();
  const [contract, setContract] = useState(null);
  const [history, setHistory] = useState([]);
  const [book, setBook] = useState({ bids: [], asks: [] });
  const [loading, setLoading] = useState(true);
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

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4">
        <div className="flex items-start justify-between mb-3">
          <h1 className="font-bold text-gray-900 dark:text-gray-100 text-sm leading-snug flex-1 pr-2">{contract.title}</h1>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${statusColor[contract.status]}`}>
            {contract.status}{contract.resolution ? ` · ${contract.resolution}` : ''}
          </span>
        </div>
        {/* Sentiment bar + big % — only show for active/resolved (drafts have no real price data) */}
        {contract.status === 'draft' ? (
          <div className="flex items-center gap-2 py-2.5 px-3 bg-gray-50 dark:bg-gray-700/50 rounded-xl">
            <span className="text-base">🕐</span>
            <div>
              <p className="text-sm font-semibold text-gray-500 dark:text-gray-400">Market not yet open</p>
              <p className="text-xs text-gray-400 dark:text-gray-500">This contract hasn't been activated — no price data yet</p>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex justify-between text-xs mb-1">
                <span className="font-semibold text-yes">YES {contract.current_price}%</span>
                <span className="font-semibold text-no">NO {100 - contract.current_price}%</span>
              </div>
              <div className="h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-yes to-yes-light rounded-full transition-all duration-500"
                  style={{ width: `${contract.current_price}%` }}
                />
              </div>
              <p className="text-xs text-gray-400 dark:text-gray-400 mt-1">Market sentiment</p>
            </div>
            <div className="text-right flex-shrink-0">
              <div className="text-3xl font-extrabold text-gray-900 dark:text-gray-100">{contract.current_price}%</div>
              <div className="text-xs text-gray-400 dark:text-gray-400">on YES</div>
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

      {/* Order Book */}
      <div>
        <h2 className="text-sm font-semibold text-gray-600 dark:text-gray-400 mb-2 px-1">Order Book</h2>
        <OrderBook bids={book.bids} asks={book.asks} />
      </div>

      {/* Trade Panel */}
      <TradePanel contract={contract} onTraded={load} />
    </div>
  );
}
