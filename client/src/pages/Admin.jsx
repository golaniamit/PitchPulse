import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const CONTRACT_TYPES = [
  { id: 'runs_over', label: 'Runs in over', icon: '🏃' },
  { id: 'wicket_over', label: 'Wicket in over', icon: '🎯' },
  { id: 'team_total', label: 'Team total by over', icon: '📊' },
  { id: 'batsman_milestone', label: 'Batsman milestone', icon: '🦁' },
  { id: 'boundary_over', label: 'Six / Four in over', icon: '💥' },
  { id: 'manual', label: 'Custom / Manual', icon: '✍️' },
];

function buildConditionJson(type, fields) {
  if (type === 'runs_over') return { type, team: fields.team, over: +fields.over, operator: fields.operator, threshold: +fields.threshold };
  if (type === 'wicket_over') return { type, batting_team: fields.team, over: +fields.over, min_wickets: +fields.min_wickets };
  if (type === 'team_total') return { type, team: fields.team, by_over: +fields.over, operator: fields.operator, threshold: +fields.threshold };
  if (type === 'batsman_milestone') return { type, batsman: fields.batsman, milestone: +fields.milestone, by_over: +fields.over };
  if (type === 'boundary_over') return { type, team: fields.team, over: +fields.over, boundary_type: fields.boundary_type };
  return { type: 'manual' };
}

function buildTitle(type, fields) {
  if (type === 'runs_over') return `Will ${fields.team || '...'} score ${fields.operator || '>='} ${fields.threshold || 'N'} runs in over ${fields.over || 'N'}?`;
  if (type === 'wicket_over') return `Will ${fields.team || '...'} lose ${fields.min_wickets || 1}+ wicket(s) in over ${fields.over || 'N'}?`;
  if (type === 'team_total') return `Will ${fields.team || '...'} reach ${fields.threshold || 'N'} runs by over ${fields.over || 'N'}?`;
  if (type === 'batsman_milestone') return `Will ${fields.batsman || '...'} score ${fields.milestone || 'N'}+ runs by over ${fields.over || 'N'}?`;
  if (type === 'boundary_over') return `Will ${fields.team || '...'} hit a ${fields.boundary_type || 'six'} in over ${fields.over || 'N'}?`;
  return fields.custom_title || '...';
}

// Field wrapper with an uppercase label. MUST live at module scope —
// if defined inside ContractFields it gets a fresh function reference on
// every keystroke, which causes React to remount the child <input> and
// the cursor loses focus after every character typed.
function Labeled({ label, children }) {
  return (
    <label className="block">
      <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1 block">
        {label}
      </span>
      {children}
    </label>
  );
}

