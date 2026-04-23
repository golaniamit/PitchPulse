// MatchPicker — dropdown shown in the contract builder that tags a contract
// with a specific Cricbuzz match ID. When `required` is true (auto-resolve
// contracts), a red-border + asterisk variant is shown and blank selection
// is treated as invalid. Optional otherwise (manual / season / custom types).

import { useEffect, useState } from 'react';

const STATE_BADGE = {
  'In Progress':   'bg-red-100 text-red-800 border-red-200',
  'Innings Break': 'bg-amber-100 text-amber-800 border-amber-200',
  'Toss':          'bg-amber-100 text-amber-800 border-amber-200',
  'Preview':       'bg-blue-50 text-blue-700 border-blue-200',
  'Upcoming':      'bg-blue-50 text-blue-700 border-blue-200',
  'Complete':      'bg-gray-100 text-gray-600 border-gray-200',
};

export default function MatchPicker({ value, onChange, seriesFilter = 'Indian Premier League', required = false }) {
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showAll, setShowAll] = useState(false);
  // Only flag as invalid after the user has seen the picker at least once —
  // avoids shouting "required" at them the instant the form renders.
  const [touched, setTouched] = useState(false);
  const showError = required && touched && !value;

  async function load(useFilter) {
    setLoading(true); setError('');
    try {
      const qs = useFilter && seriesFilter ? `?series=${encodeURIComponent(seriesFilter)}` : '';
      const r = await fetch(`/api/admin/cricbuzz-matches${qs}`, { credentials: 'include' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setMatches(d.matches || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(!showAll); /* eslint-disable-next-line */ }, [showAll, seriesFilter]);

  const selected = matches.find(m => String(m.matchId) === String(value));

  // External callers (ContractBuilder) can ask us to surface the required-but-blank
  // error banner without requiring the user to interact first — they do so by
  // flipping the picker into "touched" on submit attempt.
  // Exposed via effect below so the parent's onChange flow doesn't lose focus.

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className={`text-[11px] font-bold uppercase tracking-wide ${showError ? 'text-red-600' : 'text-gray-500'}`}>
          Match {required
            ? <span className="text-red-600">*</span>
            : <span className="font-normal normal-case text-gray-400">(optional — tags this contract to a specific Cricbuzz match)</span>
          }
          {required && (
            <span className="font-normal normal-case text-gray-400 ml-1">
              · required for auto-resolve
            </span>
          )}
        </p>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setShowAll(s => !s)}
            className="text-[11px] text-gray-500 hover:text-navy-800 underline">
            {showAll ? `Show ${seriesFilter} only` : 'Show all series'}
          </button>
          <button type="button" onClick={() => load(!showAll)}
            className="text-[11px] text-gray-500 hover:text-navy-800 underline">
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      <select
        value={value || ''}
        onChange={e => { setTouched(true); onChange(e.target.value || null); }}
        onBlur={() => setTouched(true)}
        disabled={loading}
        className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 dark:bg-gray-700 dark:text-gray-100 ${
          showError
            ? 'border-red-400 focus:ring-red-500/40 dark:border-red-500'
            : 'border-gray-200 dark:border-gray-600 focus:ring-navy-800'
        }`}
      >
        <option value="">
          {required ? '— Pick a match to auto-resolve against —' : '— none (inherit global match) —'}
        </option>
        {matches.map(m => {
          const teams = m.teams.map(t => t.shortName).filter(Boolean).join(' vs ');
          const label = `${teams || 'Unknown'}  ·  ${m.state || '?'}  ·  ${m.matchDesc || ''} (${m.format || '?'})`;
          return <option key={m.matchId} value={m.matchId}>{label}</option>;
        })}
      </select>

      {showError && (
        <p className="text-xs text-red-600">
          Required — the resolver polls per match. Switch to manual resolve if you don't want to tag a match.
        </p>
      )}
      {error && <p className="text-xs text-red-600">Could not load Cricbuzz matches: {error}</p>}

      {selected && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
          <span className={`px-2 py-0.5 rounded-full border ${STATE_BADGE[selected.state] || STATE_BADGE.Preview}`}>
            {selected.state}
          </span>
          <span className="text-gray-500">{selected.seriesName}</span>
          {selected.venue && <span className="text-gray-400">· {selected.venue}</span>}
          <span className="text-gray-400">· id {selected.matchId}</span>
        </div>
      )}
    </div>
  );
}
