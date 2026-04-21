import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { SubjectSlot, ContextBadge, TYPE_META } from './ContractCard';

// ── Static maps ─────────────────────────────────────────────────────

const PHASES = [
  { id: 'over',      label: 'Specific over' },
  { id: 'by_over',   label: 'By over' },
  { id: 'powerplay', label: 'Powerplay' },
  { id: 'death',     label: 'Death overs' },
  { id: 'match',     label: 'Match-long' },
  { id: 'season',    label: 'Season-long' },
];

const SEASON_CODES = ['IPL26'];
const DEFAULT_SEASON_CODE = 'IPL26';

const TYPES_BY_PHASE = {
  over: [
    { id: 'runs_over',     label: 'Runs in the over',       desc: 'Team scores N+ runs' },
    { id: 'wicket_over',   label: 'Wickets in the over',    desc: 'Team loses N+ wickets' },
    { id: 'boundary_over', label: 'Boundaries in the over', desc: 'N+ sixes or fours' },
    { id: 'custom_over',   label: 'Custom (over)',          desc: 'Anything else in this over' },
  ],
  by_over: [
    { id: 'team_total',             label: 'Team total runs',     desc: 'Team cumulative score' },
    { id: 'team_wickets_by_over',   label: 'Team wickets',        desc: 'Team has lost N+ wickets' },
    { id: 'batsman_milestone',      label: 'Batsman milestone',   desc: 'Specific batsman scores N+' },
    { id: 'bowler_wickets_by_over', label: 'Bowler wickets',      desc: 'Specific bowler N+ wickets' },
    { id: 'custom_by_over',         label: 'Custom (by over)',    desc: 'Cumulative anything' },
  ],
  powerplay: [
    { id: 'runs_powerplay',       label: 'Runs in powerplay',       desc: 'Team scores N+ in overs 1–6' },
    { id: 'wickets_powerplay',    label: 'Wickets in powerplay',    desc: 'Team loses N+ in overs 1–6' },
    { id: 'boundaries_powerplay', label: 'Boundaries in powerplay', desc: 'N+ sixes or fours' },
    { id: 'custom_powerplay',     label: 'Custom (powerplay)',      desc: 'Anything else in powerplay' },
  ],
  death: [
    { id: 'runs_death',       label: 'Runs in death overs',       desc: 'Team scores N+ in overs 16–20' },
    { id: 'wickets_death',    label: 'Wickets in death overs',    desc: 'Team loses N+ in overs 16–20' },
    { id: 'boundaries_death', label: 'Boundaries in death overs', desc: 'N+ sixes or fours' },
    { id: 'custom_death',     label: 'Custom (death overs)',      desc: 'Anything else in death overs' },
  ],
  match: [
    { id: 'match_winner',  label: 'Match winner',   desc: 'Which team wins the match' },
    { id: 'innings_score', label: 'Innings score',  desc: 'Team total at end of innings' },
    { id: 'toss_winner',   label: 'Toss winner',    desc: 'Which team wins the toss' },
    { id: 'custom_match',  label: 'Custom (match)', desc: 'Flexible — any subject + badge' },
  ],
  season: [
    { id: 'season_team_finish',     label: 'Team league finish',  desc: 'Team finishes in top N of the league table' },
    { id: 'season_team_wins_title', label: 'Title winner',        desc: 'Team lifts the trophy this season' },
    { id: 'season_player_runs',     label: 'Player season runs',  desc: 'Batsman scores N+ runs across the season' },
    { id: 'season_player_wickets',  label: 'Player season wickets', desc: 'Bowler takes N+ wickets across the season' },
    { id: 'custom_season',          label: 'Custom (season)',     desc: 'Free-text season question' },
  ],
};

// Default subject-kind per type. Custom_match gets overridden by admin.
const SUBJECT_KIND_BY_TYPE = {
  runs_over: 'team', wicket_over: 'team', boundary_over: 'team', custom_over: 'team',
  team_total: 'team', team_wickets_by_over: 'team',
  batsman_milestone: 'player', bowler_wickets_by_over: 'player',
  custom_by_over: 'team',
  runs_powerplay: 'team', wickets_powerplay: 'team', boundaries_powerplay: 'team', custom_powerplay: 'team',
  runs_death: 'team', wickets_death: 'team', boundaries_death: 'team', custom_death: 'team',
  match_winner: 'matchup',
  innings_score: 'team',
  toss_winner: 'team',
  custom_match: 'team',
  // season
  season_team_finish: 'team',
  season_team_wins_title: 'team',
  season_player_runs: 'player',
  season_player_wickets: 'player',
  custom_season: 'team',
  // legacy
  manual: 'match_generic',
  player_match_stat: 'player',
};

const OP_OPTIONS = [
  { value: '>=', label: '≥ (at least)' },
  { value: '>',  label: '> (more than)' },
  { value: '<=', label: '≤ (at most)'   },
];

// Param-flag table — drives which input groups render for a type.
const TYPES_WITH_OPERATOR = new Set(['runs_over','team_total','runs_powerplay','runs_death','innings_score']);
const TYPES_WITH_MIN_WICKETS = new Set(['wicket_over','team_wickets_by_over','wickets_powerplay','wickets_death','bowler_wickets_by_over']);
const TYPES_WITH_BOUNDARY = new Set(['boundary_over','boundaries_powerplay','boundaries_death']);
const TYPES_WITH_MILESTONE = new Set(['batsman_milestone']);
const TYPES_WITH_CUSTOM_TITLE = new Set(['custom_over','custom_by_over','custom_powerplay','custom_death','custom_match','custom_season','manual']);
const TYPES_WITH_OVER = new Set(['runs_over','wicket_over','boundary_over','custom_over','team_total','team_wickets_by_over','batsman_milestone','bowler_wickets_by_over','custom_by_over']);
const TYPES_WITH_INNINGS = new Set(['innings_score']);   // custom_match has its own opt-in toggle
// Season-specific extra inputs
const TYPES_WITH_SEASON_POSITION   = new Set(['season_team_finish']);   // "Top N finish"
const TYPES_WITH_SEASON_RUN_TOTAL  = new Set(['season_player_runs']);   // "Total runs across season"
const TYPES_WITH_SEASON_WKT_TOTAL  = new Set(['season_player_wickets']); // "Total wickets across season"

