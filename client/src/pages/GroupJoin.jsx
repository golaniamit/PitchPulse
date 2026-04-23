import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { useGroup } from '../context/GroupContext';
import { groupColour, groupInitials } from '../components/GroupSwitcher';

// Landing page for invite links (/join/:code). Previews the group so the
// friend can see who invited them and what they're walking into before
// clicking Join.

export default function GroupJoin() {
  const { code } = useParams();
  const navigate = useNavigate();
  const { setCurrent, refreshGroups } = useGroup();
  const [group, setGroup]   = useState(null);
  const [err, setErr]       = useState('');
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/groups/peek/${code}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : r.json().then(e => Promise.reject(e.error || 'Not found')))
      .then(data => { if (!cancelled) setGroup(data.group); })
      .catch(e => { if (!cancelled) setErr(String(e)); });
    return () => { cancelled = true; };
  }, [code]);

  async function join() {
    setErr('');
    setJoining(true);
    try {
      const r = await fetch('/api/groups/join', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invite_code: code }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Failed to join');
      await refreshGroups();
      setCurrent(data.group.id);
      navigate('/');
    } catch (e) {
      setErr(e.message);
    } finally {
      setJoining(false);
    }
  }

  if (err) {
    return (
      <div className="max-w-md mx-auto mt-16 px-4 text-center">
        <p className="text-lg text-slate-700 dark:text-gray-300">Invite link not found</p>
        <p className="text-sm text-slate-400 mt-2">{err}</p>
        <Link to="/" className="inline-block mt-6 text-sm text-navy-800 dark:text-white underline">Back to markets</Link>
      </div>
    );
  }

  if (!group) {
    return <div className="text-center text-slate-400 text-sm mt-16">Loading…</div>;
  }

  const [bg, fg] = groupColour(group.name);
  const creator = group.creator_display_name || group.creator_username || 'Someone';

  return (
    <div className="max-w-md mx-auto mt-8 sm:mt-16 px-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6 sm:p-8 text-center">
        <div className={`w-14 h-14 rounded-xl ${bg} ${fg} text-lg font-bold flex items-center justify-center mx-auto mb-4`}>
          {groupInitials(group.name)}
        </div>
        <p className="text-sm text-slate-500 dark:text-gray-400">{creator} invited you to</p>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white mt-1">{group.name}</h1>

        {group.members_preview?.length > 0 && (
          <div className="flex justify-center gap-1.5 mt-4">
            {group.members_preview.map((m, i) => (
              <span key={i} className="w-7 h-7 rounded-full bg-slate-100 dark:bg-gray-700 flex items-center justify-center text-sm" title={m.display_name || m.username}>
                {m.avatar_emoji || (m.display_name || m.username || '?').slice(0,1).toUpperCase()}
              </span>
            ))}
          </div>
        )}

        <p className="text-xs text-slate-400 mt-3">
          {group.member_count} {group.member_count === 1 ? 'member' : 'members'} so far · {group.contract_count} contracts created
        </p>

        <div className="text-left rounded-xl bg-slate-50 dark:bg-gray-900/40 border border-slate-100 dark:border-gray-700 p-4 mt-6 text-xs text-slate-700 dark:text-gray-300 space-y-1.5">
          <p className="font-semibold text-slate-900 dark:text-white mb-1">What you'll get when you join:</p>
          <p>🪙 <b>{group.starting_coins?.toLocaleString()} starting coins</b> — just for this group</p>
          <p>🏏 Bet against your friends on contracts the admin creates</p>
          <p>🏆 Your own leaderboard to compete</p>
        </div>

        {group.already_member ? (
          <button
            onClick={() => { setCurrent(group.id); navigate('/'); }}
            className="w-full mt-6 py-3 rounded-xl bg-navy-800 text-white text-sm font-bold"
          >
            Open {group.name}
          </button>
        ) : (
          <button
            onClick={join} disabled={joining}
            className="w-full mt-6 py-3 rounded-xl bg-navy-800 text-white text-sm font-bold disabled:opacity-60"
          >
            {joining ? 'Joining…' : `Join group · Get 🪙 ${group.starting_coins?.toLocaleString()}`}
          </button>
        )}

        {err && <div className="text-xs text-red-600 dark:text-red-400 mt-3">{err}</div>}

        <p className="text-[11px] text-slate-400 mt-4">
          This balance is separate from your public wallet. Lose it in this group, your public coins are untouched.
        </p>
        <Link to="/" className="block text-[11px] text-slate-400 underline mt-3">
          Not interested, just take me to PitchPulse
        </Link>
      </div>
    </div>
  );
}
