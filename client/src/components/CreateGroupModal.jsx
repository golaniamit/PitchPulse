import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGroup } from '../context/GroupContext';

// Modal fired from the group-switcher's "+ Create group" button. Captures the
// two inputs the admin controls: group name + starting coins per member.
// On success, switches the current context to the new group and redirects to
// Group Settings so the admin can grab the invite link.

export default function CreateGroupModal({ open, onClose }) {
  const { refreshGroups, setCurrent } = useGroup();
  const [name, setName] = useState('');
  const [coins, setCoins] = useState(10000);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const navigate = useNavigate();

  if (!open) return null;

  async function submit(e) {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      const r = await fetch('/api/groups', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, starting_coins: parseInt(coins, 10) }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Failed to create group');
      await refreshGroups();
      setCurrent(data.group.id);
      onClose();
      navigate('/group/settings');
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" onClick={onClose}>
      <form
        onSubmit={submit}
        onClick={e => e.stopPropagation()}
        className="w-full sm:max-w-md bg-white dark:bg-gray-800 rounded-t-2xl sm:rounded-2xl shadow-2xl p-5 space-y-4"
      >
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-white">Create a friends group</h3>
            <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5">Private markets just for the people you invite.</p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700 dark:hover:text-gray-200 text-lg leading-none">✕</button>
        </div>

        <div>
          <label className="text-[11px] font-bold text-slate-500 dark:text-gray-400 uppercase tracking-wide">Group name</label>
          <input
            type="text" value={name} onChange={e => setName(e.target.value)}
            placeholder="e.g. Aryan's Bro Circle"
            maxLength={60}
            required autoFocus
            className="w-full mt-1 border border-slate-300 dark:border-gray-600 dark:bg-gray-900 dark:text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-navy-800"
          />
        </div>

        <div>
          <label className="text-[11px] font-bold text-slate-500 dark:text-gray-400 uppercase tracking-wide">Starting coins per member</label>
          <div className="mt-1 flex items-center gap-2">
            <span className="text-sm text-slate-400">🪙</span>
            <input
              type="number" value={coins} onChange={e => setCoins(e.target.value)}
              min={100} max={10000000} step={100} required
              className="flex-1 border border-slate-300 dark:border-gray-600 dark:bg-gray-900 dark:text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-navy-800"
            />
          </div>
          <p className="text-[10px] text-slate-400 dark:text-gray-500 mt-1">Each person gets this fresh balance when they join. Separate from your public wallet.</p>
        </div>

        <div className="rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 p-2.5">
          <p className="text-[11px] text-blue-900 dark:text-blue-200 leading-snug">
            <span className="font-semibold">💡 You'll be the group's admin.</span> You can create contracts and resolve them. Friends bet against each other.
          </p>
        </div>

        {err && <div className="text-xs text-red-600 dark:text-red-400">{err}</div>}

        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-gray-700 text-sm font-semibold text-slate-600 dark:text-gray-300">
            Cancel
          </button>
          <button type="submit" disabled={busy} className="flex-1 py-2.5 rounded-xl bg-navy-800 text-white text-sm font-bold disabled:opacity-60">
            {busy ? 'Creating…' : 'Create group'}
          </button>
        </div>
      </form>
    </div>
  );
}