// ── Builders (title + condition_json) ───────────────────────────────

function teamFull(teams, id)   { const t = teams.find(x => x.id === id);   return t ? t.name : '...'; }
function teamShort(teams, id)  { const t = teams.find(x => x.id === id);   return t ? t.short_code : null; }
function playerName(players, id) { const p = players.find(x => x.id === id); return p ? p.name : '...'; }
function playerNameOrNull(players, id) { const p = players.find(x => x.id === id); return p ? p.name : null; }

function opPhrase(op) {
  return op === '>' ? 'more than' : op === '<=' ? 'at most' : 'at least';
}
function boundaryPhrase(type, count) {
  const noun = type === 'four' ? 'four' : 'six';
  const plural = type === 'four' ? 'fours' : 'sixes';
  if (+count > 1) return `${count}+ ${plural}`;
  return `a ${noun}`;
}
function wicketsPhrase(min) {
  if (+min > 1) return `${min}+ wickets`;
  return 'a wicket';
}
function inningsPhrase(n) {
  return n === 2 ? '2nd' : '1st';
}

function buildTitle(type, fields, teams, players) {
  const t = (id) => teamFull(teams, id);
  const p = (id) => playerName(players, id);

  switch (type) {
    case 'runs_over':         return `Will ${t(fields.team_id)} score ${opPhrase(fields.operator)} ${fields.threshold || 'N'} runs in over ${fields.over || 'N'}?`;
    case 'wicket_over':       return `Will ${t(fields.team_id)} lose ${wicketsPhrase(fields.min_wickets)} in over ${fields.over || 'N'}?`;
    case 'boundary_over':     return `Will ${t(fields.team_id)} hit ${boundaryPhrase(fields.boundary_type, fields.boundary_count)} in over ${fields.over || 'N'}?`;
    case 'custom_over':       return fields.custom_title || '...';

    case 'team_total':              return `Will ${t(fields.team_id)} reach ${opPhrase(fields.operator)} ${fields.threshold || 'N'} runs by end of over ${fields.over || 'N'}?`;
    case 'team_wickets_by_over':    return `Will ${t(fields.team_id)} lose ${fields.min_wickets || 1}+ wickets by end of over ${fields.over || 'N'}?`;
    case 'batsman_milestone':       return `Will ${p(fields.player_id)} score ${fields.milestone || 'N'}+ runs by end of over ${fields.over || 'N'}?`;
    case 'bowler_wickets_by_over':  return `Will ${p(fields.player_id)} have ${fields.min_wickets || 1}+ wickets by end of over ${fields.over || 'N'}?`;
    case 'custom_by_over':          return fields.custom_title || '...';

    case 'runs_powerplay':       return `Will ${t(fields.team_id)} score ${opPhrase(fields.operator)} ${fields.threshold || 'N'} runs in the powerplay?`;
    case 'wickets_powerplay':    return `Will ${t(fields.team_id)} lose ${fields.min_wickets || 1}+ wickets in the powerplay?`;
    case 'boundaries_powerplay': return `Will ${t(fields.team_id)} hit ${boundaryPhrase(fields.boundary_type, fields.boundary_count)} in the powerplay?`;
    case 'custom_powerplay':     return fields.custom_title || '...';

    case 'runs_death':       return `Will ${t(fields.team_id)} score ${opPhrase(fields.operator)} ${fields.threshold || 'N'} runs in the death overs?`;
    case 'wickets_death':    return `Will ${t(fields.team_id)} lose ${fields.min_wickets || 1}+ wickets in the death overs?`;
    case 'boundaries_death': return `Will ${t(fields.team_id)} hit ${boundaryPhrase(fields.boundary_type, fields.boundary_count)} in the death overs?`;
    case 'custom_death':     return fields.custom_title || '...';

    case 'match_winner':  return `Will ${t(fields.team_id)} beat ${t(fields.opponent_team_id)} today?`;
    case 'innings_score': return `Will ${t(fields.team_id)} score ${opPhrase(fields.operator)} ${fields.threshold || 'N'} runs?`;
    case 'toss_winner':   return `Will ${t(fields.team_id)} win the toss today?`;
    case 'custom_match':  return fields.custom_title || '...';

    case 'season_team_finish':     return `Will ${t(fields.team_id)} finish in the top ${fields.threshold_position || 'N'} this season?`;
    case 'season_team_wins_title': return `Will ${t(fields.team_id)} win ${fields.season_code || DEFAULT_SEASON_CODE}?`;
    case 'season_player_runs':     return `Will ${p(fields.player_id)} score ${fields.threshold || 'N'}+ runs this season?`;
    case 'season_player_wickets':  return `Will ${p(fields.player_id)} take ${fields.threshold || 'N'}+ wickets this season?`;
    case 'custom_season':          return fields.custom_title || '...';

    case 'manual':            return fields.custom_title || '...';
    case 'player_match_stat': return `Will ${p(fields.player_id)} take a wicket today?`;
    default: return '...';
  }
}

