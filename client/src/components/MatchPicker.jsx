// MatchPicker — optional dropdown shown in the admin contract builder that tags
// a contract with a specific Cricbuzz match ID. Removable: drop the <MatchPicker>
// usage in ContractBuilder and delete this file; the rest of the app is unaffected.
//
// Today the selected match_id is stored on contracts.match_id but the resolver
// doesn't route on it yet — this is metadata for the upcoming per-match resolver.

import { useEffect, useState } from 'react';

const STATE_BADGE = {
  'In Progress':   'bg-red-100 text-red-800 border-red-200',
  'Innings Break': 'bg-amber-100 text-amber-800 border-amber-200',
  'Toss':          'bg-amber-100 text-amber-800 border-amber-200',
  'Preview':       'bg-blue-50 text-blue-700 border-blue-200',
  'Upcoming':      'bg-blue-50 text-blue-700 border-blue-200',
  'Complete':      'bg-gray-100 text-gray-600 border-gray-200',
};

export default function MatchPicker({ value, onChange, seriesFilter = 'Indian Premier League' }) {
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showAll, setShowAll] = useState(false);

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

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">
          Match <span className="font-normal normal-case text-gray-400">(optional — tags this contract to a specific Cricbuzz match)</span>
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
        onChange={e => onChange(e.target.value || null)}
        disabled={loading}
        className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-navy-800"
      >
        <option value="">— none (inherit global match) —</option>
        {matches.map(m => {
          const teams = m.teams.map(t => t.shortName).filter(Boolean).join(' vs ');
          const label = `${teams || 'Unknown'}  ·  ${m.state || '?'}  ·  ${m.matchDesc || ''} (${m.format || '?'})`;
          return <option key={m.matchId} value={m.matchId}>{label}</option>;
        })}
      </select>

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
