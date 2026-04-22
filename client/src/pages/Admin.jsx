import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import ContractBuilder from '../components/ContractBuilder';


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


// Compact control for the Cricbuzz poll interval. Sits beside Bots/UserStats
// so the admin can widen the cadence pre-match (saves scraping bandwidth and
// keeps the ledger tidy) and tighten it live (catches resolutions within a
// minute of them happening on Cricbuzz). Pre-configured presets — one click,
// no typing.
function PollIntervalControl() {
  const [mins, setMins] = useState(null);   // current server value
  const [draft, setDraft] = useState('');   // input box value
  const [saving, setSaving] = useState(false);

  async function load() {
    try {
      const r = await fetch('/api/admin/active-match', { credentials: 'include' });
      if (!r.ok) return;
      const d = await r.json();
      setMins(d.pollMinutes ?? null);
      setDraft(String(d.pollMinutes ?? ''));
    } catch { /* ignore */ }
  }

  useEffect(() => { load(); }, []);

  async function apply() {
    const m = parseInt(draft, 10);
    if (!m || m < 1 || m === mins || saving) return;
    setSaving(true);
    try {
      const r = await fetch('/api/admin/set-poll-interval', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ minutes: m }),
      });
      if (r.ok) setMins(m);
    } catch { /* ignore */ } finally { setSaving(false); }
  }

  const draftNum = parseInt(draft, 10);
  const canApply = draftNum >= 1 && draftNum !== mins && !saving;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-gray-900 dark:text-gray-100">Resolver poll</h2>
        <span className="text-xs text-gray-500 dark:text-gray-400">every {mins ?? '…'} min</span>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="number" min="1" value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && canApply) apply(); }}
          className="w-20 text-sm border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-lg px-2 py-1.5 text-center focus:outline-none focus:ring-2 focus:ring-navy-800/30"
        />
        <span className="text-xs text-gray-500 dark:text-gray-400">min</span>
        <button
          onClick={apply}
          disabled={!canApply}
          className="ml-auto text-xs bg-navy-800 text-white px-3 py-1.5 rounded-lg hover:bg-navy-700 disabled:opacity-40 transition-colors"
        >
          {saving ? 'Saving…' : 'Apply'}
        </button>
      </div>
      <p className="text-[11px] text-gray-400 dark:text-gray-500 leading-snug">
        Widen pre-match; tighten once play starts. Takes effect immediately.
      </p>
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

// Cricbuzz's match status strings embed times in GMT (e.g. "Match starts at
// Apr 22, 14:00 GMT"). Users reading these assume the number is their local
// clock time, which is confusing for anyone not in the UK. Convert any
// "<Mon> <Day>, HH:MM GMT|UTC" fragment to IST with the timezone label
// explicit, since the app audience is in India. Format:
//   "14:00 GMT" → "22 Apr, 7:30 pm IST"
const MONTHS = { Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11 };
function localizeReason(str) {
  if (!str) return str;
  const re = /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2}),?\s+(\d{1,2}):(\d{2})\s+(GMT|UTC)/g;
  return str.replace(re, (_m, mon, day, hh, mm) => {
    const now = new Date();
    const d = new Date(Date.UTC(now.getUTCFullYear(), MONTHS[mon], +day, +hh, +mm));
    const ist = d.toLocaleString('en-IN', {
      month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
      timeZone: 'Asia/Kolkata',
    });
    return `${ist} IST`;
  });
}

// Undo settle — 60s countdown starting from resolved_at. Hides when expired,
// even if the page hasn't reloaded. Only visible to admins on freshly-resolved
// contracts.
function UndoButton({ ageMs: initialAgeMs, onClick }) {
  const [ageMs, setAgeMs] = useState(initialAgeMs);
  useEffect(() => {
    const startedAt = Date.now() - initialAgeMs;
    const id = setInterval(() => {
      const now = Date.now() - startedAt;
      if (now >= 60_000) { clearInterval(id); setAgeMs(60_000); }
      else setAgeMs(now);
    }, 1000);
    return () => clearInterval(id);
  }, [initialAgeMs]);
  const secondsLeft = Math.max(0, 60 - Math.floor(ageMs / 1000));
  if (secondsLeft === 0) return null;
  return (
    <button onClick={onClick}
            className="text-xs bg-amber-500 hover:bg-amber-600 text-white px-3 py-1.5 rounded-lg font-semibold"
            title="Reverses payouts and flips the contract back to active. Resolver will re-evaluate on next poll.">
      ↶ Undo ({secondsLeft}s)
    </button>
  );
}

