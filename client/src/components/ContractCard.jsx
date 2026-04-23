import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const STAKES = [50, 100, 200, 500];

// Human labels per contract type — shown in the meta row above the question.
export const TYPE_META = {
  // original
  runs_over:               'Runs in over',
  wicket_over:             'Wickets in over',
  team_total:              'Team total',
  batsman_milestone:       'Batsman milestone',
  boundary_over:           'Boundaries in over',
  manual:                  'Custom',
  // earlier additions
  toss_winner:             'Toss winner',
  match_winner:            'Match winner',
  player_match_stat:       'Player · match',
  // by_over
  team_wickets_by_over:    'Team wickets',
  bowler_wickets_by_over:  'Bowler wickets',
  // powerplay
  runs_powerplay:          'Runs · powerplay',
  wickets_powerplay:       'Wickets · powerplay',
  boundaries_powerplay:    'Boundaries · powerplay',
  // death
  runs_death:              'Runs · death overs',
  wickets_death:           'Wickets · death overs',
  boundaries_death:        'Boundaries · death overs',
  // match
  innings_score:           'Innings score',
  // per-phase custom
  custom_over:             'Custom · over',
  custom_by_over:          'Custom · by over',
  custom_powerplay:        'Custom · powerplay',
  custom_death:            'Custom · death overs',
  custom_match:            'Custom · match',
  // season-long
  season_team_finish:      'Season · team finish',
  season_team_wins_title:  'Season · title winner',
  season_player_runs:      'Season · player runs',
  season_player_wickets:   'Season · player wickets',
  custom_season:           'Custom · season',
};

function payout(stake, price) {
  // price is cost per contract (1–99). Win = 100 per contract.
  return Math.round((stake / price) * 100);
}

// ── Slot sub-components ─────────────────────────────────────────────
// LEFT slot: the "who" — team crest / player headshot+tick / vs-layout / generic bubble.

function TeamLogo({ team }) {
  if (!team) return null;
  return (
    <div className="w-14 h-14 rounded-xl bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 flex items-center justify-center p-1.5 shrink-0">
      <img src={team.logo_path} alt={team.short_code} className="max-w-full max-h-full object-contain" />
    </div>
  );
}

function PlayerInitialsAvatar({ name, size = 56, bg = '#1a1a2e' }) {
  const initials = String(name || '?').split(/\s+/).map(w => w[0]).filter(Boolean).slice(0, 3).join('').toUpperCase();
  return (
    <div
      className="rounded-full flex items-center justify-center font-extrabold text-white"
      style={{ width: size, height: size, background: bg, fontSize: Math.round(size * 0.32) }}
    >
      {initials}
    </div>
  );
}

function PlayerHead({ player }) {
  const ring = player.team_colour || '#1a1a2e';
  const head = player.headshot_path ? (
    <img
      src={player.headshot_path}
      alt={player.name}
      className="w-14 h-14 rounded-full object-cover border-2 border-white dark:border-gray-800"
      style={{ objectPosition: 'center top' }}
    />
  ) : (
    <PlayerInitialsAvatar name={player.name} size={56} bg={ring} />
  );
  return (
    <div className="relative shrink-0">
      <div className="rounded-full p-[2px]" style={{ background: ring }}>{head}</div>
      {player.team_logo && (
        <div className="absolute -bottom-1 -right-1 w-[22px] h-[22px] rounded-md bg-white dark:bg-gray-800 border-2 border-white dark:border-gray-800 shadow flex items-center justify-center p-0.5">
          <img src={player.team_logo} alt={player.team_short} className="max-w-full max-h-full object-contain" />
        </div>
      )}
    </div>
  );
}

function VsLayout({ a, b }) {
  return (
    <div className="relative shrink-0" style={{ width: 56, height: 56 }}>
      <div className="absolute top-0 left-0 w-[34px] h-[34px] rounded-lg bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 flex items-center justify-center p-0.5">
        <img src={a.logo_path} alt={a.short_code} className="max-w-full max-h-full object-contain" />
      </div>
      <div className="absolute bottom-0 right-0 w-[34px] h-[34px] rounded-lg bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 flex items-center justify-center p-0.5">
        <img src={b.logo_path} alt={b.short_code} className="max-w-full max-h-full object-contain" />
      </div>
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[18px] h-[18px] rounded-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 text-[9px] font-black text-navy-900 dark:text-gray-100 flex items-center justify-center z-10">vs</div>
    </div>
  );
}

function GenericBubble() {
  return (
    <div className="w-14 h-14 rounded-full bg-navy-800 text-white flex items-center justify-center text-xl font-black shrink-0">?</div>
  );
}