function buildConditionJson(type, fields, teams, players) {
  const tS = (id) => teamShort(teams, id);
  const pN = (id) => playerNameOrNull(players, id);
  switch (type) {
    case 'runs_over':         return { type, team: tS(fields.team_id), over: +fields.over || null, operator: fields.operator || '>=', threshold: +fields.threshold || null };
    case 'wicket_over':       return { type, batting_team: tS(fields.team_id), over: +fields.over || null, min_wickets: +fields.min_wickets || 1 };
    case 'boundary_over':     return { type, team: tS(fields.team_id), over: +fields.over || null, boundary_type: fields.boundary_type || 'six', boundary_count: +fields.boundary_count || 1 };
    case 'custom_over':       return { type, team: tS(fields.team_id), over: +fields.over || null };

    case 'team_total':              return { type, team: tS(fields.team_id), by_over: +fields.over || null, operator: fields.operator || '>=', threshold: +fields.threshold || null };
    case 'team_wickets_by_over':    return { type, team: tS(fields.team_id), by_over: +fields.over || null, min_wickets: +fields.min_wickets || 1 };
    case 'batsman_milestone':       return { type, batsman: pN(fields.player_id), milestone: +fields.milestone || null, by_over: +fields.over || null };
    case 'bowler_wickets_by_over':  return { type, bowler: pN(fields.player_id), min_wickets: +fields.min_wickets || 1, by_over: +fields.over || null };
    case 'custom_by_over':          return { type, team: tS(fields.team_id), by_over: +fields.over || null };

    case 'runs_powerplay':       return { type, team: tS(fields.team_id), operator: fields.operator || '>=', threshold: +fields.threshold || null };
    case 'wickets_powerplay':    return { type, team: tS(fields.team_id), min_wickets: +fields.min_wickets || 1 };
    case 'boundaries_powerplay': return { type, team: tS(fields.team_id), boundary_type: fields.boundary_type || 'six', boundary_count: +fields.boundary_count || 1 };
    case 'custom_powerplay':     return { type, team: tS(fields.team_id) };

    case 'runs_death':       return { type, team: tS(fields.team_id), operator: fields.operator || '>=', threshold: +fields.threshold || null };
    case 'wickets_death':    return { type, team: tS(fields.team_id), min_wickets: +fields.min_wickets || 1 };
    case 'boundaries_death': return { type, team: tS(fields.team_id), boundary_type: fields.boundary_type || 'six', boundary_count: +fields.boundary_count || 1 };
    case 'custom_death':     return { type, team: tS(fields.team_id) };

    case 'match_winner':  return { type, team: tS(fields.team_id), opponent: tS(fields.opponent_team_id) };
    case 'innings_score': return { type, team: tS(fields.team_id), innings: +fields.innings_number || 1, operator: fields.operator || '>=', threshold: +fields.threshold || null };
    case 'toss_winner':   return { type, team: tS(fields.team_id) };
    case 'custom_match':  return { type, team: tS(fields.team_id), player: pN(fields.player_id), innings: fields.innings_number || null };

    case 'season_team_finish':     return { type, team: tS(fields.team_id), season: fields.season_code || DEFAULT_SEASON_CODE, threshold_position: +fields.threshold_position || null };
    case 'season_team_wins_title': return { type, team: tS(fields.team_id), season: fields.season_code || DEFAULT_SEASON_CODE };
    case 'season_player_runs':     return { type, player: pN(fields.player_id), season: fields.season_code || DEFAULT_SEASON_CODE, threshold: +fields.threshold || null };
    case 'season_player_wickets':  return { type, player: pN(fields.player_id), season: fields.season_code || DEFAULT_SEASON_CODE, threshold: +fields.threshold || null };
    case 'custom_season':          return { type, team: tS(fields.team_id), player: pN(fields.player_id), season: fields.season_code || DEFAULT_SEASON_CODE };

    case 'manual':            return null;
    case 'player_match_stat': return { type, player: pN(fields.player_id), stat_kind: fields.stat_kind || 'wicket' };
    default: return null;
  }
}

function requiredFields(type) {
  switch (type) {
    case 'runs_over':         return ['team_id', 'over', 'operator', 'threshold'];
    case 'wicket_over':       return ['team_id', 'over'];
    case 'boundary_over':     return ['team_id', 'over', 'boundary_type'];
    case 'custom_over':       return ['custom_title', 'over'];

    case 'team_total':              return ['team_id', 'over', 'operator', 'threshold'];
    case 'team_wickets_by_over':    return ['team_id', 'over'];
    case 'batsman_milestone':       return ['player_id', 'over', 'milestone'];
    case 'bowler_wickets_by_over':  return ['player_id', 'over'];
    case 'custom_by_over':          return ['custom_title', 'over'];

    case 'runs_powerplay':       return ['team_id', 'operator', 'threshold'];
    case 'wickets_powerplay':    return ['team_id'];
    case 'boundaries_powerplay': return ['team_id', 'boundary_type'];
    case 'custom_powerplay':     return ['custom_title'];

    case 'runs_death':       return ['team_id', 'operator', 'threshold'];
    case 'wickets_death':    return ['team_id'];
    case 'boundaries_death': return ['team_id', 'boundary_type'];
    case 'custom_death':     return ['custom_title'];

    case 'match_winner':   return ['team_id', 'opponent_team_id'];
    case 'innings_score':  return ['team_id', 'innings_number', 'operator', 'threshold'];
    case 'toss_winner':    return ['team_id'];
    case 'custom_match':   return ['custom_title'];

    case 'season_team_finish':     return ['team_id', 'threshold_position'];
    case 'season_team_wins_title': return ['team_id'];
    case 'season_player_runs':     return ['player_id', 'threshold'];
    case 'season_player_wickets':  return ['player_id', 'threshold'];
    case 'custom_season':          return ['custom_title'];

    case 'manual':            return ['custom_title'];
    case 'player_match_stat': return ['player_id'];
    default: return [];
  }
}
function isComplete(type, fields) {
  return requiredFields(type).every(k => {
    const v = fields[k];
    return v !== undefined && v !== null && v !== '' && (typeof v !== 'number' || !isNaN(v));
  });
}

