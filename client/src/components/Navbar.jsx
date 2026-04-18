import { useEffect, useState, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { useTheme } from '../context/ThemeContext';
import PitchPulseLogo from './PitchPulseLogo';

function useLiveScore() {
  const [score, setScore] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function fetch_() {
      try {
        const r = await fetch('/api/admin/live-score');
        const d = await r.json();
        if (!cancelled) setScore(d.available ? d : null);
      } catch { /* ignore */ }
    }
    fetch_();
    const id = setInterval(fetch_, 30000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  return score;
}

/* Generates initials avatar colour deterministically from username */
function avatarColor(username = '') {
  const colours = [
    '#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b',
    '#10b981', '#06b6d4', '#f97316', '#6366f1',
  ];
  let hash = 0;
  for (let i = 0; i < username.length; i++) hash = username.charCodeAt(i) + ((hash << 5) - hash);
  return colours[Math.abs(hash) % colours.length];
}

function initials(user) {
  if (!user) return '?';
  const name = user.display_name || user.username || '';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

export default function Navbar() {
  const { user, logout } = useAuth();
  const { connected } = useSocket();
  const { dark, toggle } = useTheme();
  const loc = useLocation();
  const navigate = useNavigate();
  const liveScore = useLiveScore();
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handler(e) {
      if (profileRef.current && !profileRef.current.contains(e.target)) {
        setProfileOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Close on route change
  useEffect(() => { setProfileOpen(false); }, [loc.pathname]);

  const navLink = (to, label) => (
    <Link
      to={to}
      className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
        loc.pathname === to
          ? 'bg-white/20 text-white'
          : 'text-white/70 hover:text-white hover:bg-white/10'
      }`}
    >
      {label}
    </Link>
  );

  async function handleLogout() {
    setProfileOpen(false);
    await logout();
  }

  const displayLabel = user?.display_name || user?.username || '';
  const bg = avatarColor(user?.username);

  return (
    <nav className="bg-navy-800 shadow-lg sticky top-0 z-50">
      <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">

        {/* Left: logo + nav links */}
        <div className="flex items-center gap-6">
          <Link to="/" className="flex items-center gap-2">
            <PitchPulseLogo size={32} showWordmark={true} dark={true} />
            <span className="text-[10px] font-bold tracking-widest uppercase bg-amber-400 text-amber-900 px-1.5 py-0.5 rounded-full leading-none select-none">
              beta
            </span>
          </Link>
          <div className="hidden sm:flex items-center gap-1">
            {navLink('/', 'Markets')}
            {navLink('/portfolio', 'Portfolio')}
            {navLink('/leaderboard', 'Leaderboard')}
            {navLink('/feedback', 'Feedback')}
            {user?.is_admin ? navLink('/admin', 'Admin') : null}
          </div>
        </div>

        {/* Right: dark toggle + connection dot + balance + profile */}
        <div className="flex items-center gap-3">

          {/* Dark mode toggle */}
          <div className="flex items-center gap-1.5">
            <span className="text-white/50 text-xs">☀️</span>
            <button
              onClick={toggle}
              title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 focus:outline-none ${dark ? 'bg-white/40' : 'bg-white/20'}`}
            >
              <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform duration-200 ${dark ? 'translate-x-4' : 'translate-x-0.5'}`} />
            </button>
            <span className="text-white/50 text-xs">🌙</span>
          </div>

          {/* Connection dot */}
          <div
            className={`w-2 h-2 rounded-full ${connected ? 'bg-green-400' : 'bg-red-400'}`}
            title={connected ? 'Live' : 'Reconnecting'}
          />

          {/* Coin balance */}
          <div className="bg-white/10 px-3 py-1 rounded-full text-white text-sm font-semibold">
            🪙 {user?.balance?.toLocaleString()}
          </div>

          {/* Profile avatar + dropdown */}
          <div className="relative" ref={profileRef}>
            <button
              onClick={() => setProfileOpen(o => !o)}
              className="flex items-center gap-2 focus:outline-none group"
              title="Profile"
            >
              {/* Avatar circle */}
              <span
                className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold ring-2 ring-white/20 group-hover:ring-white/50 transition-all"
                style={{ background: bg }}
              >
                {initials(user)}
              </span>
              {/* Chevron */}
              <svg
                className={`w-3 h-3 text-white/50 transition-transform duration-200 ${profileOpen ? 'rotate-180' : ''}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {/* Dropdown */}
            {profileOpen && (
              <div className="absolute right-0 mt-2 w-56 bg-white dark:bg-gray-800 rounded-2xl shadow-xl border border-gray-100 dark:border-gray-700 overflow-hidden z-50">

                {/* User info header */}
                <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700">
                  <div className="flex items-center gap-3">
                    <span
                      className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0"
                      style={{ background: bg }}
                    >
                      {initials(user)}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">
                        {displayLabel}
                      </p>
                      {user?.display_name && (
                        <p className="text-xs text-gray-400 truncate">@{user.username}</p>
                      )}
                      <p className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
                        🪙 <span className="font-semibold text-gray-700 dark:text-gray-300">{user?.balance?.toLocaleString()}</span> coins
                      </p>
                    </div>
                  </div>
                </div>

                {/* Menu items */}
                <div className="py-1">
                  <Link
                    to="/portfolio"
                    className="flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                  >
                    <span className="text-base">📊</span> My Portfolio
                  </Link>
                  <Link
                    to="/leaderboard"
                    className="flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                  >
                    <span className="text-base">🏆</span> Leaderboard
                  </Link>
                  <Link
                    to="/feedback"
                    className="flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                  >
                    <span className="text-base">💬</span> Feedback
                  </Link>

                  {/* Dark mode toggle inside menu */}
                  <button
                    onClick={toggle}
                    className="w-full flex items-center justify-between px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                  >
                    <span className="flex items-center gap-3">
                      <span className="text-base">{dark ? '☀️' : '🌙'}</span>
                      {dark ? 'Light mode' : 'Dark mode'}
                    </span>
                    <span className={`w-8 h-4 rounded-full flex items-center px-0.5 transition-colors ${dark ? 'bg-indigo-500' : 'bg-gray-300'}`}>
                      <span className={`w-3 h-3 rounded-full bg-white shadow transition-transform duration-200 ${dark ? 'translate-x-4' : 'translate-x-0'}`} />
                    </span>
                  </button>

                  <div className="border-t border-gray-100 dark:border-gray-700 my-1" />

                  <button
                    onClick={handleLogout}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                  >
                    <span className="text-base">↗</span> Sign out
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Live score banner */}
      {liveScore && (
        <div className="bg-navy-900 border-t border-white/10 px-4 py-1.5">
          <div className="max-w-5xl mx-auto flex items-center justify-between gap-2 text-xs">
            <span className="text-white/50 truncate max-w-[120px] sm:max-w-none">{liveScore.matchName}</span>
            <div className="flex items-center gap-3 flex-shrink-0">
              {(liveScore.score || []).map((s, i) => (
                <span key={i} className="text-white font-semibold">
                  {s.inning?.replace(' Inning 1','').replace(' Inning 2','')} {s.r}/{s.w}
                  <span className="text-white/50 font-normal ml-1">({s.o})</span>
                </span>
              ))}
              {liveScore.status && !liveScore.matchEnded && (
                <span className="text-green-400 font-medium flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block animate-pulse" />
                  LIVE
                </span>
              )}
              {liveScore.matchEnded && <span className="text-white/50">Finished</span>}
            </div>
          </div>
        </div>
      )}

      {/* Mobile nav */}
      <div className="sm:hidden flex border-t border-white/10">
        {[
          ['/', 'Markets'],
          ['/portfolio', 'Portfolio'],
          ['/leaderboard', 'Board'],
          ['/feedback', 'Feedback'],
          ...(user?.is_admin ? [['/admin', 'Admin']] : []),
        ].map(([to, label]) => (
          <Link
            key={to}
            to={to}
            className={`flex-1 text-center py-2 text-xs font-medium transition-colors ${
              loc.pathname === to ? 'text-white bg-white/10' : 'text-white/60'
            }`}
          >
            {label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
