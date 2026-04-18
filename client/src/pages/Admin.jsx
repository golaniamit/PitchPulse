import { useState, useEffect } from 'react';
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
      <option value="">Select...</option>
      {opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
  // Team picker — dropdown if match teams are known, text input fallback
  const teamPicker = (name, placeholder) => teams?.length >= 2
    ? sel(name, teams.map(t => ({ value: t, label: t })))
    : inp(name, placeholder);

  if (type === 'runs_over') return (
    <div className="grid grid-cols-2 gap-2">
      {teamPicker('team', 'Team (e.g. CSK)')}
      {inp('over', 'Over number', 'number')}
      {sel('operator', [{value:'>=',label:'≥ (at least)'},{value:'>',label:'> (more than)'},{value:'<=',label:'≤ (at most)'}])}
      {inp('threshold', 'Runs threshold', 'number')}
    </div>
  );
  if (type === 'wicket_over') return (
    <div className="grid grid-cols-2 gap-2">
      {teamPicker('team', 'Batting team')}
      {inp('over', 'Over number', 'number')}
      {inp('min_wickets', 'Min wickets', 'number')}
    </div>
  );
  if (type === 'team_total') return (
    <div className="grid grid-cols-2 gap-2">
      {teamPicker('team', 'Team')}
      {inp('over', 'By over', 'number')}
      {sel('operator', [{value:'>=',label:'≥ (at least)'},{value:'>',label:'> (more than)'},{value:'<=',label:'≤ (at most)'}])}
      {inp('threshold', 'Run target', 'number')}
    </div>
  );
  if (type === 'batsman_milestone') return (
    <div className="grid grid-cols-2 gap-2">
      {inp('batsman', 'Batsman name')}
      {inp('milestone', 'Milestone runs', 'number')}
      {inp('over', 'By over', 'number')}
    </div>
  );
  if (type === 'boundary_over') return (
    <div className="grid grid-cols-2 gap-2">
      {teamPicker('team', 'Team')}
      {inp('over', 'Over number', 'number')}
      {sel('boundary_type', [{value:'six',label:'Six'},{value:'four',label:'Four'}])}
    </div>
  );
  if (type === 'manual') return (
    <input
      placeholder="Custom contract question..."
      value={fields.custom_title || ''}
      onChange={e => onChange('custom_title', e.target.value)}
      className="border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-navy-800"
    />
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
                Yes, resolve it
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
          <p className="text-xs text-gray-400">Tap a match to set it as active:</p>
          {matches.map(m => (
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

export default function Admin() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [contracts, setContracts] = useState([]);
  const [matchTeams, setMatchTeams] = useState([]);
  const [selectedType, setSelectedType] = useState(null);
  const [fields, setFields] = useState({});
  const [resolveMode, setResolveMode] = useState('manual');
  const [status, setStatus] = useState('active');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [resolvingContract, setResolvingContract] = useState(null);

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

  async function createContract() {
    if (!selectedType) return;
    setError(''); setCreating(true);
    const condition = selectedType !== 'manual' ? buildConditionJson(selectedType, fields) : null;
    const contractTitle = selectedType === 'manual' ? (fields.custom_title || 'Manual contract') : title;
    try {
      const r = await fetch('/api/contracts', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: contractTitle, type: selectedType, condition_json: condition, resolve_mode: resolveMode, status }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setSelectedType(null);
      setFields({});
      loadContracts();
    } catch (e) {
      setError(e.message);
    } finally {
      setCreating(false);
    }
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

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        {/* Match selector */}
        <MatchSelector onTeamsChange={setMatchTeams} />

        {/* Contract builder */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5">
          <h2 className="font-bold text-gray-900 dark:text-gray-100 mb-4">Create Contract</h2>

          <div className="grid grid-cols-3 gap-2 mb-4">
            {CONTRACT_TYPES.map(ct => (
              <button
                key={ct.id}
                onClick={() => { setSelectedType(ct.id); setFields({}); }}
                className={`rounded-xl border p-2.5 text-center transition-colors ${
                  selectedType === ct.id
                    ? 'border-navy-800 bg-navy-800 text-white'
                    : 'border-gray-200 hover:border-gray-300 text-gray-700'
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
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="text-xs text-gray-500 mb-1 block">Resolve mode</label>
                  <select value={resolveMode} onChange={e => setResolveMode(e.target.value)} className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-gray-100">
                    <option value="manual">Manual</option>
                    <option value="auto">Auto (CricAPI)</option>
                  </select>
                </div>
                <div className="flex-1">
                  <label className="text-xs text-gray-500 mb-1 block">Publish as</label>
                  <select value={status} onChange={e => setStatus(e.target.value)} className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-gray-100">
                    <option value="active">Active now</option>
                    <option value="draft">Draft</option>
                  </select>
                </div>
              </div>
              {title && (
                <div className="bg-gray-50 dark:bg-gray-700 rounded-xl p-3 border border-dashed border-gray-200 dark:border-gray-600">
                  <p className="text-xs text-gray-400 dark:text-gray-500 mb-1 uppercase tracking-wide">Preview</p>
                  <p className="text-sm font-medium text-gray-800 dark:text-gray-100">{title}</p>
                </div>
              )}
              {error && <p className="text-red-600 text-sm">{error}</p>}
              <button
                onClick={createContract}
                disabled={creating}
                className="w-full bg-navy-800 text-white py-3 rounded-xl font-bold text-sm hover:bg-navy-700 transition-colors disabled:opacity-50"
              >
                {creating ? 'Creating...' : 'Create Contract'}
              </button>
            </div>
          )}
        </div>

        {/* All contracts dashboard */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5">
          <h2 className="font-bold text-gray-900 dark:text-gray-100 mb-4">All Contracts</h2>
          <div className="space-y-3">
            {contracts.length === 0 && <p className="text-sm text-gray-400 text-center py-4">No contracts yet</p>}
            {contracts.map(c => (
              <div key={c.id} className="border border-gray-100 dark:border-gray-700 rounded-xl p-3 dark:bg-gray-750">
                <div className="flex items-start justify-between mb-2">
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100 flex-1 pr-2">{c.title}</p>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${statusColor[c.status]}`}>
                    {c.status}{c.resolution ? ` · ${c.resolution}` : ''}
                  </span>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-gray-400">{c.type} · {c.resolve_mode} · {c.current_price}¢</span>
                  <div className="flex flex-wrap gap-1.5">
                    {c.status === 'draft' && (
                      <button onClick={() => setContractStatus(c.id, 'active')} className="text-xs bg-green-600 text-white px-3 py-1.5 rounded-lg hover:bg-green-700">Activate</button>
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
