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

function payout(stake, price) {
  // price is cost per contract (1–99). Win = 100 per contract.
  return Math.round((stake / price) * 100);
}

export default function ContractCard({ contract, tourTarget }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [stake, setStake] = useState(100);
  const [placing, setPlacing] = useState(null);
  const [flash, setFlash] = useState(null);

  // --- Order book state ---
  const bestYes = contract.best_yes_bid ?? null; // highest YES bid in book
  const bestNo  = contract.best_no_bid  ?? null; // highest NO bid in book
  const hasTrades = contract.has_trades ?? false;

  const hasYesSide = bestYes !== null;
  const hasNoSide  = bestNo  !== null;

  // Which "state" is this active contract in?
  // A: no offers either side
  // B: offers on one side only
  // CD: offers on both sides (or trades have happened)
  const stateA  = !hasYesSide && !hasNoSide;
  const stateB  = (hasYesSide && !hasNoSide) || (!hasYesSide && hasNoSide);
  const stateCD = hasYesSide && hasNoSide;

  // Prices to use for quick-bet execution:
  // To bet YES and match a NO offer: price = 100 - bestNo
  // To bet NO and match a YES offer: price = 100 - bestYes
  const yesBetPrice = hasNoSide  ? (100 - bestNo)  : 50;
  const noBetPrice  = hasYesSide ? (100 - bestYes) : 50;

  // Sentiment bar — only show when real trades have happened
  const sentimentPrice = contract.current_price;

  async function placeBet(side, price, e) {
    e.stopPropagation();
    if (placing) return;
    setPlacing(side);
    try {
      const quantity = Math.max(1, Math.floor(stake / price));
      const r = await fetch('/api/orders', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contract_id: contract.id, side, price, quantity }),
      });
      if (r.ok) setFlash('success');
      else setFlash('error');
      setTimeout(() => setFlash(null), 1500);
    } finally {
      setPlacing(null);
    }
  }

  function goToDetail(e) {
    e.stopPropagation();
    navigate(`/contract/${contract.id}`);
  }

  return (
    <div
      data-tour={tourTarget ? 'contract-card' : undefined}
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

      {/* ── DRAFT ── */}
      {contract.status === 'draft' && (
        <div data-tour={tourTarget ? 'price-bar' : undefined} className="mb-2">
          <div className="flex items-center gap-2 py-2 px-3 bg-gray-50 dark:bg-gray-700/50 rounded-xl">
            <span className="text-sm">🕐</span>
            <span className="text-xs text-gray-400 dark:text-gray-500 font-medium">Market not yet open — no trades</span>
          </div>
        </div>
      )}

      {/* ── ACTIVE ── */}
      {contract.status === 'active' && (
        <div onClick={e => e.stopPropagation()}>

          {/* Sentiment bar — only when real trades exist */}
          {hasTrades ? (
            <div data-tour={tourTarget ? 'price-bar' : undefined} className="mb-4">
              <div className="flex justify-between items-center mb-1">
                <span className="text-xs font-medium text-gray-400 dark:text-gray-500">Market sentiment</span>
                <span className="text-xs text-gray-400 dark:text-gray-500">{sentimentPrice}% of money is on YES</span>
              </div>
              <div className="h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-yes to-yes-light rounded-full transition-all duration-500"
                  style={{ width: `${sentimentPrice}%` }}
                />
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-xs font-semibold text-yes">YES {sentimentPrice}%</span>
                <span className="text-xs font-semibold text-no">NO {100 - sentimentPrice}%</span>
              </div>
            </div>
          ) : stateCD ? (
            /* Both sides have bids but no trade yet — show the spread */
            <div data-tour={tourTarget ? 'price-bar' : undefined} className="mb-4">
              <div className="flex justify-between items-center mb-1">
                <span className="text-xs font-medium text-gray-400 dark:text-gray-500">Market forming</span>
                <span className="text-xs text-gray-400 dark:text-gray-500">no trades yet</span>
              </div>
              <div className="h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-yes to-yes-light rounded-full transition-all duration-500"
                  style={{ width: `${bestYes}%` }}
                />
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-xs font-semibold text-yes">YES @ {bestYes}</span>
                <span className="text-xs font-semibold text-no">NO @ {bestNo}</span>
              </div>
            </div>
          ) : null}

          {/* STATE A — no offers either side */}
          {stateA && (
            <div className="mb-2">
              <div className="flex items-center gap-2 py-2.5 px-3 bg-gray-50 dark:bg-gray-700/50 rounded-xl mb-3">
                <span className="text-base">🕐</span>
                <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">No offers yet — be the first to set a price</span>
              </div>
              <div className="flex gap-2 mb-2">
                <button
                  onClick={goToDetail}
                  className="flex-1 py-2.5 rounded-xl border-2 border-yes/40 bg-yes/10 text-yes hover:bg-yes/20 transition-colors text-center"
                >
                  <div className="text-sm font-bold">Bid YES</div>
                  <div className="text-xs text-yes/70 dark:text-yes mt-0.5">set your price →</div>
                </button>
                <button
                  onClick={goToDetail}
                  className="flex-1 py-2.5 rounded-xl border-2 border-no/40 bg-no/10 text-no hover:bg-no/20 transition-colors text-center"
                >
                  <div className="text-sm font-bold">Bid NO</div>
                  <div className="text-xs text-no/70 dark:text-no mt-0.5">set your price →</div>
                </button>
              </div>
              <button onClick={goToDetail} className="w-full text-center text-sm text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 py-1 transition-colors">
                + Bid at a custom price →
              </button>
            </div>
          )}

          {/* STATE B — offers on one side only */}
          {stateB && (
            <>
              <div data-tour={tourTarget ? 'stake-selector' : undefined} className="flex gap-1.5 mb-3">
                <span className="text-xs text-gray-400 self-center mr-1 flex-shrink-0">Stake</span>
                {STAKES.map(s => (
                  <button
                    key={s}
                    onClick={() => setStake(s)}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                      stake === s
                        ? 'bg-navy-800 border-navy-800 text-white'
                        : 'bg-white dark:bg-gray-700 border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-300'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                {/* YES side */}
                {hasNoSide ? (
                  <button
                    onClick={(e) => placeBet('YES', yesBetPrice, e)}
                    disabled={!!placing || stake > (user?.balance || 0)}
                    className="flex-1 rounded-xl bg-yes hover:bg-yes-light text-white text-center px-3 py-2.5 transition-colors disabled:opacity-60"
                  >
                    <div className="text-sm font-bold">Bet YES ✓</div>
                    <div className="text-xs opacity-85 mt-0.5">win 🪙 {payout(stake, yesBetPrice)} · matches NO @ {bestNo}</div>
                  </button>
                ) : (
                  <button
                    onClick={goToDetail}
                    className="flex-1 py-2.5 px-3 rounded-xl border-2 border-yes/40 bg-yes/10 text-yes hover:bg-yes/20 transition-colors text-center"
                  >
                    <div className="text-sm font-bold">Bid YES</div>
                    <div className="text-xs text-yes/70 dark:text-yes mt-0.5">set your price →</div>
                  </button>
                )}
                {/* NO side */}
                {hasYesSide ? (
                  <button
                    onClick={(e) => placeBet('NO', noBetPrice, e)}
                    disabled={!!placing || stake > (user?.balance || 0)}
                    className="flex-1 rounded-xl bg-no hover:bg-no-light text-white text-center px-3 py-2.5 transition-colors disabled:opacity-60"
                  >
                    <div className="text-sm font-bold">Bet NO ✓</div>
                    <div className="text-xs opacity-85 mt-0.5">win 🪙 {payout(stake, noBetPrice)} · matches YES @ {bestYes}</div>
                  </button>
                ) : (
                  <button
                    onClick={goToDetail}
                    className="flex-1 py-2.5 px-3 rounded-xl border-2 border-no/40 bg-no/10 text-no hover:bg-no/20 transition-colors text-center"
                  >
                    <div className="text-sm font-bold">Bid NO</div>
                    <div className="text-xs text-no/70 dark:text-no mt-0.5">set your price →</div>
                  </button>
                )}
              </div>
              <button onClick={goToDetail} className="w-full text-center text-sm text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 py-1 mt-2 transition-colors">
                + Bid at a custom price →
              </button>
            </>
          )}

          {/* STATE C/D — real market, both sides have offers */}
          {stateCD && (
            <>
              <div data-tour={tourTarget ? 'stake-selector' : undefined} className="flex gap-1.5 mb-3">
                <span className="text-xs text-gray-400 self-center mr-1 flex-shrink-0">Stake</span>
                {STAKES.map(s => (
                  <button
                    key={s}
                    onClick={() => setStake(s)}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                      stake === s
                        ? 'bg-navy-800 border-navy-800 text-white'
                        : 'bg-white dark:bg-gray-700 border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-300'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
              <div data-tour={tourTarget ? 'bet-buttons' : undefined} className="flex gap-2 mb-2">
                <button
                  data-tour={tourTarget ? 'bet-yes' : undefined}
                  onClick={(e) => placeBet('YES', yesBetPrice, e)}
                  disabled={!!placing || stake > (user?.balance || 0)}
                  className="flex-1 rounded-xl bg-yes hover:bg-yes-light text-white py-2.5 px-2 transition-colors disabled:opacity-60"
                >
                  <div className="text-sm font-bold">Bet YES</div>
                  <div className="text-xs opacity-80 mt-0.5">win 🪙 {payout(stake, yesBetPrice)}</div>
                </button>
                <button
                  data-tour={tourTarget ? 'bet-no' : undefined}
                  onClick={(e) => placeBet('NO', noBetPrice, e)}
                  disabled={!!placing || stake > (user?.balance || 0)}
                  className="flex-1 rounded-xl bg-no hover:bg-no-light text-white py-2.5 px-2 transition-colors disabled:opacity-60"
                >
                  <div className="text-sm font-bold">Bet NO</div>
                  <div className="text-xs opacity-80 mt-0.5">win 🪙 {payout(stake, noBetPrice)}</div>
                </button>
              </div>
              <button onClick={goToDetail} className="w-full text-center text-sm text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 py-1 transition-colors">
                + Bid at a custom price →
              </button>
            </>
          )}

          {/* Flash feedback */}
          {flash === 'success' && <p className="text-center text-xs text-yes font-semibold mt-2">Order placed ✓</p>}
          {flash === 'error'   && <p className="text-center text-xs text-no font-semibold mt-2">Failed — check balance</p>}
        </div>
      )}

      {/* ── RESOLVED ── */}
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
