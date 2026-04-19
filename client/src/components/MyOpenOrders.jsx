import { useState, useEffect, useCallback } from 'react';
import { useSocket } from '../context/SocketContext';

export default function MyOpenOrders({ contractId }) {
  const { on } = useSocket();
  const [orders, setOrders] = useState([]);
  const [cancelling, setCancelling] = useState(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/orders/my', { credentials: 'include' });
      const d = await r.json();
      setOrders((d.orders || []).filter(o => String(o.contract_id) === String(contractId)));
    } catch { /* ignore */ }
  }, [contractId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const unsubs = [
      on('orderbook_update', (msg) => { if (String(msg.contractId) === String(contractId)) load(); }),
      on('trade_executed', (msg) => { if (String(msg.contractId) === String(contractId)) load(); }),
    ];
    return () => unsubs.forEach(fn => fn?.());
  }, [on, contractId, load]);

  async function cancel(orderId) {
    setCancelling(orderId);
    try {
      await fetch(`/api/orders/${orderId}`, { method: 'DELETE', credentials: 'include' });
      load();
    } catch { /* ignore */ } finally {
      setCancelling(null);
    }
  }

  if (orders.length === 0) return null;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-blue-200 dark:border-blue-800 overflow-hidden">
      <div className="px-3 py-2 bg-blue-50 dark:bg-blue-900/20 flex items-center justify-between">
        <p className="text-xs font-bold uppercase tracking-wide text-blue-900 dark:text-blue-200">Your open orders</p>
        <span className="text-[10px] text-blue-700 dark:text-blue-300 font-semibold">{orders.length} on this market</span>
      </div>
      <div className="divide-y divide-gray-100 dark:divide-gray-700">
        {orders.map(o => {
          const remaining = o.quantity - o.quantity_filled;
          const locked = remaining * (o.side === 'YES' ? o.price : 100 - o.price);
          return (
            <div key={o.id} className="flex items-center justify-between px-3 py-2.5">
              <div>
                <p className="text-sm font-semibold dark:text-gray-100">
                  <span className={o.side === 'YES' ? 'text-yes' : 'text-no'}>{o.side}</span>
                  {' '}@ {o.price}¢ <span className="text-gray-400 font-normal">× {remaining}</span>
                </p>
                <p className="text-xs text-gray-400 dark:text-gray-500">🪙 {locked} locked</p>
              </div>
              <button
                onClick={() => cancel(o.id)}
                disabled={cancelling === o.id}
                className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-red-50 dark:hover:bg-red-900/30 hover:text-red-600 text-sm font-bold transition-colors disabled:opacity-50"
                title="Cancel this order"
                aria-label="Cancel order"
              >
                {cancelling === o.id ? '…' : '✕'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