function ContractFields({ type, fields, onChange, teams }) {
  const inp = (name, placeholder, type2 = 'text') => (
    <input
      type={type2}
      placeholder={placeholder}
      value={fields[name] || ''}
      onChange={e => onChange(name, e.target.value)}
      className="border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-navy-800"
    />
  );
  const sel = (name, opts) => (
    <select
      value={fields[name] || ''}
      onChange={e => onChange(name, e.target.value)}
      className="border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm w-full bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-navy-800"
    >
      <option value="">Select…</option>
      {opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
  const teamPicker = (name, placeholder) => teams?.length >= 2
    ? sel(name, teams.map(t => ({ value: t, label: t })))
    : inp(name, placeholder);

  const OP_OPTIONS = [
    { value: '>=', label: '≥ (at least)' },
    { value: '>',  label: '> (more than)' },
    { value: '<=', label: '≤ (at most)'   },
  ];

  if (type === 'runs_over') return (
    <div className="grid grid-cols-2 gap-3">
      <Labeled label="Team">{teamPicker('team', 'e.g. CSK')}</Labeled>
      <Labeled label="Over number">{inp('over', '1–20', 'number')}</Labeled>
      <Labeled label="Operator">{sel('operator', OP_OPTIONS)}</Labeled>
      <Labeled label="Runs threshold">{inp('threshold', 'e.g. 10', 'number')}</Labeled>
    </div>
  );
  if (type === 'wicket_over') return (
    <div className="grid grid-cols-2 gap-3">
      <Labeled label="Batting team">{teamPicker('team', 'e.g. CSK')}</Labeled>
      <Labeled label="Over number">{inp('over', '1–20', 'number')}</Labeled>
      <Labeled label="Minimum wickets">{inp('min_wickets', 'e.g. 1', 'number')}</Labeled>
    </div>
  );
  if (type === 'team_total') return (
    <div className="grid grid-cols-2 gap-3">
      <Labeled label="Team">{teamPicker('team', 'e.g. CSK')}</Labeled>
      <Labeled label="By end of over">{inp('over', '1–20', 'number')}</Labeled>
      <Labeled label="Operator">{sel('operator', OP_OPTIONS)}</Labeled>
      <Labeled label="Run target">{inp('threshold', 'e.g. 150', 'number')}</Labeled>
    </div>
  );
  if (type === 'batsman_milestone') return (
    <div className="grid grid-cols-2 gap-3">
      <Labeled label="Batsman name">{inp('batsman', 'e.g. MS Dhoni')}</Labeled>
      <Labeled label="Milestone (runs)">{inp('milestone', 'e.g. 50', 'number')}</Labeled>
      <Labeled label="By end of over">{inp('over', '1–20', 'number')}</Labeled>
    </div>
  );
  if (type === 'boundary_over') return (
    <div className="grid grid-cols-2 gap-3">
      <Labeled label="Team">{teamPicker('team', 'e.g. CSK')}</Labeled>
      <Labeled label="Over number">{inp('over', '1–20', 'number')}</Labeled>
      <Labeled label="Boundary type">{sel('boundary_type', [{value:'six',label:'Six'},{value:'four',label:'Four'}])}</Labeled>
    </div>
  );
  if (type === 'manual') return (
    <Labeled label="Custom question">
      <input
        placeholder="e.g. Will MS Dhoni come out to bat today?"
        value={fields.custom_title || ''}
        onChange={e => onChange('custom_title', e.target.value)}
        className="border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-navy-800"
      />
    </Labeled>
  );
  return null;
}

// Two-step resolve modal
// Step 1: confirm intent  Step 2: pick YES or NO
function ResolveModal({ contract, onConfirm, onCancel }) {
  const [step, setStep] = useState(1); // 1 = confirm, 2 = pick outcome
  const [resolution, setResolution] = useState(null);
  const [confirming, setConfirming] = useState(false);

  async function confirm() {
    setConfirming(true);
    await onConfirm(resolution);
    setConfirming(false);
  }

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={onCancel}
    >
      {/* Modal */}
      <div
        className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4"
        onClick={e => e.stopPropagation()}
      >
        {step === 1 && (
          <>
            <div className="text-center">
              <div className="text-3xl mb-2">⚠️</div>
              <h2 className="font-bold text-gray-900 dark:text-gray-100 text-lg">Resolve contract?</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-2 leading-snug">"{contract.title}"</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-3">This will settle all positions and pay out winners. This cannot be undone.</p>
            </div>
            <div className="flex gap-2 pt-2">
              <button
                onClick={onCancel}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => setStep(2)}
                className="flex-1 py-2.5 rounded-xl bg-navy-800 text-white text-sm font-semibold hover:bg-navy-700 transition-colors"
              >
                Resolve
              </button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <div>
              <button onClick={() => setStep(1)} className="text-xs text-gray-400 hover:text-gray-600 mb-3 flex items-center gap-1">
                ← Back
              </button>
              <h2 className="font-bold text-gray-900 dark:text-gray-100 text-lg">How did it resolve?</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 leading-snug">"{contract.title}"</p>
            </div>

            {/* YES / NO picker */}
            <div className="flex gap-3">
              <button
                onClick={() => setResolution('YES')}
                className={`flex-1 py-4 rounded-xl font-bold text-base border-2 transition-all ${
                  resolution === 'YES'
                    ? 'bg-yes border-yes text-white scale-105'
                    : 'border-gray-200 text-gray-500 hover:border-yes hover:text-yes'
                }`}
              >
                ✓ YES
              </button>
              <button
                onClick={() => setResolution('NO')}
                className={`flex-1 py-4 rounded-xl font-bold text-base border-2 transition-all ${
                  resolution === 'NO'
                    ? 'bg-no border-no text-white scale-105'
                    : 'border-gray-200 text-gray-500 hover:border-no hover:text-no'
                }`}
              >
                ✗ NO
              </button>
            </div>

            <div className="flex gap-2 pt-1">
              <button
                onClick={onCancel}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirm}
                disabled={!resolution || confirming}
                className="flex-1 py-2.5 rounded-xl bg-navy-800 text-white text-sm font-semibold hover:bg-navy-700 transition-colors disabled:opacity-40"
              >
                {confirming ? 'Resolving...' : `Confirm ${resolution || '—'}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function MatchSelector({ onTeamsChange }) {
  const [activeMatch, setActiveMatch] = useState(null);
  const [matches, setMatches] = useState([]);
  const [loadingMatches, setLoadingMatches] = useState(false);
  const [matchError, setMatchError] = useState('');
  const [setting, setSetting] = useState(false);
  const [apiEnabled, setApiEnabled] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [pollMinutes, setPollMinutes] = useState(2);
  const [intervalInput, setIntervalInput] = useState('2');
  const [savingInterval, setSavingInterval] = useState(false);
  const [iplOnly, setIplOnly] = useState(true);   // most relevant to this app; still allows other if toggled off

  useEffect(() => {
    fetch('/api/admin/active-match', { credentials: 'include' })
      .then(r => r.json())
      .then(d => {
        setActiveMatch(d);
        if (d.teams?.length) onTeamsChange(d.teams);
        setApiEnabled(d.apiEnabled ?? false);
        setPollMinutes(d.pollMinutes ?? 2);
        setIntervalInput(String(d.pollMinutes ?? 2));
      })
      .catch(() => {});
  }, []);

  async function toggleApi() {
    setToggling(true);
    try {
      const r = await fetch('/api/admin/toggle-api', { method: 'POST', credentials: 'include' });
      const d = await r.json();
      setApiEnabled(d.enabled);
    } catch { /* ignore */ } finally {
      setToggling(false);
    }
  }

  async function applyInterval() {
    const mins = parseInt(intervalInput);
    if (!mins || mins < 1) return;
    setSavingInterval(true);
    try {
      await fetch('/api/admin/set-poll-interval', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ minutes: mins }),
      });
      setPollMinutes(mins);
    } catch { /* ignore */ } finally {
      setSavingInterval(false);
    }
  }

  async function loadMatches() {
    setLoadingMatches(true); setMatchError('');
    try {
      const r = await fetch('/api/admin/matches', { credentials: 'include' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setMatches(d.matches || []);
    } catch (e) {
      setMatchError(e.message);
    } finally {
      setLoadingMatches(false);
    }
  }

  async function selectMatch(m) {
    setSetting(m.id);
    try {
      const r = await fetch('/api/admin/set-match', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matchId: m.id, matchName: m.name, teams: m.teams }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      const updatedMatch = { matchId: m.id, matchName: m.name, apiKeySet: true, teams: m.teams || [] };
      setActiveMatch(updatedMatch);
      if (m.teams?.length) onTeamsChange(m.teams);
      setMatches([]);
    } catch (e) {
      setMatchError(e.message);
    } finally {
      setSetting(false);
    }
  }

  const apiKeyMissing = activeMatch && !activeMatch.apiKeySet;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-gray-900 dark:text-gray-100">Live Match</h2>
        <div className="flex items-center gap-2">
          {activeMatch?.apiKeySet && (
            <button
              onClick={toggleApi}
              disabled={toggling}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 focus:outline-none ${
                apiEnabled ? 'bg-green-500' : 'bg-gray-300'
              } ${toggling ? 'opacity-50' : ''}`}
              title={apiEnabled ? 'CricAPI ON — click to disable' : 'CricAPI OFF — click to enable'}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-200 ${
                apiEnabled ? 'translate-x-6' : 'translate-x-1'
              }`} />
            </button>
          )}
          <span className={`text-xs px-2 py-0.5 rounded-full ${
            !activeMatch?.apiKeySet
              ? 'text-amber-700 bg-amber-50'
              : apiEnabled
                ? 'text-green-700 bg-green-50'
                : 'text-gray-500 bg-gray-100'
          }`}>
            {!activeMatch?.apiKeySet ? 'API key not set' : apiEnabled ? 'API ON' : 'API OFF'}
          </span>
        </div>
      </div>

      {/* Poll interval control — only shown when API key is set */}
      {activeMatch?.apiKeySet && (
        <div className="flex items-center gap-2 bg-gray-50 dark:bg-gray-700 rounded-xl px-3 py-2">
          <span className="text-xs text-gray-500 dark:text-gray-400 flex-shrink-0">Poll every</span>
          <input
            type="number"
            min="1"
            max="60"
            value={intervalInput}
            onChange={e => setIntervalInput(e.target.value)}
            className="w-14 border border-gray-200 rounded-lg px-2 py-1 text-sm text-center focus:outline-none focus:ring-2 focus:ring-navy-800"
          />
          <span className="text-xs text-gray-500 dark:text-gray-400 flex-shrink-0">min</span>
          <button
            onClick={applyInterval}
            disabled={savingInterval || parseInt(intervalInput) === pollMinutes}
            className="ml-auto text-xs bg-navy-800 text-white px-3 py-1.5 rounded-lg hover:bg-navy-700 disabled:opacity-40 transition-colors"
          >
            {savingInterval ? 'Saving...' : 'Apply'}
          </button>
          <span className="text-xs text-gray-400">
            {pollMinutes === 1 ? '(current: 1 min)' : `(current: ${pollMinutes} min)`}
          </span>
        </div>
      )}

      {apiKeyMissing && (
        <p className="text-xs text-amber-700 bg-amber-50 rounded-lg p-2">
          Add your CricAPI key to <code className="font-mono">.env</code> as <code className="font-mono">CRIC_API_KEY</code> and restart the server.
        </p>
      )}

      {activeMatch?.matchId ? (
        <div className="bg-gray-50 dark:bg-gray-700 rounded-xl p-3 flex items-center justify-between">
          <div>
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-0.5">Currently tracking</p>
            <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">{activeMatch.matchName || activeMatch.matchId}</p>
          </div>
          <span className="text-green-600 text-lg">✓</span>
        </div>
      ) : (
        <p className="text-xs text-gray-400">No match selected. Load matches to pick one.</p>
      )}

      {matches.length === 0 ? (
        <button
          onClick={loadMatches}
          disabled={loadingMatches || apiKeyMissing}
          className="w-full py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-40"
        >
          {loadingMatches ? 'Loading...' : 'Load Matches from CricAPI'}
        </button>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-400">Tap a match to set it as active:</p>
            <label className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={iplOnly}
                onChange={e => setIplOnly(e.target.checked)}
                className="accent-navy-800 w-3.5 h-3.5"
              />
              IPL only
            </label>
          </div>
          {(iplOnly
            ? matches.filter(m => /ipl|indian premier league/i.test([m.name, m.matchType].filter(Boolean).join(' ')))
            : matches
          ).map(m => (
            <button
              key={m.id}
              onClick={() => selectMatch(m)}
              disabled={!!setting}
              className={`w-full text-left border rounded-xl p-3 transition-colors ${
                activeMatch?.matchId === m.id
                  ? 'border-navy-800 bg-navy-800/5'
                  : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{m.name}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{m.venue} · {m.matchType}</p>
                </div>
                <div className="flex-shrink-0 text-right">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    m.status?.toLowerCase().includes('live') || m.status?.toLowerCase().includes('progress')
                      ? 'text-green-700 bg-green-50'
                      : 'text-gray-500 bg-gray-100'
                  }`}>
                    {setting === m.id ? 'Setting...' : (m.status || 'Upcoming')}
                  </span>
                </div>
              </div>
            </button>
          ))}
          <button
            onClick={() => setMatches([])}
            className="text-xs text-gray-400 hover:text-gray-600 w-full text-center py-1"
          >
            Dismiss
          </button>
        </div>
      )}

      {matchError && <p className="text-xs text-red-600">{matchError}</p>}
    </div>
  );
}

function BotsControl() {
  const [intensity, setIntensity] = useState(null);
  const [stats, setStats] = useState(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    try {
      const r = await fetch('/api/admin/bots', { credentials: 'include' });
      const d = await r.json();
      if (!r.ok) return;
      setIntensity(d.intensity);
      setStats(d.stats);
    } catch { /* ignore */ }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);

  async function setLevel(level) {
    if (level === intensity || saving) return;
    setSaving(true);
    try {
      const r = await fetch('/api/admin/bots/intensity', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level }),
      });
      const d = await r.json();
      if (r.ok) setIntensity(d.intensity);
      load();
    } catch { /* ignore */ } finally {
      setSaving(false);
    }
  }

  const LABELS = [
    { n: 0, label: 'Off', desc: 'No new bot trades' },
    { n: 1, label: 'Low', desc: 'Sparse background activity' },
    { n: 2, label: 'Moderate', desc: 'Default dev behaviour' },
    { n: 3, label: 'High', desc: 'Frequent orders — for empty markets' },
  ];

  const current = LABELS.find(l => l.n === intensity);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-gray-900 dark:text-gray-100">Bots</h2>
        <span className={`text-xs px-2 py-0.5 rounded-full ${
          intensity === 0
            ? 'text-gray-500 bg-gray-100 dark:bg-gray-700 dark:text-gray-300'
            : 'text-green-700 bg-green-50 dark:bg-green-900/30 dark:text-green-300'
        }`}>
          {intensity === null ? '...' : (intensity === 0 ? 'Dormant' : `Active — ${current?.label}`)}
        </span>
      </div>

      <div className="grid grid-cols-4 gap-2">
        {LABELS.map(l => (
          <button
            key={l.n}
            onClick={() => setLevel(l.n)}
            disabled={saving || intensity === null}
            className={`rounded-xl border p-2.5 text-center transition-colors ${
              intensity === l.n
                ? 'border-navy-800 bg-navy-800 text-white'
                : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 text-gray-700 dark:text-gray-200'
            } disabled:opacity-50`}
          >
            <div className="text-lg font-bold">{l.n}</div>
            <div className="text-xs font-medium leading-tight">{l.label}</div>
          </button>
        ))}
      </div>

      {current && (
        <p className="text-xs text-gray-500 dark:text-gray-400 px-1">
          {current.desc}
        </p>
      )}

      {stats && (
        <div className="bg-gray-50 dark:bg-gray-700 rounded-xl px-3 py-2 text-xs text-gray-500 dark:text-gray-400 flex flex-wrap gap-x-4 gap-y-1">
          <span><span className="font-semibold text-gray-700 dark:text-gray-200">{stats.ordersLastHour}</span> orders / last hour</span>
          <span><span className="font-semibold text-gray-700 dark:text-gray-200">{stats.activeContracts}</span> active contracts</span>
          <span><span className="font-semibold text-gray-700 dark:text-gray-200">{stats.botCount}</span> bots · {stats.totalBalance.toLocaleString()} coins</span>
        </div>
      )}
    </div>
  );
}

function UserStats() {
  const [stats, setStats] = useState(null);

  async function load() {
    try {
      const r = await fetch('/api/admin/user-stats', { credentials: 'include' });
      if (!r.ok) return;
      setStats(await r.json());
    } catch { /* ignore */ }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  const active = stats?.activeUsers ?? 0;
  const total  = stats?.totalUsers ?? 0;
  const names  = stats?.activeUsernames || [];

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-gray-900 dark:text-gray-100">Players</h2>
        <span className="text-xs text-gray-400 dark:text-gray-500">live · refreshes every 5s</span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-gray-200 dark:border-gray-600 p-3">
          <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Online now</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-gray-900 dark:text-gray-100">{stats === null ? '…' : active}</span>
            <span className={`inline-block h-2 w-2 rounded-full ${active > 0 ? 'bg-green-500 animate-pulse' : 'bg-gray-300 dark:bg-gray-600'}`} />
          </div>
        </div>
        <div className="rounded-xl border border-gray-200 dark:border-gray-600 p-3">
          <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Registered</div>
          <div className="mt-1 text-2xl font-bold text-gray-900 dark:text-gray-100">{stats === null ? '…' : total}</div>
        </div>
      </div>

      {names.length > 0 && (
        <div className="bg-gray-50 dark:bg-gray-700 rounded-xl px-3 py-2 text-xs text-gray-500 dark:text-gray-400">
          <span className="font-semibold text-gray-700 dark:text-gray-200">Online:</span>{' '}
          {names.join(', ')}
        </div>
      )}
    </div>
  );
}

export default function Admin() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [contracts, setContracts] = useState([]);
  const [matchTeams, setMatchTeams] = useState([]);
  const [selectedType, setSelectedType] = useState(null);
  const [fields, setFields] = useState({});
  const [resolveMode, setResolveMode] = useState('manual');
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState(null);  // non-null when editing a draft in place
  const [error, setError] = useState('');
  const [resolvingContract, setResolvingContract] = useState(null);
  const [adminTab, setAdminTab] = useState('all');       // filter for the "All contracts" list
  const builderRef = useRef(null);                        // lets "Duplicate" scroll back to the builder

  useEffect(() => {
    if (!user?.is_admin) { navigate('/'); return; }
    loadContracts();
  }, [user]);

  async function loadContracts() {
    const r = await fetch('/api/contracts', { credentials: 'include' });
    const d = await r.json();
    setContracts(d.contracts || []);
  }

  function fieldChange(name, value) {
    setFields(f => ({ ...f, [name]: value }));
  }

  const title = selectedType ? buildTitle(selectedType, fields) : '';

  // Submits the builder. `publishStatus` is 'active' (Publish Now / Save & Publish)
  // or 'draft' (Save as Draft / Save Changes). If editingId is set, PATCH the
  // existing draft; otherwise POST a new contract.
  async function submitContract(publishStatus) {
    if (!selectedType) return;
    setError(''); setCreating(true);
    const condition = selectedType !== 'manual' ? buildConditionJson(selectedType, fields) : null;
    const contractTitle = selectedType === 'manual' ? (fields.custom_title || 'Manual contract') : title;
    const payload = { title: contractTitle, type: selectedType, condition_json: condition, resolve_mode: resolveMode, status: publishStatus };
    try {
      const url    = editingId ? `/api/contracts/${editingId}` : '/api/contracts';
      const method = editingId ? 'PATCH' : 'POST';
      const r = await fetch(url, {
        method,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      resetBuilder();
      loadContracts();
    } catch (e) {
      setError(e.message);
    } finally {
      setCreating(false);
    }
  }

  function resetBuilder() {
    setSelectedType(null);
    setFields({});
    setResolveMode('manual');
    setEditingId(null);
    setError('');
  }

  // Loads an existing draft into the builder for in-place editing.
  function editContract(c) {
    setEditingId(c.id);
    setSelectedType(c.type);
    setResolveMode(c.resolve_mode || 'manual');
    let parsed = {};
    try { parsed = c.condition_json ? JSON.parse(c.condition_json) : {}; } catch {}
    const mapped = { ...parsed };
    if (c.type === 'manual') mapped.custom_title = c.title;
    setFields(mapped);
    setError('');
    builderRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function resolveContract(resolution) {
    await fetch(`/api/contracts/${resolvingContract.id}/resolve`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resolution }),
    });
    setResolvingContract(null);
    loadContracts();
  }

  async function setContractStatus(id, newStatus) {
    await fetch(`/api/contracts/${id}/status`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    });
    loadContracts();
  }

  // "Duplicate" — pre-fills the contract builder from an existing contract's data
  // as a brand-new draft (not linked to the original), then scrolls back to the builder.
  function duplicateContract(c) {
    setEditingId(null);
    setSelectedType(c.type);
    setResolveMode(c.resolve_mode || 'manual');
    let parsed = {};
    try { parsed = c.condition_json ? JSON.parse(c.condition_json) : {}; } catch {}
    // Map the condition JSON back to form field names (same as buildConditionJson, reversed).
    const mapped = { ...parsed };
    if (c.type === 'manual') mapped.custom_title = c.title;
    setFields(mapped);
    builderRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // 5.2 — filter the admin's "All Contracts" list by status
  const ADMIN_TABS = ['all', 'active', 'draft', 'resolved', 'cancelled'];
  const tabCounts = ADMIN_TABS.reduce((acc, t) => {
    acc[t] = t === 'all' ? contracts.length : contracts.filter(c => c.status === t).length;
    return acc;
  }, {});
  const filteredContracts = adminTab === 'all' ? contracts : contracts.filter(c => c.status === adminTab);

  const statusColor = { active: 'text-green-700 bg-green-50', draft: 'text-gray-600 bg-gray-50', resolved: 'text-blue-700 bg-blue-50', cancelled: 'text-red-600 bg-red-50' };


  return (
    <>
      {/* Resolve modal */}
      {resolvingContract && (
        <ResolveModal
          contract={resolvingContract}
          onConfirm={resolveContract}
          onCancel={() => setResolvingContract(null)}
        />
      )}

      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        {/* Match selector */}
        <MatchSelector onTeamsChange={setMatchTeams} />

        {/* Bots + live player count — side by side on desktop */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <BotsControl />
          <UserStats />
        </div>

        {/* Contract builder */}
        <div ref={builderRef} className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold text-gray-900 dark:text-gray-100">
              {editingId ? `Edit Contract #${editingId}` : 'Create Contract'}
            </h2>
            {editingId && (
              <button
                onClick={resetBuilder}
                className="text-xs text-gray-500 dark:text-gray-400 hover:text-red-600 border border-gray-200 dark:border-gray-600 px-3 py-1 rounded-lg"
              >
                Cancel edit
              </button>
            )}
          </div>

          <div className="grid grid-cols-3 gap-2 mb-4">
            {CONTRACT_TYPES.map(ct => (
              <button
                key={ct.id}
                onClick={() => { setSelectedType(ct.id); setFields({}); }}
                className={`rounded-xl border p-2.5 text-center transition-colors ${
                  selectedType === ct.id
                    ? 'border-navy-800 bg-navy-800 text-white'
                    : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500 text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700'
                }`}
              >
                <div className="text-xl mb-0.5">{ct.icon}</div>
                <div className="text-xs font-medium leading-tight">{ct.label}</div>
              </button>
            ))}
          </div>

          {selectedType && (
            <div className="space-y-3">
              <ContractFields type={selectedType} fields={fields} onChange={fieldChange} teams={matchTeams} />
              <div>
                <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Resolve mode</label>
                <select value={resolveMode} onChange={e => setResolveMode(e.target.value)} className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-gray-100">
                  <option value="manual">Manual</option>
                  <option value="auto">Auto (CricAPI)</option>
                </select>
              </div>
              {title && (
                <div className="bg-gray-50 dark:bg-gray-700 rounded-xl p-3 border border-dashed border-gray-200 dark:border-gray-600">
                  <p className="text-xs text-gray-400 dark:text-gray-500 mb-1 uppercase tracking-wide">Preview</p>
                  <p className="text-sm font-medium text-gray-800 dark:text-gray-100">{title}</p>
                </div>
              )}
              {error && <p className="text-red-600 text-sm">{error}</p>}
              <div className="flex gap-2">
                <button
                  onClick={() => submitContract('draft')}
                  disabled={creating}
                  className="flex-1 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 py-3 rounded-xl font-semibold text-sm hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors disabled:opacity-50"
                >
                  {creating ? '...' : (editingId ? 'Save Changes' : 'Save as Draft')}
                </button>
                <button
                  onClick={() => submitContract('active')}
                  disabled={creating}
                  className="flex-1 bg-navy-800 text-white py-3 rounded-xl font-bold text-sm hover:bg-navy-700 transition-colors disabled:opacity-50"
                >
                  {creating ? '...' : (editingId ? 'Save & Publish' : 'Publish Now')}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* All contracts dashboard */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5">
          <h2 className="font-bold text-gray-900 dark:text-gray-100 mb-4">All Contracts</h2>

          {/* Status filter tabs */}
          <div className="flex flex-wrap gap-1 bg-gray-100 dark:bg-gray-900 rounded-xl p-1 mb-4">
            {ADMIN_TABS.map(t => (
              <button
                key={t}
                onClick={() => setAdminTab(t)}
                className={`flex-1 min-w-[70px] py-1.5 rounded-lg text-xs font-semibold capitalize transition-colors ${
                  adminTab === t
                    ? 'bg-white dark:bg-gray-700 text-navy-800 dark:text-white shadow-sm'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                }`}
              >
                {t} <span className="font-normal text-gray-400">({tabCounts[t]})</span>
              </button>
            ))}
          </div>

          <div className="space-y-3">
            {filteredContracts.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-4">No {adminTab === 'all' ? '' : adminTab + ' '}contracts</p>
            )}
            {filteredContracts.map(c => (
              <div key={c.id} className="border border-gray-100 dark:border-gray-700 rounded-xl p-3 dark:bg-gray-750">
                <div className="flex items-start justify-between mb-2">
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100 flex-1 pr-2">{c.title}</p>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${statusColor[c.status]}`}>
                    {c.status}{c.resolution ? ` · ${c.resolution}` : ''}
                  </span>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs text-gray-400 flex flex-wrap gap-x-2 gap-y-0.5">
                    <span>{c.type} · {c.resolve_mode} · {c.current_price}¢</span>
                    {(c.trader_count > 0 || c.volume > 0) && (
                      <span>
                        · 🪙 {c.volume?.toLocaleString() || 0} traded · {c.trader_count || 0} trader{c.trader_count === 1 ? '' : 's'}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {c.status === 'draft' && (
                      <>
                        <button onClick={() => editContract(c)} className="text-xs bg-navy-800 text-white px-3 py-1.5 rounded-lg hover:bg-navy-700 font-semibold">Edit</button>
                        <button onClick={() => setContractStatus(c.id, 'active')} className="text-xs bg-green-600 text-white px-3 py-1.5 rounded-lg hover:bg-green-700">Make Live</button>
                        <button onClick={() => setContractStatus(c.id, 'cancelled')} className="text-xs border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 px-3 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700">Cancel</button>
                      </>
                    )}
                    {c.status === 'active' && (
                      <button onClick={() => setContractStatus(c.id, 'draft')} className="text-xs bg-gray-200 text-gray-700 px-3 py-1.5 rounded-lg">Deactivate</button>
                    )}
                    {c.status === 'active' && (
                      <button
                        onClick={() => setResolvingContract(c)}
                        className="text-xs bg-navy-800 text-white px-3 py-1.5 rounded-lg hover:bg-navy-700 font-semibold"
                      >
                        {c.resolve_mode === 'auto' ? 'Force resolve' : 'Resolve'}
                      </button>
                    )}
                    {/* Duplicate — available for every contract */}
                    <button
                      onClick={() => duplicateContract(c)}
                      title="Duplicate as a new draft"
                      className="text-xs text-gray-500 hover:text-navy-800 border border-gray-200 dark:border-gray-600 px-2.5 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
                    >
                      ⎘ Duplicate
                    </button>
                    {c.status === 'active' && (
                      <button onClick={() => setContractStatus(c.id, 'cancelled')} className="text-xs text-gray-400 hover:text-red-600 px-2 py-1.5">✕</button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
