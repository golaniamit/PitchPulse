import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useGroup } from '../context/GroupContext';
import { groupColour, groupInitials } from '../components/GroupSwitcher';

// Inside-a-group settings page. Admin sees everything (members + rename +
// kick/transfer + reset-season + delete + invite/share). Members see a
// read-only member list + invite-share + notification toggle + leave.

export default function GroupSettings() {
  const { currentGroupId, currentGroup, refreshGroups, setCurrent } = useGroup();
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState('');
  const navigate = useNavigate();

  // Editable state — rename input + notify toggle. Kept separate from `detail`
  // so the page doesn't re-render mid-typing.
  const [nameDraft, setNameDraft] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [notifyPending, setNotifyPending] = useState(false);

  async function reload() {
    const r = await fetch(`/api/groups/${currentGroupId}?group=${currentGroupId}`, { credentials: 'include' });
    if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || 'Failed to load');
    const data = await r.json();
    setDetail(data.group);
    setNameDraft(data.group.name);
  }

  useEffect(() => {
    if (!currentGroupId) { navigate('/'); return; }
    let cancelled = false;
    reload()
      .catch(e => { if (!cancelled) setErr(String(e.message || e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentGroupId]);

  if (loading) return <div className="text-center text-slate-400 text-sm mt-16">Loading…</div>;
  if (!detail) return <div className="text-center text-red-500 text-sm mt-16">{err || 'Group not found'}</div>;

  const isAdmin = detail.me?.role === 'admin';
  const myBalance = detail.me?.balance ?? 0;
  const [bg, fg] = groupColour(detail.name);
  const inviteUrl = `${window.location.origin}/join/${detail.invite_code}`;

  // ─── Invite / share helpers ────────────────────────────────────────────
  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  }
  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(
    `Join me on PitchPulse · ${detail.name}\n${inviteUrl}`
  )}`;
  const mailtoUrl = `mailto:?subject=${encodeURIComponent(`Join my PitchPulse group: ${detail.name}`)}&body=${encodeURIComponent(
    `Hey,\n\nI'm running a private prediction market for IPL matches on PitchPulse. Click to join:\n\n${inviteUrl}\n\nYou'll start with ${detail.starting_coins.toLocaleString()} group coins — separate from your public balance.\n\n`
  )}`;

  async function regenerate() {
    if (!confirm('Rotate invite link? The old one will stop working.')) return;
    const r = await fetch(`/api/groups/${currentGroupId}/regenerate-code?group=${currentGroupId}`, {
      method: 'POST', credentials: 'include',
    });
    if (r.ok) {
      const d = await r.json();
      setDetail(x => x ? { ...x, invite_code: d.invite_code } : x);
    }
  }

  // ─── Rename ────────────────────────────────────────────────────────────
  async function saveName() {
    const trimmed = nameDraft.trim();
    if (!trimmed || trimmed === detail.name) return;
    setSavingName(true); setErr('');
    try {
      const r = await fetch(`/api/groups/${currentGroupId}?group=${currentGroupId}`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Rename failed');
      setDetail(d.group);
      await refreshGroups();
    } catch (e) { setErr(e.message); }
    finally { setSavingName(false); }
  }

  // ─── Kick / transfer admin ─────────────────────────────────────────────
  async function kickMember(target) {
    if (!confirm(`Remove ${target.display_name || target.username} from the group? They'll forfeit 🪙 ${target.balance.toLocaleString()}.`)) return;
    setBusy(true); setErr('');
    try {
      const r = await fetch(`/api/groups/${currentGroupId}/members/${target.id}?group=${currentGroupId}`, {
        method: 'DELETE', credentials: 'include',
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Kick failed');
      await reload();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  async function transferAdmin(target) {
    if (!confirm(
      `Transfer admin to ${target.display_name || target.username}?\n\n` +
      `You'll become a regular member — you'll lose the ability to create contracts, resolve them, kick members, or reset the season. This can only be reversed if the new admin transfers it back to you.`
    )) return;
    setBusy(true); setErr('');
    try {
      const r = await fetch(`/api/groups/${currentGroupId}/members/${target.id}/transfer-admin?group=${currentGroupId}`, {
        method: 'POST', credentials: 'include',
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Transfer failed');
      await reload();
      await refreshGroups();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  // ─── Notifications ─────────────────────────────────────────────────────
  async function toggleNotify(enabled) {
    setNotifyPending(true); setErr('');
    try {
      const r = await fetch(`/api/groups/${currentGroupId}/notify?group=${currentGroupId}`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Failed');
      // Detail.me carries the toggle state — patch it locally.
      setDetail(x => x ? { ...x, me: { ...x.me, notify_enabled: enabled ? 1 : 0 } } : x);
    } catch (e) { setErr(e.message); }
    finally { setNotifyPending(false); }
  }

  // ─── Danger actions ────────────────────────────────────────────────────
  async function resetSeason() {
    if (!confirm(`Close this season and start a fresh round for "${detail.name}"?\n\nEvery active contract will be cancelled.\nEvery member's balance will reset to 🪙 ${detail.starting_coins.toLocaleString()}.\nResolved contract history stays for the record.`)) return;
    if (!confirm('Really? This can\'t be undone.')) return;
    setBusy(true); setErr('');
    try {
      const r = await fetch(`/api/groups/${currentGroupId}/reset-season?group=${currentGroupId}`, {
        method: 'POST', credentials: 'include',
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Reset failed');
      await refreshGroups();
      await reload();
      alert(`Season closed. Now on round #${d.round}. Everyone is back to 🪙 ${detail.starting_coins.toLocaleString()}.`);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  async function deleteGroup() {
    if (!confirm(`Delete "${detail.name}"? This wipes every contract, trade, and balance in the group. Not reversible.`)) return;
    if (!confirm('Really? One more confirmation — all member balances and group contracts will be destroyed.')) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/groups/${currentGroupId}?group=${currentGroupId}`, {
        method: 'DELETE', credentials: 'include',
      });
      if (!r.ok) {
        const d = await r.json();
        throw new Error(d.error || 'Failed to delete');
      }
      await refreshGroups();
      setCurrent(null);
      navigate('/');
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  async function leaveGroup() {
    // #14: Show exact forfeit amount so the user isn't surprised.
    if (!confirm(`Leave "${detail.name}"?\n\nYou'll forfeit 🪙 ${myBalance.toLocaleString()}. Your public wallet is untouched.`)) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/groups/${currentGroupId}/leave?group=${currentGroupId}`, {
        method: 'POST', credentials: 'include',
      });
      if (!r.ok) {
        const d = await r.json();
        throw new Error(d.error || 'Failed to leave');
      }
      await refreshGroups();
      setCurrent(null);
      navigate('/');
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <Link to="/" className="text-xs text-slate-500 dark:text-gray-400 hover:text-slate-700 dark:hover:text-white">← Back to markets</Link>

      <div className="flex items-center gap-3 mt-3">
        <div className={`w-10 h-10 rounded-xl ${bg} ${fg} font-bold flex items-center justify-center`}>
          {groupInitials(detail.name)}
        </div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{detail.name}</h1>
      </div>

      {/* Overview cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-5">
        <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-slate-100 dark:border-gray-700">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Members</p>
          <p className="text-2xl font-bold text-slate-900 dark:text-white mt-1">{detail.member_count}<span className="text-sm text-slate-400 font-normal">/50</span></p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-slate-100 dark:border-gray-700">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Starting coins</p>
          <p className="text-xl font-bold text-slate-900 dark:text-white mt-1">🪙 {detail.starting_coins?.toLocaleString()}</p>
          <p className="text-[10px] text-slate-400 mt-0.5">Given to new members</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-slate-100 dark:border-gray-700">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Total contracts</p>
          <p className="text-2xl font-bold text-slate-900 dark:text-white mt-1">
            {detail.contract_count}
            <span className="text-sm text-slate-400 font-normal ml-2">({detail.resolved_count} resolved)</span>
          </p>
        </div>
      </div>

      {/* Admin-only: rename */}
      {isAdmin && (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-slate-100 dark:border-gray-700 mt-5">
          <p className="text-sm font-bold text-slate-900 dark:text-white">Group name</p>
          <div className="mt-2 flex gap-2">
            <input
              type="text"
              value={nameDraft}
              onChange={e => setNameDraft(e.target.value)}
              maxLength={60}
              className="flex-1 border border-slate-300 dark:border-gray-600 dark:bg-gray-900 dark:text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-navy-800"
            />
            <button
              onClick={saveName}
              disabled={savingName || !nameDraft.trim() || nameDraft === detail.name}
              className="text-xs font-semibold bg-navy-800 text-white px-3 py-2 rounded-lg disabled:opacity-60"
            >
              {savingName ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}

      {/* Member list */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-slate-100 dark:border-gray-700 mt-5 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 dark:border-gray-700 flex items-center justify-between">
          <p className="text-sm font-bold text-slate-900 dark:text-white">Members · {detail.member_count}</p>
        </div>
        <div className="divide-y divide-slate-100 dark:divide-gray-700">
          {detail.members.map(m => {
            const isMe = m.id === detail.me?.id;
            const isAdm = m.role === 'admin';
            const pnl = m.pnl;
            return (
              <div key={m.id} className="px-4 py-3 flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-slate-100 dark:bg-gray-700 flex items-center justify-center text-base flex-shrink-0">
                  {m.avatar_emoji || (m.display_name || m.username || '?').slice(0,1).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-900 dark:text-white truncate flex items-center gap-1.5 flex-wrap">
                    {m.display_name || m.username}
                    {isAdm && <span className="text-[9px] uppercase tracking-wide bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded">admin</span>}
                    {isMe && <span className="text-[9px] uppercase tracking-wide bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">you</span>}
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-gray-400">
                    🪙 {m.balance?.toLocaleString()} ·
                    <span className={pnl >= 0 ? 'text-green-600 dark:text-green-400 ml-1' : 'text-red-600 dark:text-red-400 ml-1'}>
                      P&L {pnl >= 0 ? '+' : ''}{pnl?.toLocaleString()}
                    </span>
                  </p>
                </div>
                {/* Admin controls per non-admin member */}
                {isAdmin && !isAdm && !isMe && (
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => transferAdmin(m)}
                      disabled={busy}
                      className="text-[11px] font-semibold text-slate-600 dark:text-gray-300 hover:text-navy-800 dark:hover:text-white border border-slate-200 dark:border-gray-600 rounded px-2 py-1 disabled:opacity-60"
                      title={`Make ${m.display_name || m.username} the group admin (you become a member)`}
                    >
                      Make admin
                    </button>
                    <button
                      onClick={() => kickMember(m)}
                      disabled={busy}
                      className="text-[11px] font-semibold text-red-600 dark:text-red-400 hover:text-red-800 border border-red-200 dark:border-red-800 rounded px-2 py-1 disabled:opacity-60"
                    >
                      Remove
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Bottom row — invite (widest), notifications, danger zone. On lg+ they
          sit in a 12-col grid with invite taking 7/12, notifications 2/12 and
          danger 3/12. Collapses to a vertical stack on mobile. */}
      <div className="mt-5 grid grid-cols-1 lg:grid-cols-12 gap-3 items-stretch">

        {/* Invite — biggest tile */}
        <div className="lg:col-span-7 bg-white dark:bg-gray-800 rounded-xl p-4 border border-slate-100 dark:border-gray-700 flex flex-col">
          <p className="text-sm font-bold text-slate-900 dark:text-white">Invite friends</p>
          <p className="text-[11px] text-slate-500 dark:text-gray-400 mt-0.5">Share the link. Anyone with it can join (up to 50).</p>
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            <code className="flex-1 min-w-0 truncate text-[11px] sm:text-xs bg-slate-100 dark:bg-gray-900 text-slate-700 dark:text-gray-300 px-3 py-2 rounded-lg border border-slate-200 dark:border-gray-700">
              {inviteUrl}
            </code>
            <button onClick={copyInvite} className="text-xs font-semibold bg-navy-800 text-white px-3 py-2 rounded-lg">
              {copied ? '✓ Copied' : 'Copy'}
            </button>
          </div>
          <div className="mt-2 flex flex-wrap gap-2 items-center">
            <a
              href={whatsappUrl} target="_blank" rel="noreferrer"
              className="flex items-center gap-1.5 text-xs font-semibold bg-[#25D366] text-white px-3 py-2 rounded-lg hover:opacity-90"
            >
              <span>💬</span> WhatsApp
            </a>
            <a
              href={mailtoUrl}
              className="flex items-center gap-1.5 text-xs font-semibold bg-slate-600 text-white px-3 py-2 rounded-lg hover:bg-slate-700"
            >
              <span>✉️</span> Email
            </a>
            {isAdmin && (
              <button onClick={regenerate} className="ml-auto text-[11px] text-slate-500 underline hover:text-slate-800 dark:hover:text-white">
                Rotate link
              </button>
            )}
          </div>
        </div>

        {/* Notifications — compact tile with title stacked above the toggle */}
        <div className="lg:col-span-2 bg-white dark:bg-gray-800 rounded-xl p-4 border border-slate-100 dark:border-gray-700 flex flex-col justify-between">
          <div>
            <p className="text-sm font-bold text-slate-900 dark:text-white">🔔 Notifications</p>
            <p className="text-[11px] text-slate-500 dark:text-gray-400 mt-0.5 leading-snug">
              Ping me on new contracts &amp; resolutions.
            </p>
          </div>
          <div className="flex items-center justify-between mt-3">
            <span className="text-[11px] text-slate-600 dark:text-gray-300 font-medium">
              {detail.me?.notify_enabled ? 'On' : 'Off'}
            </span>
            <label className="inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                className="sr-only peer"
                checked={!!detail.me?.notify_enabled}
                disabled={notifyPending}
                onChange={e => toggleNotify(e.target.checked)}
              />
              <div className="w-11 h-6 bg-slate-200 dark:bg-gray-700 peer-focus:outline-none rounded-full peer
                              peer-checked:after:translate-x-full peer-checked:after:border-white
                              after:content-[''] after:absolute after:top-[2px] after:left-[2px]
                              after:bg-white after:border-slate-300 after:border after:rounded-full
                              after:h-5 after:w-5 after:transition-all peer-checked:bg-navy-800 relative"></div>
            </label>
          </div>
        </div>

        {/* Danger zone — admin: reset + delete stacked; member: leave */}
        <div className="lg:col-span-3 bg-white dark:bg-gray-800 rounded-xl p-4 border border-red-100 dark:border-red-900 flex flex-col">
          <p className="text-sm font-bold text-red-600 dark:text-red-400">Danger zone</p>
          {isAdmin ? (
            <>
              <div className="mt-3 flex flex-col gap-2">
                <button onClick={resetSeason} disabled={busy}
                  className="w-full text-xs font-semibold border border-amber-300 text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 hover:bg-amber-100 px-3 py-2 rounded-lg disabled:opacity-60">
                  🔄 Close season &amp; reset
                </button>
                <button onClick={deleteGroup} disabled={busy}
                  className="w-full text-xs font-semibold bg-red-600 text-white px-3 py-2 rounded-lg hover:bg-red-700 disabled:opacity-60">
                  Delete group
                </button>
              </div>
              <p className="text-[10px] text-slate-400 mt-auto pt-2">
                Reset keeps history. Delete wipes everything.
              </p>
            </>
          ) : (
            <div className="mt-3">
              <button onClick={leaveGroup} disabled={busy}
                className="w-full text-xs font-semibold border border-red-300 text-red-600 dark:text-red-400 px-3 py-2 rounded-lg disabled:opacity-60">
                Leave group<br/>
                <span className="text-[10px] opacity-80">forfeit 🪙 {myBalance.toLocaleString()}</span>
              </button>
            </div>
          )}
        </div>

        {/* Error band — spans the full row if anything fails */}
        {err && <p className="lg:col-span-12 text-xs text-red-600 dark:text-red-400">{err}</p>}
      </div>
    </div>
  );
}