export function SubjectSlot({ contract }) {
  const { subject_kind, team, opponent, player } = contract;

  if (subject_kind === 'player' && player)   return <PlayerHead player={player} />;
  if (subject_kind === 'matchup'  && team && opponent) return <VsLayout a={team} b={opponent} />;
  if (subject_kind === 'match_generic') {
    if (team && opponent) return <VsLayout a={team} b={opponent} />;
    if (team)             return <TeamLogo team={team} />;
    return <GenericBubble />;
  }
  if (subject_kind === 'team' && team) return <TeamLogo team={team} />;

  // Fallbacks for contracts missing proper subject data
  if (player) return <PlayerHead player={player} />;
  if (team)   return <TeamLogo team={team} />;
  return <GenericBubble />;
}

// ── RIGHT slot: OVER / BY OV / TOSS / MATCH / CUSTOM context badge ─
const CoinSvg = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
    <circle cx="12" cy="12" r="9"/><path d="M9 12h6M12 9v6"/>
  </svg>
);
const CalSvg = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
    <path d="M8 3v4M16 3v4M3 10h18M5 6h14a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z"/>
  </svg>
);

const TrophySvg = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
    <path d="M6 3h12v4a6 6 0 0 1-12 0V3z"/><path d="M6 5H3a2 2 0 0 0 2 3h1M18 5h3a2 2 0 0 1-2 3h-1"/><path d="M9 14h6M12 14v4M8 21h8"/>
  </svg>
);

export function ContextBadge({ contract }) {
  const { phase, over_number, innings_number, season_code } = contract;

  // Numeric over badges. Number falls back to "—" so the live preview shows
  // a real OVER badge while admin is still typing the number.
  if (phase === 'over') {
    return (
      <div className="w-14 h-14 rounded-xl flex flex-col items-center justify-center shrink-0" style={{ background: '#1a1a2e' }}>
        <span className="text-[9px] tracking-[0.12em] font-bold text-gray-400 leading-none">OVER</span>
        <span className="text-[22px] font-black text-white font-mono leading-none mt-1">{over_number || '—'}</span>
      </div>
    );
  }
  if (phase === 'by_over') {
    return (
      <div className="w-14 h-14 rounded-xl flex flex-col items-center justify-center shrink-0" style={{ background: '#1a1a2e' }}>
        <span className="text-[9px] tracking-[0.12em] font-bold leading-none" style={{ color: '#facc15' }}>BY OV</span>
        <span className="text-[22px] font-black text-white font-mono leading-none mt-1">{over_number || '—'}</span>
      </div>
    );
  }
  // Powerplay & Death — fixed over windows, no number, distinct colour.
  if (phase === 'powerplay') {
    return (
      <div className="w-14 h-14 rounded-xl flex flex-col items-center justify-center shrink-0" style={{ background: '#1a1a2e' }}>
        <span className="text-[8px] tracking-[0.12em] font-bold leading-none" style={{ color: '#fbbf24' }}>POWER</span>
        <span className="text-[15px] font-black text-white leading-none mt-1">PLAY</span>
        <span className="text-[7px] text-gray-400 leading-none mt-0.5">OV 1–6</span>
      </div>
    );
  }
  if (phase === 'death') {
    return (
      <div className="w-14 h-14 rounded-xl flex flex-col items-center justify-center shrink-0" style={{ background: '#1a1a2e' }}>
        <span className="text-[8px] tracking-[0.12em] font-bold leading-none" style={{ color: '#ef5350' }}>DEATH</span>
        <span className="text-[15px] font-black text-white leading-none mt-1">OVERS</span>
        <span className="text-[7px] text-gray-400 leading-none mt-0.5">OV 16–20</span>
      </div>
    );
  }
  // Toss kept for back-compat with any old contracts created under the
  // dropped Toss phase. New flow puts toss bets under Match.
  if (phase === 'toss') {
    return (
      <div className="w-14 h-14 rounded-xl flex flex-col items-center justify-center text-white shrink-0" style={{ background: '#0f3460' }}>
        <span style={{ color: '#fbbf24' }}><CoinSvg /></span>
        <span className="text-[11px] font-extrabold tracking-wide mt-1">TOSS</span>
      </div>
    );
  }
  // Match phase: split by innings_number into MATCH / 1ST INN / 2ND INN.
  if (phase === 'match') {
    if (innings_number === 1 || innings_number === 2) {
      return (
        <div className="w-14 h-14 rounded-xl flex flex-col items-center justify-center shrink-0" style={{ background: '#1a1a2e' }}>
          <span className="text-[9px] tracking-[0.12em] font-bold text-gray-400 leading-none">INNINGS</span>
          <span className="text-[22px] font-black text-white font-mono leading-none mt-1">{innings_number}</span>
        </div>
      );
    }
    return (
      <div className="w-14 h-14 rounded-xl flex flex-col items-center justify-center text-white shrink-0" style={{ background: '#16213e' }}>
        <CalSvg />
        <span className="text-[11px] font-extrabold tracking-wide mt-1">MATCH</span>
      </div>
    );
  }
  // Season-long bets — runs the whole tournament, resolves manually at season end.
  // Season code (e.g. "IPL26") shown big so users can tell different seasons apart.
  if (phase === 'season') {
    return (
      <div className="w-14 h-14 rounded-xl flex flex-col items-center justify-center text-white shrink-0" style={{ background: '#0f3460' }}>
        <span style={{ color: '#fcd34d' }}><TrophySvg /></span>
        <span className="text-[11px] font-black tracking-wide mt-0.5">{season_code || 'SEASON'}</span>
      </div>
    );
  }
  // Fallback for unclassified contracts (shouldn't happen post-backfill)
  return (
    <div className="w-14 h-14 rounded-xl flex flex-col items-center justify-center text-white shrink-0" style={{ background: '#4b5563' }}>
      <span className="text-[9px] tracking-wide font-bold" style={{ color: '#d1d5db' }}>CUSTOM</span>
      <span className="text-[20px] font-black leading-none mt-1">?</span>
    </div>
  );
}