// What innings_number the contract should carry, given the form state.
// For most types this is null; for innings_score it's the form value;
// for custom_match it depends on the badge picker.
function effectiveInningsNumber(type, fields) {
  if (TYPES_WITH_INNINGS.has(type)) return +fields.innings_number || null;
  if (type === 'custom_match') {
    return (fields.match_badge === '1st' ? 1 : fields.match_badge === '2nd' ? 2 : null);
  }
  return null;
}

// ── Sub-components ─────────────────────────────────────────────────

// Phase tile: compact, icon-over-label. Works down to ~80px wide.
function PhaseTile({ active, title, badge, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border-[1.5px] p-2 transition-all flex flex-col items-center justify-center gap-1.5 min-h-[88px] ${
        active
          ? 'border-navy-800 bg-navy-800/5 dark:border-navy-700 dark:bg-navy-800/30 ring-2 ring-navy-800/20'
          : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500 bg-white dark:bg-gray-700'
      }`}
    >
      {badge}
      <span className="text-xs font-bold text-gray-900 dark:text-gray-100 text-center leading-tight">{title}</span>
    </button>
  );
}

// Type tile: horizontal glyph + label + one-line description.
function TypeTile({ active, title, desc, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left rounded-xl border-[1.5px] p-3 transition-all flex flex-col gap-1 ${
        active
          ? 'border-navy-800 bg-navy-800/5 dark:border-navy-700 dark:bg-navy-800/30 ring-2 ring-navy-800/20'
          : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500 bg-white dark:bg-gray-700'
      }`}
    >
      <span className="text-sm font-bold text-gray-900 dark:text-gray-100">{title}</span>
      {desc && <span className="text-xs text-gray-500 dark:text-gray-400 leading-tight">{desc}</span>}
    </button>
  );
}

// Tiny inline glyphs for the phase tiles. Mirrors the actual ContextBadge variants.
function PhaseGlyph({ phase }) {
  const cls = 'w-9 h-9 rounded-lg flex flex-col items-center justify-center text-white shrink-0';
  if (phase === 'over')      return <div className={cls} style={{ background: '#1a1a2e' }}><span className="text-gray-400 text-[7px] font-bold">OVER</span><span className="font-mono text-[12px] font-black leading-none mt-0.5">15</span></div>;
  if (phase === 'by_over')   return <div className={cls} style={{ background: '#1a1a2e' }}><span className="text-[7px] font-bold" style={{ color: '#facc15' }}>BY OV</span><span className="font-mono text-[12px] font-black leading-none mt-0.5">18</span></div>;
  if (phase === 'powerplay') return <div className={cls} style={{ background: '#1a1a2e' }}><span className="text-[7px] font-bold" style={{ color: '#fbbf24' }}>POWER</span><span className="text-[10px] font-black leading-none mt-0.5">PLAY</span></div>;
  if (phase === 'death')     return <div className={cls} style={{ background: '#1a1a2e' }}><span className="text-[7px] font-bold" style={{ color: '#ef5350' }}>DEATH</span><span className="text-[10px] font-black leading-none mt-0.5">OVERS</span></div>;
  if (phase === 'match')     return <div className={cls} style={{ background: '#16213e' }}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><path d="M8 3v4M16 3v4M3 10h18M5 6h14a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z"/></svg><span className="text-[8px] font-bold mt-0.5">MATCH</span></div>;
  if (phase === 'season')    return <div className={cls} style={{ background: '#0f3460' }}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4" style={{ color: '#fcd34d' }}><path d="M6 3h12v4a6 6 0 0 1-12 0V3z"/><path d="M6 5H3a2 2 0 0 0 2 3h1M18 5h3a2 2 0 0 1-2 3h-1"/><path d="M9 14h6M12 14v4M8 21h8"/></svg><span className="text-[8px] font-black mt-0.5">IPL26</span></div>;
  return null;
}

function TeamGrid({ teams, selectedId, onSelect, compact = false, exclude }) {
  const visibleTeams = exclude ? teams.filter(t => t.id !== exclude) : teams;
  return (
    <div className={`grid ${compact ? 'grid-cols-10 gap-1' : 'grid-cols-5 gap-2'}`}>
      {visibleTeams.map(t => (
        <button
          key={t.id}
          type="button"
          onClick={() => onSelect(t.id)}
          className={`${compact ? 'p-1.5' : 'p-2'} rounded-xl border-2 flex flex-col items-center gap-1 transition-colors ${
            selectedId === t.id
              ? 'border-navy-800 bg-navy-800/5 dark:bg-navy-800/30'
              : 'border-transparent hover:bg-gray-100 dark:hover:bg-gray-700'
          }`}
        >
          <img src={t.logo_path} alt={t.short_code} className={`${compact ? 'w-7 h-7' : 'w-12 h-12'} object-contain`} />
          {!compact && <span className="text-[10px] font-bold text-gray-700 dark:text-gray-200 tracking-wide">{t.short_code}</span>}
        </button>
      ))}
    </div>
  );
}

function PlayerInitials({ name, colour, size = 48 }) {
  const initials = String(name || '?').split(/\s+/).map(w => w[0]).filter(Boolean).slice(0, 3).join('').toUpperCase();
  return (
    <div className="rounded-full flex items-center justify-center font-extrabold text-white"
         style={{ width: size, height: size, background: colour, fontSize: Math.round(size * 0.32) }}>
      {initials}
    </div>
  );
}

