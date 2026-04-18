import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const STATUS_BADGE = {
  active: 'bg-green-100 text-green-800',
  draft: 'bg-gray-100 text-gray-600',
  resolved: 'bg-blue-100 text-blue-800',
  cancelled: 'bg-red-100 text-red-800',
};

const STAKES = [50, 100, 200, 500];

function payout(stake, prob) {
  return Math.round(stake / (prob / 100));
}

export default function ContractCard({ contract }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [stake, setStake] = useState(100);
  const [placing, setPlacing] = useState(null); // 'YES' | 'NO'
  const [flash, setFlash] = useState(null); // 'success' | 'error'

  const price = contract.current_price;
  const yesProb = price;
  const noProb = 100 - price;

  async function placeBet(side, e) {
    e.stopPropagation();
    if (placing) return;
    setPlacing(side);
    try {
      const betPrice = side === 'YES' ? yesProb : noProb;
      const qty = 1;
      // We place a single order at market price with quantity = stake / price per contract
      // Use stake as coins to spend: qty = floor(stake / betPrice)
      const quantity = Math.max(1, Math.floor(stake / betPrice));
      const r = await fetch('/api/orders', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contract_id: contract.id, side, price: betPrice, quantity }),
      });
      if (r.ok) {
        setFlash('success');
      } else {
        setFlash('error');
      }
      setTimeout(() => setFlash(null), 1500);
    } finally {
      setPlacing(null);
    }
  }

  return (
    <div
      className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-4 cursor-pointer hover:shadow-md transition-shadow"
      onClick={() => navigate(`/contract/${contract.id}`)}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 pr-2">
          <p className="font-semibold text-gray-900 dark:text-gray-100 text-sm leading-snug">{contract.title}</p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 uppercase tracking-wide">{contract.type.replace(/_/g, ' ')}</p>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${STATUS_BADGE[contract.status] || 'bg-gray-100 text-gray-600'}`}>
          {contract.status}
          {contract.status === 'resolved' && contract.resolution ? ` · ${contract.resolution}` : ''}
        </span>
      </div>

      {/* Market sentiment bar */}
      <div className="mb-4">
        <div className="flex justify-between items-center mb-1">
          <span className="text-xs font-medium text-gray-400 dark:text-gray-500">Market sentiment</span>
          <span className="text-xs text-gray-400 dark:text-gray-500">{yesProb}% of money is on YES</span>
        </div>
        <div className="h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-yes to-yes-light rounded-full transition-all duration-500"
            style={{ width: `${yesProb}%` }}
          />
        </div>
        <div className="flex justify-between mt-1">
          <span className="text-xs font-semibold text-yes">YES {yesProb}%</span>
          <span className="text-xs font-semibold text-no">NO {noProb}%</span>
        </div>
      </div>

      {/* Active contract — stake + bet buttons */}
      {contract.status === 'active' && (
        <div onClick={e => e.stopPropagation()}>
          {/* Stake chips */}
          <div className="flex gap-1.5 mb-3">
            <span className="text-xs text-gray-400 self-center mr-1 flex-shrink-0">Stake</span>
            {STAKES.map(s => (
              <button
                key={s}
                onClick={() => setStake(s)}
                className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                  stake === s
                    ? 'bg-navy-800 border-navy-800 text-white'
                    : 'bg-white dark:bg-gray-700 border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-300 hover:border-gray-300'
                }`}
              >
                {s}
              </button>
            ))}
          </div>

          {/* Bet buttons */}
          <div className="flex gap-2">
            <button
              onClick={(e) => placeBet('YES', e)}
              disabled={!!placing || stake > (user?.balance || 0)}
              className="flex-1 rounded-xl overflow-hidden bg-yes hover:bg-yes-light transition-colors disabled:opacity-60"
            >
              <div className="py-2 px-2 text-white">
                <div className="text-sm font-bold">Bet YES</div>
                <div className="text-xs opacity-80 mt-0.5">
                  win <span className="font-bold text-sm">🪙 {payout(stake, yesProb)}</span>
                </div>
              </div>
            </button>
            <button
              onClick={(e) => placeBet('NO', e)}
              disabled={!!placing || stake > (user?.balance || 0)}
              className="flex-1 rounded-xl overflow-hidden bg-no hover:bg-no-light transition-colors disabled:opacity-60"
            >
              <div className="py-2 px-2 text-white">
                <div className="text-sm font-bold">Bet NO</div>
                <div className="text-xs opacity-80 mt-0.5">
                  win <span className="font-bold text-sm">🪙 {payout(stake, noProb)}</span>
                </div>
              </div>
            </button>
          </div>

          {/* Flash feedback */}
          {flash === 'success' && (
            <p className="text-center text-xs text-yes font-semibold mt-2">Order placed ✓</p>
          )}
          {flash === 'error' && (
            <p className="text-center text-xs text-no font-semibold mt-2">Failed — check balance</p>
          )}
        </div>
      )}

      {/* Resolved card footer */}
      {contract.status === 'resolved' && (
        <div className={`text-center text-sm font-bold py-2 rounded-xl ${
          contract.resolution === 'YES' ? 'bg-yes-bg text-yes' : 'bg-no-bg text-no'
        }`}>
          Settled {contract.resolution}
        </div>
      )}
    </div>
  );
}
