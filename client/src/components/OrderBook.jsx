export default function OrderBook({ bids = [], asks = [] }) {
  const maxBidSize = Math.max(...bids.map(b => b.quantity - b.quantity_filled), 1);
  const maxAskSize = Math.max(...asks.map(a => a.quantity - a.quantity_filled), 1);

  const Row = ({ order, side }) => {
    const remaining = order.quantity - order.quantity_filled;
    const isYes = side === 'YES';
    const pct = Math.round((remaining / (isYes ? maxBidSize : maxAskSize)) * 100);
    return (
      <div className="relative flex items-center text-xs py-1 px-2">
        <div
          className={`absolute inset-0 opacity-10 ${isYes ? 'bg-yes' : 'bg-no'}`}
          style={{ width: `${pct}%`, ...(isYes ? { right: 0, left: 'auto' } : {}) }}
        />
        {isYes ? (
          <>
            <span className="hidden sm:block flex-1 text-gray-400 dark:text-gray-500 truncate">{order.username || 'anon'}</span>
            <span className="flex-1 sm:flex-none text-gray-500 dark:text-gray-400 w-6 text-right">{remaining}</span>
            <span className="font-semibold text-yes w-8 text-right">{order.price}¢</span>
          </>
        ) : (
          <>
            <span className="font-semibold text-no w-8">{order.price}¢</span>
            <span className="flex-1 sm:flex-none text-gray-500 dark:text-gray-400 w-6 text-right">{remaining}</span>
            <span className="hidden sm:block flex-1 text-right text-gray-400 dark:text-gray-500 truncate">{order.username || 'anon'}</span>
          </>
        )}
      </div>
    );
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
      {/* Header */}
      <div className="flex text-xs font-semibold px-2 py-2 border-b border-gray-100 dark:border-gray-700">
        <div className="flex-1">
          <span className="text-yes font-bold">↑ YES bids</span>
          <div className="flex mt-0.5 text-gray-300 dark:text-gray-600">
            <span className="hidden sm:block flex-1">user</span>
            <span className="flex-1 sm:flex-none text-right w-6">qty</span>
            <span className="w-8 text-right">price</span>
          </div>
        </div>
        <div className="w-px bg-gray-100 dark:bg-gray-700 mx-2" />
        <div className="flex-1 text-right">
          <span className="text-no font-bold">↓ NO bids</span>
          <div className="flex mt-0.5 text-gray-300 dark:text-gray-600 justify-end">
            <span className="w-8">price</span>
            <span className="flex-1 sm:flex-none text-right w-6">qty</span>
            <span className="hidden sm:block flex-1 text-right">user</span>
          </div>
        </div>
      </div>

      <div className="flex">
        <div className="flex-1 min-h-[100px]">
          {bids.slice(0, 6).map(b => <Row key={b.id} order={b} side="YES" />)}
          {bids.length === 0 && <p className="text-xs text-gray-300 dark:text-gray-600 p-3 text-center">No bids</p>}
        </div>
        <div className="w-px bg-gray-100 dark:bg-gray-700" />
        <div className="flex-1">
          {asks.slice(0, 6).map(a => <Row key={a.id} order={a} side="NO" />)}
          {asks.length === 0 && <p className="text-xs text-gray-300 dark:text-gray-600 p-3 text-center">No asks</p>}
        </div>
      </div>
    </div>
  );
}