function PlayerGrid({ teamId, selectedId, onSelect, onAddPlayer }) {
  const [players, setPlayers] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!teamId) { setPlayers([]); return; }
    setLoading(true);
    const ctl = new AbortController();
    fetch(`/api/players?team_id=${teamId}`, { credentials: 'include', signal: ctl.signal })
      .then(r => r.json())
      .then(d => setPlayers(d.players || []))
      .catch(() => {})
      .finally(() => setLoading(false));
    return () => ctl.abort();
  }, [teamId]);

  const filtered = useMemo(() => {
    if (!search.trim()) return players;
    const q = search.toLowerCase();
    return players.filter(p => p.name.toLowerCase().includes(q));
  }, [players, search]);

  if (!teamId) {
    return <p className="text-xs text-gray-400 italic">Pick a team first to see its squad.</p>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2 gap-2">
        <span className="text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
          {loading ? 'Loading…' : `${players.length} squad players`}
        </span>
        <input
          type="text"
          placeholder="Search player…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="text-xs border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-lg px-2 py-1 max-w-[180px] focus:outline-none focus:ring-2 focus:ring-navy-800"
        />
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
        {filtered.map(p => (
          <button
            key={p.id}
            type="button"
            onClick={() => onSelect(p.id)}
            className={`p-2 rounded-xl border-2 flex flex-col items-center gap-1 text-center transition-colors ${
              selectedId === p.id
                ? 'border-navy-800 bg-navy-800/5 dark:bg-navy-800/30'
                : 'border-transparent hover:bg-gray-100 dark:hover:bg-gray-700'
            }`}
          >
            {p.headshot_path ? (
              <img src={p.headshot_path} alt={p.name} className="w-12 h-12 rounded-full object-cover" style={{ objectPosition: 'center top', boxShadow: `0 0 0 2px ${p.team_colour || '#1a1a2e'}` }} />
            ) : (
              <PlayerInitials name={p.name} colour={p.team_colour || '#1a1a2e'} size={48} />
            )}
            <span className="text-[11px] font-bold text-gray-800 dark:text-gray-200 leading-tight line-clamp-2">{p.name}</span>
            {p.role && <span className="text-[9px] uppercase tracking-wide text-gray-500 dark:text-gray-400">{p.role}</span>}
          </button>
        ))}
        <button
          type="button"
          onClick={onAddPlayer}
          className="p-2 rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-600 flex flex-col items-center gap-1 text-center text-gray-400 hover:border-navy-800 hover:text-navy-800 dark:hover:text-gray-200 transition-colors"
          title="Add a player not in the list"
        >
          <div className="w-12 h-12 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-2xl font-bold">+</div>
          <span className="text-[11px] font-bold leading-tight">Add player</span>
        </button>
      </div>
    </div>
  );
}

function AddPlayerModal({ teamId, teamName, onSave, onCancel }) {
  const [name, setName] = useState('');
  const [role, setRole] = useState('batter');
  const [headshot, setHeadshot] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function save() {
    if (!name.trim()) return;
    setSaving(true); setErr('');
    try {
      const r = await fetch('/api/players', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), team_id: teamId, role, headshot_path: headshot.trim() || null }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Failed');
      onSave(d.player);
    } catch (e) { setErr(e.message); } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={onCancel}>
      <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 max-w-sm w-full space-y-3" onClick={e => e.stopPropagation()}>
        <h3 className="font-bold text-gray-900 dark:text-gray-100">Add player to {teamName}</h3>
        <div>
          <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wide block mb-1">Name</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Vaibhav Suryavanshi" className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-navy-800" />
        </div>
        <div>
          <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wide block mb-1">Role</label>
          <select value={role} onChange={e => setRole(e.target.value)} className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-lg px-3 py-2 text-sm">
            <option value="batter">Batter</option>
            <option value="bowler">Bowler</option>
            <option value="all-rounder">All-rounder</option>
            <option value="wk">Wicket-keeper</option>
          </select>
        </div>
        <div>
          <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wide block mb-1">Headshot path (optional)</label>
          <input value={headshot} onChange={e => setHeadshot(e.target.value)} placeholder="/players/foo.jpg" className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-navy-800" />
          <p className="text-[10px] text-gray-400 mt-1">Leave blank — initials on team colour will be used.</p>
        </div>
        {err && <p className="text-xs text-red-600">{err}</p>}
        <div className="flex gap-2 pt-1">
          <button onClick={onCancel} className="flex-1 py-2 rounded-lg border border-gray-200 dark:border-gray-600 text-sm font-semibold text-gray-700 dark:text-gray-200">Cancel</button>
          <button onClick={save} disabled={saving || !name.trim()} className="flex-1 py-2 rounded-lg bg-navy-800 text-white text-sm font-bold disabled:opacity-40">{saving ? 'Saving…' : 'Add'}</button>
        </div>
      </div>
    </div>
  );
}

function PreviewCard({ contract }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-4">
      <div className="flex items-start gap-3">
        <SubjectSlot contract={contract} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] uppercase tracking-wider font-bold text-gray-400 dark:text-gray-500">
              {TYPE_META[contract.type] || '—'}
            </span>
          </div>
          <p className="font-semibold text-sm text-gray-900 dark:text-gray-100 leading-snug">{contract.title || '...'}</p>
        </div>
        <ContextBadge contract={contract} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button disabled className="py-2 rounded-lg bg-yes text-white font-bold text-sm opacity-80">YES</button>
        <button disabled className="py-2 rounded-lg bg-no text-white font-bold text-sm opacity-80">NO</button>
      </div>
    </div>
  );
}