// ── The card ───────────────────────────────────────────────────────

export default function ContractCard({ contract, tourTarget }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [stake, setStake] = useState(100);
  const [placing, setPlacing] = useState(null);
  const [flash, setFlash] = useState(null);

  // --- Order book state ---
  const bestYes = contract.best_yes_bid ?? null;
  const bestNo  = contract.best_no_bid  ?? null;
  const hasTrades = contract.has_trades ?? false;

  const hasYesSide = bestYes !== null;
  const hasNoSide  = bestNo  !== null;

  const stateA  = !hasYesSide && !hasNoSide;
  const stateB  = (hasYesSide && !hasNoSide) || (!hasYesSide && hasNoSide);
  const stateCD = hasYesSide && hasNoSide;

  const yesBetPrice = hasNoSide  ? (100 - bestNo)  : 50;
  const noBetPrice  = hasYesSide ? (100 - bestYes) : 50;

  const sentimentPrice = contract.current_price;
  const typeLabel = TYPE_META[contract.type] || contract.type?.replace(/_/g, ' ');

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
      className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-4 pb-2 sm:pb-4 cursor-pointer hover:shadow-md transition-shadow"
      onClick={() => navigate(`/contract/${contract.id}`)}
    >
      {/* ── NEW 3-SLOT HEADER ───────────────────────────────────── */}
      <div className="flex items-start gap-3 mb-3">
        <SubjectSlot contract={contract} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-[10px] uppercase tracking-wider font-bold text-gray-400 dark:text-gray-500">
              {typeLabel}
            </span>
            {(contract.volume > 0 || contract.trader_count > 0) && (
              <>
                <span className="text-gray-300 dark:text-gray-600 text-xs">·</span>
                {contract.volume > 0 && (
                  <span className="text-[10px] text-gray-400 dark:text-gray-500">🪙 {contract.volume.toLocaleString()}</span>
                )}
                {contract.trader_count > 0 && (
                  <span className="text-[10px] text-gray-400 dark:text-gray-500">{contract.trader_count} trader{contract.trader_count === 1 ? '' : 's'}</span>
                )}
              </>
            )}
            {contract.status === 'draft' && (
              <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wide bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400">Draft</span>
            )}
            {contract.status === 'resolved' && (
              <span className={`ml-auto text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wide ${
                contract.resolution === 'YES' ? 'bg-yes-bg text-yes' : 'bg-no-bg text-no'
              }`}>Settled {contract.resolution}</span>
            )}
          </div>
          <p className="font-semibold text-sm text-gray-900 dark:text-gray-100 leading-snug">
            {contract.title}
          </p>
        </div>

        <ContextBadge contract={contract} />
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
              {/* "Market sentiment" label + "% of money is on YES" is
                  desktop-only — on mobile the bar itself plus the
                  YES/NO row below it already convey sentiment, and
                  this top line was pure redundancy eating a row per card. */}
              <div className="hidden sm:flex justify-between items-center mb-1">
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
            <div data-tour={tourTarget ? 'price-bar' : undefined} className="mb-4">
              {/* Same idea — the "Market forming / no trades yet" top row
                  is desktop-only; the YES @ / NO @ row below carries the
                  state info on its own. */}
              <div className="hidden sm:flex justify-between items-center mb-1">
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
            // No outer mb-2 or trailing py-1 — the "+ Bid at a custom price →"
            // link is the last thing in the card and the parent p-4 already
            // gives the card its bottom padding. Extra margin here was
            // showing as dead space below the CTA on mobile.
            <div>
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
              <button onClick={goToDetail} className="w-full text-center text-sm text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
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
