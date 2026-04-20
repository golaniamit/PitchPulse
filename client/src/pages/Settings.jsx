import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Settings() {
  const { user, refresh, logout } = useAuth();
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState(user?.display_name || '');
  const [avatar, setAvatar] = useState(user?.avatar_emoji || '');
  const [pool, setPool] = useState([]);
  const [profileMsg, setProfileMsg] = useState('');
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [pwMsg, setPwMsg] = useState('');
  const [confirmDel, setConfirmDel] = useState('');
  const [delMsg, setDelMsg] = useState('');

  useEffect(() => {
    fetch('/api/auth/avatar-pool', { credentials: 'include' })
      .then(r => r.json()).then(d => setPool(d.pool || [])).catch(() => {});
  }, []);

  async function saveProfile() {
    setProfileMsg('');
    try {
      const r = await fetch('/api/auth/me', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ display_name: displayName, avatar_emoji: avatar }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setProfileMsg('Saved ✓');
      refresh?.();
    } catch (e) {
      setProfileMsg(e.message);
    }
  }

  async function changePassword() {
    setPwMsg('');
    try {
      const r = await fetch('/api/auth/change-password', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current: currentPw, next: newPw }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setPwMsg('Password updated ✓');
      setCurrentPw(''); setNewPw('');
    } catch (e) {
      setPwMsg(e.message);
    }
  }

  async function deleteAccount() {
    setDelMsg('');
    if (!window.confirm('Delete your account permanently? This cannot be undone.')) return;
    try {
      const r = await fetch('/api/auth/me', {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm_username: confirmDel }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      await logout();
      navigate('/login');
    } catch (e) {
      setDelMsg(e.message);
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-5">
      <h1 className="font-bold text-gray-900 dark:text-gray-100 text-xl">Account settings</h1>

      {/* --- Profile --- */}
      <section className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5 space-y-3">
        <h2 className="font-semibold text-gray-800 dark:text-gray-100">Profile</h2>

        <div>
          <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1 block">
            Display name
          </label>
          <input
            type="text"
            value={displayName}
            onChange={e => setDisplayName(e.target.value)}
            placeholder="e.g. Rahul"
            maxLength={40}
            className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-navy-800"
          />
          <p className="text-[11px] text-gray-400 mt-1">Shown on the leaderboard. Username (<code>@{user?.username}</code>) can't be changed.</p>
        </div>

        <div>
          <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1 block">
            Avatar
          </label>
          <div className="flex flex-wrap gap-2">
            {pool.map(e => (
              <button
                key={e}
                onClick={() => setAvatar(e)}
                className={`w-10 h-10 rounded-xl text-xl flex items-center justify-center border transition-colors ${
                  avatar === e
                    ? 'border-navy-800 bg-navy-800/10'
                    : 'border-gray-200 dark:border-gray-600 hover:border-gray-300'
                }`}
                aria-label={`Pick ${e}`}
              >{e}</button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={saveProfile}
            className="bg-navy-800 text-white rounded-xl px-4 py-2 text-sm font-semibold hover:bg-navy-700 transition-colors"
          >Save profile</button>
          {profileMsg && <span className={`text-xs ${profileMsg.includes('✓') ? 'text-green-600' : 'text-red-600'}`}>{profileMsg}</span>}
        </div>
      </section>

      {/* --- Password --- */}
      <section className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5 space-y-3">
        <h2 className="font-semibold text-gray-800 dark:text-gray-100">Change password</h2>
        <input
          type="password"
          value={currentPw}
          onChange={e => setCurrentPw(e.target.value)}
          placeholder="Current password"
          className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-navy-800"
        />
        <input
          type="password"
          value={newPw}
          onChange={e => setNewPw(e.target.value)}
          placeholder="New password (min 4 characters)"
          className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-navy-800"
        />
        <div className="flex items-center gap-3">
          <button
            onClick={changePassword}
            disabled={!currentPw || !newPw}
            className="bg-navy-800 text-white rounded-xl px-4 py-2 text-sm font-semibold hover:bg-navy-700 transition-colors disabled:opacity-50"
          >Update password</button>
          {pwMsg && <span className={`text-xs ${pwMsg.includes('✓') ? 'text-green-600' : 'text-red-600'}`}>{pwMsg}</span>}
        </div>
      </section>

      {/* --- Danger zone --- */}
      <section className="bg-white dark:bg-gray-800 rounded-2xl border border-red-200 dark:border-red-900 p-5 space-y-3">
        <h2 className="font-semibold text-red-600 dark:text-red-400">Delete account</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Permanently removes your account, open orders (with refunds), and positions.
          Historical trades stay to keep market price history intact.
          To confirm, type your username <code className="font-mono">{user?.username}</code> below.
        </p>
        <input
          type="text"
          value={confirmDel}
          onChange={e => setConfirmDel(e.target.value)}
          placeholder={`Type "${user?.username}" to confirm`}
          className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
        />
        <div className="flex items-center gap-3">
          <button
            onClick={deleteAccount}
            disabled={confirmDel !== user?.username}
            className="bg-red-600 text-white rounded-xl px-4 py-2 text-sm font-semibold hover:bg-red-700 transition-colors disabled:opacity-50"
          >Delete my account</button>
          {delMsg && <span className="text-xs text-red-600">{delMsg}</span>}
        </div>
      </section>
    </div>
  );
}