// Small green/amber/red dot + tooltip showing resolver freshness. Thresholds
// are RELATIVE to the admin-configured poll interval so a 60-min cadence
// doesn't wrongly go red after 5 min. Rules:
//   Green  — last poll within (interval + 30s buffer), no errors
//   Amber  — within 2x interval, or fresh poll had an error
//   Red    — beyond 2x interval (missed a full cycle)
function ResolverHealthDot({ health }) {
  if (!health) return null;
  const intervalMs = (health.pollIntervalMinutes || 2) * 60_000;
  const ageMs = health.lastPollFinishedAt ? Date.now() - health.lastPollFinishedAt : null;
  const anyError = !!health.lastPollError || (health.matches || []).some(m => m.lastError);
  const greenCutoff  = intervalMs + 30_000;
  const amberCutoff  = 2 * intervalMs;

  const fmtAge = (ms) => ms < 60_000 ? `${Math.round(ms/1000)}s` : `${Math.round(ms/60000)}m`;
  const fmtInterval = health.pollIntervalMinutes ? `${health.pollIntervalMinutes} min` : '?';

  let color = 'bg-gray-300', label = 'Resolver status unknown';
  if (ageMs != null) {
    if (ageMs <= greenCutoff && !anyError) {
      color = 'bg-green-500';
      label = `Resolver healthy — last poll ${fmtAge(ageMs)} ago (interval: ${fmtInterval})`;
    } else if (ageMs <= amberCutoff) {
      color = 'bg-amber-400';
      label = anyError
        ? `Resolver ran but had errors — last poll ${fmtAge(ageMs)} ago`
        : `Resolver late — last poll ${fmtAge(ageMs)} ago (interval: ${fmtInterval})`;
    } else {
      color = 'bg-red-500';
      label = `Resolver stale — last poll ${fmtAge(ageMs)} ago (expected every ${fmtInterval})`;
    }
  }
  const perMatch = (health.matches || []).map(m => {
    const age = m.lastOkAt ? fmtAge(Date.now() - m.lastOkAt) + ' ago' : 'never';
    return `Match ${m.matchId}: ok ${age}${m.lastError ? ` (err: ${m.lastError})` : ''}`;
  }).join('\n');
  return (
    <div className="flex items-center gap-2" title={label + (perMatch ? '\n\n' + perMatch : '')}>
      <span className={`inline-block w-2 h-2 rounded-full ${color}`} />
      <span className="text-[11px] text-gray-500 dark:text-gray-400">Resolver</span>
    </div>
  );
}

