import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGroup } from '../context/GroupContext';

// Tiny modal for joining via a typed invite code. The link flow lands users
// directly on /join/:code which is a proper page; this is the fallback when
// someone has a code but not a link.

export default function JoinGroupModal({ open, onClose }) {
  const { refreshGroups, setCurrent } = useGroup();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const navigate = useNavigate();

  if (!open) return null;

  async function submit(e) {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      const r = await fetch('/api/groups/join', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invite_code: code.trim().toLowerCase() }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Failed to join');
      await refreshGroups();
      setCurrent(data.group.id);
      onClose();
      navigate('/');
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
        className="w-full sm:max-w-sm bg-white dark:bg-gray-800 rounded-t-2xl sm:rounded-2xl shadow-2xl p-5 space-y-4"
      >
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-white">Join a group</h3>
            <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5">Paste the invite code your friend shared.</p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700 dark:hover:text-gray-200 text-lg leading-none">✕</button>
        </div>

        <div>
          <input
            type="text" value={code} onChange={e => setCode(e.target.value)}
            placeholder="e.g. happy-tiger-4821"
            required autoFocus
            className="w-full border border-slate-300 dark:border-gray-600 dark:bg-gray-900 dark:text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-navy-800 font-mono"
          />
        </div>

        {err && <div className="text-xs text-red-600 dark:text-red-400">{err}</div>}

        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-gray-700 text-sm font-semibold text-slate-600 dark:text-gray-300">
            Cancel
          </button>
          <button type="submit" disabled={busy} className="flex-1 py-2.5 rounded-xl bg-navy-800 text-white text-sm font-bold disabled:opacity-60">
            {busy ? 'Joining…' : 'Join group'}
          </button>
        </div>
      </form>
    </div>
  );
}