// Field block helpers — keep the form readable. Each renders one labelled input.
function NumInput({ label, value, onChange, hint, min }) {
  return (
    <div>
      <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-1">{label}</p>
      <input type="number" min={min} value={value || ''} onChange={e => onChange(e.target.value)} className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-lg px-3 py-2 text-sm" />
      {hint && <p className="text-[10px] text-gray-400 mt-0.5">{hint}</p>}
    </div>
  );
}
function Select({ label, value, onChange, options }) {
  return (
    <div>
      <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-1">{label}</p>
      <select value={value || ''} onChange={e => onChange(e.target.value)} className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-lg px-3 py-2 text-sm">
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

// ── The Builder ────────────────────────────────────────────────────

export default function ContractBuilder({ editing, onSaved, onCancelEdit }) {
  const [teams, setTeams] = useState([]);
  const [phase, setPhase]   = useState(null);
  const [type, setType]     = useState(null);
  const [fields, setFields] = useState({});
  const [resolveMode, setResolveMode] = useState('manual');
  const [submitting, setSubmitting]   = useState(false);
  const [error, setError]   = useState('');
  const [showAddPlayer, setShowAddPlayer] = useState(false);

  useEffect(() => {
    fetch('/api/teams', { credentials: 'include' }).then(r => r.json()).then(d => setTeams(d.teams || []));
  }, []);

  // Prefill on edit / duplicate (object-reference change → fresh load)
  const lastEditingRef = useRef(null);
  useEffect(() => {
    if (!editing) {
      if (lastEditingRef.current !== null) reset();
      lastEditingRef.current = null;
      return;
    }
    if (editing === lastEditingRef.current) return;
    lastEditingRef.current = editing;
    setPhase(editing.phase || null);
    setType(editing.type || null);
    setResolveMode(editing.resolve_mode || 'manual');
    let cond = {};
    try { cond = editing.condition_json ? JSON.parse(editing.condition_json) : {}; } catch (_) {}
    setFields({
      team_id: editing.team_id || null,
      opponent_team_id: editing.opponent_team_id || null,
      player_id: editing.player_id || null,
      over: editing.over_number || cond.over || cond.by_over || '',
      operator: cond.operator || '>=',
      threshold: cond.threshold || '',
      threshold_position: cond.threshold_position || '',
      milestone: cond.milestone || '',
      min_wickets: cond.min_wickets || 1,
      boundary_type: cond.boundary_type || 'six',
      boundary_count: cond.boundary_count || 1,
      innings_number: editing.innings_number || cond.innings || '',
      season_code: editing.season_code || cond.season || DEFAULT_SEASON_CODE,
      // Match Custom: reconstruct badge picker state from innings_number,
      // and subject toggle from whichever id is set.
      match_badge: editing.innings_number === 1 ? '1st' : editing.innings_number === 2 ? '2nd' : 'match',
      match_subject: editing.player_id ? 'player' : 'team',
      custom_title: TYPES_WITH_CUSTOM_TITLE.has(editing.type) ? editing.title : '',
    });
    setError('');
  }, [editing]);

  function reset() {
    setPhase(null); setType(null); setFields({}); setResolveMode('manual'); setError('');
  }

  function selectPhase(p) {
    setPhase(p);
    if (TYPES_BY_PHASE[p].length === 1) setType(TYPES_BY_PHASE[p][0].id);
    else setType(null);
    setFields({ min_wickets: 1, boundary_count: 1, boundary_type: 'six', operator: '>=', match_badge: 'match', match_subject: 'team', season_code: DEFAULT_SEASON_CODE });
    // Season bets always resolve manually — CricAPI polling can't settle them.
    if (p === 'season') setResolveMode('manual');
    setError('');
  }
  function selectType(t) {
    setType(t);
    setFields(f => ({
      ...f,
      // Carry team selection across compatible types
      team_id: f.team_id,
      // Defaults
      min_wickets: f.min_wickets || 1,
      boundary_count: f.boundary_count || 1,
      boundary_type: f.boundary_type || 'six',
      operator: f.operator || '>=',
      match_badge: f.match_badge || 'match',
      match_subject: f.match_subject || 'team',
      // Player_id is reset when switching to player type (might not be on right team)
      player_id: SUBJECT_KIND_BY_TYPE[t] === 'player' ? f.player_id : null,
    }));
    setError('');
  }

  // Player cache for preview/title rendering
  const [cachedPlayers, setCachedPlayers] = useState({});
  useEffect(() => {
    if (!fields.team_id) return;
    fetch(`/api/players?team_id=${fields.team_id}`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => {
        const map = {};
        for (const p of (d.players || [])) map[p.id] = p;
        setCachedPlayers(prev => ({ ...prev, ...map }));
      });
  }, [fields.team_id]);
  const playersList = useMemo(() => Object.values(cachedPlayers), [cachedPlayers]);

  // Live preview-shaped contract object
  const preview = useMemo(() => {
    const team     = teams.find(t => t.id === fields.team_id) || null;
    const opponent = teams.find(t => t.id === fields.opponent_team_id) || null;
    const player   = cachedPlayers[fields.player_id] || null;
    const subjectKind = SUBJECT_KIND_BY_TYPE[type] || 'match_generic';
    // Custom_match: subject toggles, badge picker
    const isCustomMatch = type === 'custom_match';
    const overrideSubject = isCustomMatch
      ? (fields.match_subject === 'player' ? 'player' : (fields.team_id ? 'team' : 'match_generic'))
      : subjectKind;

    return {
      type,
      phase,
      subject_kind: overrideSubject,
      over_number: TYPES_WITH_OVER.has(type) ? +fields.over || null : null,
      innings_number: effectiveInningsNumber(type, fields),
      season_code: phase === 'season' ? (fields.season_code || DEFAULT_SEASON_CODE) : null,
      title: type ? buildTitle(type, fields, teams, playersList) : '...',
      team,
      opponent,
      player: player ? {
        ...player,
        team_colour: player.team_colour || team?.primary_colour,
        team_logo: player.team_logo || team?.logo_path,
        team_short: player.team_short || team?.short_code,
      } : null,
    };
  }, [type, phase, fields, teams, cachedPlayers, playersList]);

  function setField(name, value) { setFields(f => ({ ...f, [name]: value })); }

  function selectPlayer(playerId) {
    const p = cachedPlayers[playerId];
    setFields(f => ({ ...f, player_id: playerId, team_id: p?.team_id || f.team_id }));
  }

  async function submit(publishStatus) {
    if (!type) return;
    if (!isComplete(type, fields)) {
      setError('Please fill in all required fields');
      return;
    }
    setSubmitting(true); setError('');
    try {
      const condition_json = buildConditionJson(type, fields, teams, playersList);
      const title = buildTitle(type, fields, teams, playersList);
      // Effective subject_kind — for custom_match obey the toggle
      let subject_kind = SUBJECT_KIND_BY_TYPE[type];
      if (type === 'custom_match') {
        subject_kind = (fields.match_subject === 'player' && fields.player_id)
          ? 'player'
          : (fields.team_id ? 'team' : 'match_generic');
      }
      const over_number = TYPES_WITH_OVER.has(type) ? +fields.over || null : null;
      const innings_number = effectiveInningsNumber(type, fields);

      const payload = {
        title,
        type,
        condition_json,
        phase,
        subject_kind,
        team_id: fields.team_id || null,
        opponent_team_id: fields.opponent_team_id || null,
        player_id: (subject_kind === 'player' || type === 'batsman_milestone' || type === 'bowler_wickets_by_over' || type === 'season_player_runs' || type === 'season_player_wickets') ? (fields.player_id || null) : null,
        over_number,
        innings_number,
        season_code: phase === 'season' ? (fields.season_code || DEFAULT_SEASON_CODE) : null,
        resolve_mode: phase === 'season' ? 'manual' : resolveMode,
        status: publishStatus,
      };
      const url    = editing?.id ? `/api/contracts/${editing.id}` : '/api/contracts';
      const method = editing?.id ? 'PATCH' : 'POST';
      const r = await fetch(url, {
        method, credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      reset();
      onSaved && onSaved(d.contract);
    } catch (e) { setError(e.message); } finally { setSubmitting(false); }
  }

  const types = phase ? TYPES_BY_PHASE[phase] : [];
  const subjectKind = type ? SUBJECT_KIND_BY_TYPE[type] : null;
  const isCustomType = TYPES_WITH_CUSTOM_TITLE.has(type);
  const isCustomMatch = type === 'custom_match';

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5 space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-gray-900 dark:text-gray-100">
          {editing?.id ? `Edit Contract #${editing.id}` : (editing ? 'Duplicate as new contract' : 'Create Contract')}
        </h2>
        {editing && (
          <button onClick={onCancelEdit} className="text-xs text-gray-500 hover:text-red-600 border border-gray-200 dark:border-gray-600 px-3 py-1 rounded-lg">
            Cancel edit
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        <div className="lg:col-span-3 space-y-5">
          {/* STEP 1 — Phase */}
          <div>
            <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-2">Step 1 · Phase</p>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
              {PHASES.map(p => (
                <PhaseTile key={p.id} active={phase === p.id} title={p.label}
                           badge={<PhaseGlyph phase={p.id} />} onClick={() => selectPhase(p.id)} />
              ))}
            </div>
          </div>

          {/* STEP 2 — Type */}
          {phase && (
            <div>
              <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-2">Step 2 · Prediction type</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {types.map(t => (
                  <TypeTile key={t.id} active={type === t.id} title={t.label} desc={t.desc}
                            onClick={() => selectType(t.id)} />
                ))}
              </div>
            </div>
          )}

          {/* STEP 3 — Subject + params */}
          {type && (
            <div className="space-y-4">
              {/* Custom title (free text) */}
              {isCustomType && (
                <div>
                  <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-1">Question (free text)</p>
                  <input value={fields.custom_title || ''} onChange={e => setField('custom_title', e.target.value)}
                         placeholder="e.g. Will there be a no-ball this over?"
                         className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-navy-800" />
                </div>
              )}

              {/* Match Custom: subject toggle + badge toggle */}
              {isCustomMatch && (
                <div className="space-y-3 p-3 rounded-xl bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600">
                  <div>
                    <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-2">Subject on the card</p>
                    <div className="flex gap-2">
                      {[{ id: 'team', label: 'Team' }, { id: 'player', label: 'Player' }].map(s => (
                        <button key={s.id} type="button"
                          onClick={() => setField('match_subject', s.id)}
                          className={`flex-1 py-2 rounded-lg text-sm font-bold border ${
                            fields.match_subject === s.id ? 'border-navy-800 bg-navy-800 text-white' : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300'
                          }`}>{s.label}</button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-2">Right-side badge</p>
                    <div className="flex gap-2">
                      {[{ id: 'match', label: 'MATCH' }, { id: '1st', label: '1ST INN' }, { id: '2nd', label: '2ND INN' }].map(b => (
                        <button key={b.id} type="button"
                          onClick={() => setField('match_badge', b.id)}
                          className={`flex-1 py-2 rounded-lg text-xs font-bold border ${
                            fields.match_badge === b.id ? 'border-navy-800 bg-navy-800 text-white' : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300'
                          }`}>{b.label}</button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Subject pickers */}
              {/* Team — single team subject (not custom_match player mode) */}
              {((subjectKind === 'team' && !isCustomMatch) ||
                (isCustomMatch && fields.match_subject === 'team')) && (
                <div>
                  <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-2">Team {isCustomType && '(optional)'}</p>
                  <TeamGrid teams={teams} selectedId={fields.team_id} onSelect={id => setField('team_id', id)} />
                </div>
              )}

              {/* Matchup — pick YES team + opponent */}
              {subjectKind === 'matchup' && (
                <div className="space-y-3">
                  <div>
                    <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-2">YES team (the one that wins)</p>
                    <TeamGrid teams={teams} selectedId={fields.team_id} onSelect={id => setField('team_id', id)} />
                  </div>
                  <div>
                    <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-2">Opponent</p>
                    <TeamGrid teams={teams} selectedId={fields.opponent_team_id} onSelect={id => setField('opponent_team_id', id)} compact exclude={fields.team_id} />
                  </div>
                </div>
              )}

              {/* Player — team filter then player */}
              {((subjectKind === 'player' && !isCustomMatch) ||
                (isCustomMatch && fields.match_subject === 'player')) && (
                <div className="space-y-3">
                  <div>
                    <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-2">Team (filters players)</p>
                    <TeamGrid teams={teams} selectedId={fields.team_id} onSelect={id => { setField('team_id', id); setField('player_id', null); }} compact />
                  </div>
                  <div>
                    <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-2">Player</p>
                    <PlayerGrid teamId={fields.team_id} selectedId={fields.player_id} onSelect={selectPlayer} onAddPlayer={() => setShowAddPlayer(true)} />
                  </div>
                </div>
              )}

              {/* Numeric / dropdown params */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {TYPES_WITH_OVER.has(type) && (
                  <NumInput label={phase === 'by_over' ? 'By end of over' : 'Over number'}
                            min={1} value={fields.over} onChange={v => setField('over', v)} />
                )}
                {TYPES_WITH_INNINGS.has(type) && (
                  <Select label="Innings" value={fields.innings_number || ''} onChange={v => setField('innings_number', v)}
                          options={[{ value: '', label: 'Pick…' }, { value: 1, label: '1st innings' }, { value: 2, label: '2nd innings' }]} />
                )}
                {TYPES_WITH_OPERATOR.has(type) && (
                  <>
                    <Select label="Operator" value={fields.operator || '>='} onChange={v => setField('operator', v)} options={OP_OPTIONS} />
                    <NumInput label={type === 'innings_score' ? 'Run target' : 'Runs threshold'}
                              value={fields.threshold} onChange={v => setField('threshold', v)} />
                  </>
                )}
                {TYPES_WITH_MILESTONE.has(type) && (
                  <NumInput label="Milestone (runs)" value={fields.milestone} onChange={v => setField('milestone', v)} />
                )}
                {TYPES_WITH_MIN_WICKETS.has(type) && (
                  <NumInput label="Min wickets" min={1} value={fields.min_wickets || 1} onChange={v => setField('min_wickets', v)}
                            hint={['wicket_over','wickets_powerplay','wickets_death'].includes(type) ? '2+ in one over is rare — usually 1' : null} />
                )}
                {TYPES_WITH_BOUNDARY.has(type) && (
                  <>
                    <Select label="Boundary type" value={fields.boundary_type || 'six'} onChange={v => setField('boundary_type', v)}
                            options={[{ value: 'six', label: 'Six' }, { value: 'four', label: 'Four' }]} />
                    <NumInput label="Min count" min={1} value={fields.boundary_count || 1} onChange={v => setField('boundary_count', v)} />
                  </>
                )}
                {phase === 'season' && (
                  <Select label="Season" value={fields.season_code || DEFAULT_SEASON_CODE} onChange={v => setField('season_code', v)}
                          options={SEASON_CODES.map(c => ({ value: c, label: c }))} />
                )}
                {TYPES_WITH_SEASON_POSITION.has(type) && (
                  <NumInput label="Top N finish" min={1} value={fields.threshold_position}
                            onChange={v => setField('threshold_position', v)} hint="e.g. 4 for top 4" />
                )}
                {TYPES_WITH_SEASON_RUN_TOTAL.has(type) && (
                  <NumInput label="Runs this season" min={1} value={fields.threshold}
                            onChange={v => setField('threshold', v)} hint="e.g. 600" />
                )}
                {TYPES_WITH_SEASON_WKT_TOTAL.has(type) && (
                  <NumInput label="Wickets this season" min={1} value={fields.threshold}
                            onChange={v => setField('threshold', v)} hint="e.g. 20" />
                )}
              </div>

              {/* Resolve mode */}
              <div>
                <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-1">Resolve mode</p>
                {phase === 'season' ? (
                  <p className="text-[11px] text-gray-500 dark:text-gray-400">Manual — CricAPI can't track league standings, so you settle these at season end.</p>
                ) : (
                  <>
                    <div className="flex gap-3 text-sm">
                      <label className="flex items-center gap-2"><input type="radio" name="rm" value="auto" checked={resolveMode === 'auto'} onChange={() => setResolveMode('auto')} /> Auto (CricAPI)</label>
                      <label className="flex items-center gap-2"><input type="radio" name="rm" value="manual" checked={resolveMode === 'manual'} onChange={() => setResolveMode('manual')} /> Manual</label>
                    </div>
                    {isCustomType && (
                      <p className="text-[10px] text-gray-400 mt-1">Custom contracts are manual-resolve only.</p>
                    )}
                  </>
                )}
              </div>

              {error && <p className="text-sm text-red-600">{error}</p>}

              <div className="flex gap-2">
                <button onClick={() => submit('draft')} disabled={submitting} className="flex-1 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 font-semibold text-sm hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50">
                  {submitting ? '…' : (editing?.id ? 'Save Changes' : 'Save as Draft')}
                </button>
                <button onClick={() => submit('active')} disabled={submitting} className="flex-1 py-3 rounded-xl bg-navy-800 text-white font-bold text-sm hover:bg-navy-700 disabled:opacity-50">
                  {submitting ? '…' : (editing?.id ? 'Save & Publish' : 'Publish Now')}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Live preview */}
        <div className="lg:col-span-2">
          <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-2">Live preview</p>
          {type ? <PreviewCard contract={preview} /> : (
            <div className="rounded-2xl border-2 border-dashed border-gray-200 dark:border-gray-600 p-6 text-center text-xs text-gray-400">
              Pick a phase and type to see the card
            </div>
          )}
        </div>
      </div>

      {showAddPlayer && (
        <AddPlayerModal
          teamId={fields.team_id}
          teamName={teams.find(t => t.id === fields.team_id)?.name || 'team'}
          onSave={(p) => {
            setCachedPlayers(prev => ({ ...prev, [p.id]: p }));
            selectPlayer(p.id);
            setShowAddPlayer(false);
          }}
          onCancel={() => setShowAddPlayer(false)}
        />
      )}
    </div>
  );
}