export default function Admin() {
  const { user } = useAuth();
  const { on } = useSocket();
  const navigate = useNavigate();
  const [contracts, setContracts] = useState([]);
  const [editingContract, setEditingContract] = useState(null);   // contract object (or {...c, id: undefined} for duplicate)
  const [resolvingContract, setResolvingContract] = useState(null);
  const [adminTab, setAdminTab] = useState('active');    // filter for the "All contracts" list — default to active (most common view)
  const builderRef = useRef(null);                        // lets "Duplicate" scroll back to the builder

  // Map of matchId → "TEAM1 vs TEAM2". Filled once on mount so the contract list
  // can render a glanceable badge showing which Cricbuzz match a contract is tagged to.
  const [matchLookup, setMatchLookup] = useState({});
  const [resolverHealth, setResolverHealth] = useState(null);
  const [includeArchived, setIncludeArchived] = useState(false);

  useEffect(() => {
    if (!user?.is_admin) { navigate('/'); return; }
    loadContracts();
    loadMatchLookup();
    const pollHealth = () => fetch('/api/admin/resolver-health', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null).then(setResolverHealth).catch(() => {});
    pollHealth();
    const id = setInterval(pollHealth, 15000);
    return () => clearInterval(id);
  }, [user]);

  useEffect(() => { if (user?.is_admin) loadContracts(); }, [includeArchived]);

  // Live updates — same wiring Home.jsx uses so the admin list reflects
  // status/price/resolution changes without the admin having to refresh.
  // Admins see ALL statuses (draft + cancelled included), so no status
  // filtering here — unlike Home's logic for non-admins.
  useEffect(() => {
    if (!user?.is_admin) return;
    const upsert = (cs, contract) => [contract, ...cs.filter(c => c.id !== contract.id)];
    const unsubs = [
      on('contract_created', (msg) =>
        setContracts(cs => upsert(cs, msg.contract))),
      on('contract_resolved', (msg) =>
        setContracts(cs => cs.map(c =>
          c.id === msg.contractId
            ? { ...c, status: 'resolved', resolution: msg.resolution, resolved_at: new Date().toISOString().slice(0,19).replace('T',' ') }
            : c
        ))),
      on('contract_updated', (msg) =>
        setContracts(cs => upsert(cs, msg.contract))),
      on('price_update', (msg) =>
        setContracts(cs => cs.map(c =>
          c.id === msg.contractId ? { ...c, current_price: msg.price } : c
        ))),
    ];
    return () => unsubs.forEach(fn => fn?.());
  }, [on, user]);

  async function loadContracts() {
    const qs = includeArchived ? '?includeArchived=1' : '';
    const r = await fetch(`/api/contracts${qs}`, { credentials: 'include' });
    const d = await r.json();
    setContracts(d.contracts || []);
  }

  // Build matchId → "TEAM1 vs TEAM2" map from Cricbuzz's live-scores index so we
  // can label tagged contracts on the admin list. Fails silently — a missing map
  // just means we fall back to showing the raw match ID.
  async function loadMatchLookup() {
    try {
      const r = await fetch('/api/admin/cricbuzz-matches', { credentials: 'include' });
      if (!r.ok) return;
      const d = await r.json();
      const map = {};
      for (const m of d.matches || []) {
        const teams = (m.teams || []).map(t => t.shortName).filter(Boolean).join(' vs ');
        if (m.matchId) map[String(m.matchId)] = teams || `Match #${m.matchId}`;
      }
      setMatchLookup(map);
    } catch { /* ignore */ }
  }

  function resetBuilder() {
    setEditingContract(null);
  }

  function editContract(c) {
    setEditingContract(c);
    builderRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function undoSettle(contractId) {
    const r = await fetch(`/api/contracts/${contractId}/undo-settle`, {
      method: 'POST', credentials: 'include',
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      alert(d.error || 'Undo failed');
      return;
    }
    loadContracts();
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
    // Strip the id so the builder POSTs a new contract on save.
    const { id, ...rest } = c;
    setEditingContract({ ...rest, id: undefined });
    builderRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // 5.2 — filter the admin's "All Contracts" list by status
  // Order reflects workflow priority: Active is the default daily view, with
  // Draft / Resolved / Cancelled next, and All as an escape hatch at the end.
  const ADMIN_TABS = ['active', 'draft', 'resolved', 'cancelled', 'all'];
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
        {/* Bots + resolver poll + live player count — three cards side by side on desktop */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <BotsControl />
          <PollIntervalControl />
          <UserStats />
        </div>

        {/* Contract builder — 3-slot tile-based form */}
        <div ref={builderRef}>
          <ContractBuilder
            editing={editingContract}
            onSaved={() => { resetBuilder(); loadContracts(); }}
            onCancelEdit={resetBuilder}
          />
        </div>

        {/* All contracts dashboard */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5">
          <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
            <h2 className="font-bold text-gray-900 dark:text-gray-100">All Contracts</h2>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400 cursor-pointer select-none">
                <input type="checkbox" checked={includeArchived} onChange={e => setIncludeArchived(e.target.checked)}
                       className="accent-navy-800 w-3.5 h-3.5" />
                Include archived
              </label>
              <ResolverHealthDot health={resolverHealth} />
            </div>
          </div>

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
            {filteredContracts.map(c => {
              const isAuto = c.resolve_mode === 'auto';
              const matchLabel = c.match_id ? (matchLookup[String(c.match_id)] || `Match #${c.match_id}`) : null;
              const autoMissingMatch = isAuto && !c.match_id && c.type !== 'manual' && c.phase !== 'season';
              return (
              <div key={c.id} className="border border-gray-100 dark:border-gray-700 rounded-xl p-3 dark:bg-gray-750">
                <div className="flex items-start justify-between mb-2">
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100 flex-1 pr-2">{c.title}</p>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${statusColor[c.status]}`}>
                    {c.status}{c.resolution ? ` · ${c.resolution}` : ''}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 mb-2">
                  <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${
                    isAuto
                      ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300'
                      : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
                  }`}>
                    {isAuto ? 'Auto' : 'Manual'}
                  </span>
                  {matchLabel && (
                    <span className="text-[11px] px-2 py-0.5 rounded-full font-medium bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                      {matchLabel}
                    </span>
                  )}
                  {autoMissingMatch && (
                    <span className="text-[11px] px-2 py-0.5 rounded-full font-semibold bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                          title="Auto-resolve needs a Cricbuzz match — this contract won't resolve until one is tagged.">
                      ⚠ no match tagged
                    </span>
                  )}
                </div>
                {isAuto && c.status === 'active' && c.last_eval_reason && (
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 italic -mt-1 mb-2"
                     title={c.last_eval_at ? `Last evaluated: ${new Date(c.last_eval_at + 'Z').toLocaleTimeString()}` : ''}>
                    ⋯ {localizeReason(c.last_eval_reason)}
                  </p>
                )}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs text-gray-400 flex flex-wrap gap-x-2 gap-y-0.5">
                    <span>{c.type} · {c.current_price}¢</span>
                    {(c.trader_count > 0 || c.volume > 0) && (
                      <span>
                        · 🪙 {c.volume?.toLocaleString() || 0} traded · {c.trader_count || 0} trader{c.trader_count === 1 ? '' : 's'}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {c.status === 'resolved' && c.resolved_at && (() => {
                      const ageMs = Date.now() - new Date(c.resolved_at + 'Z').getTime();
                      return ageMs < 60_000
                        ? <UndoButton ageMs={ageMs} onClick={() => undoSettle(c.id)} />
                        : null;
                    })()}
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
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}
