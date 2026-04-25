import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGroup } from '../context/GroupContext';

// Nav-row-1 chip that shows the current context and opens a dropdown of all
// the groups the user belongs to plus "Public markets". Lives in the navbar
// on both mobile and desktop.

// Deterministic pastel colour from a group name — used for the 2-letter badge.
function groupColour(name = '') {
  const palette = [
    ['bg-purple-100', 'text-purple-700'],
    ['bg-sky-100',    'text-sky-700'],
    ['bg-rose-100',   'text-rose-700'],
    ['bg-amber-100',  'text-amber-700'],
    ['bg-emerald-100','text-emerald-700'],
    ['bg-indigo-100', 'text-indigo-700'],
  ];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return palette[Math.abs(h) % palette.length];
}

function groupInitials(name = '') {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

export default function GroupSwitcher({ onRequestCreate, onRequestJoin }) {
  const { groups, currentGroupId, currentGroup, ctxBalance, setCurrent } = useGroup();
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    function handler(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const [bg, fg] = currentGroup ? groupColour(currentGroup.name) : ['', ''];

  return (
    // Mobile: chip shrinks to fit the row alongside the right-side cluster
    // (install button + balance + avatar). It hits min-w-0 so the inner text
    // can truncate before we ever overlap the coins. Desktop pins it to 12rem
    // so toggling between Public markets and a group doesn't reflow the nav.
    <div className="relative min-w-0 flex-1 sm:flex-none sm:w-[12rem]" ref={rootRef}>
      <button
        onClick={() => setOpen(o => !o)}
        className={`w-full flex items-center gap-1.5 sm:gap-2 rounded-lg px-2 sm:px-2.5 py-1 text-xs sm:text-sm min-w-0 ${
          open ? 'bg-white/20 ring-1 ring-white/40' : 'bg-white/10 hover:bg-white/15'
        }`}
      >
        {/* Fixed icon box to avoid 1-2px jitter when toggling between the
            home emoji and a group's 2-letter badge. */}
        <span className="w-4 h-4 sm:w-6 sm:h-6 flex items-center justify-center flex-shrink-0">
          {currentGroup ? (
            <span className={`w-full h-full rounded flex items-center justify-center font-bold text-[9px] sm:text-xs ${bg} ${fg}`}>
              {groupInitials(currentGroup.name)}
            </span>
          ) : (
            <span className="text-xs sm:text-sm leading-none">🏠</span>
          )}
        </span>
        <span className="font-semibold text-white truncate flex-1 text-left">
          {currentGroup ? currentGroup.name : 'Public markets'}
        </span>
        <svg width="10" height="10" viewBox="0 0 20 20" fill="currentColor"
             className={`text-white/70 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}>
          <path d="M5.5 7.5l4.5 4.5 4.5-4.5" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1.5 w-72 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-100 dark:border-gray-700 overflow-hidden z-50">
          {/* Public context */}
          <button
            onClick={() => { setCurrent(null); setOpen(false); navigate('/'); }}
            className={`w-full flex items-center justify-between px-3 py-2.5 text-left ${
              currentGroupId == null ? 'bg-slate-50 dark:bg-gray-700/40' : 'hover:bg-slate-50 dark:hover:bg-gray-700/40'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <span className="text-xl">🏠</span>
              <div>
                <p className="text-sm font-semibold text-slate-900 dark:text-white">Public markets</p>
                <p className="text-[11px] text-slate-500 dark:text-gray-400">Everyone on PitchPulse</p>
              </div>
            </div>
          </button>

          {/* Your groups */}
          {groups.length > 0 && (
            <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-slate-400 font-bold bg-slate-100 dark:bg-gray-900/40 border-y border-slate-200 dark:border-gray-700">
              Your groups · {groups.length}
            </div>
          )}
          <div className="max-h-56 overflow-y-auto">
            {groups.map(g => {
              const [gbg, gfg] = groupColour(g.name);
              return (
                <button
                  key={g.id}
                  onClick={() => { setCurrent(g.id); setOpen(false); navigate('/'); }}
                  className={`w-full flex items-center justify-between px-3 py-2.5 text-left ${
                    currentGroupId === g.id ? 'bg-purple-50 dark:bg-purple-900/20' : 'hover:bg-slate-50 dark:hover:bg-gray-700/40'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className={`w-7 h-7 rounded-lg flex items-center justify-center font-bold text-xs ${gbg} ${gfg}`}>
                      {groupInitials(g.name)}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900 dark:text-white truncate flex items-center gap-1.5">
                        {g.name}
                        {g.role === 'admin' && (
                          <span className="text-[9px] uppercase tracking-wide bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded">admin</span>
                        )}
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-gray-400">
                        {g.member_count} {g.member_count === 1 ? 'member' : 'members'} · {g.contract_count} contracts
                      </p>
                    </div>
                  </div>
                  <span className="text-xs text-slate-700 dark:text-gray-300 font-semibold flex-shrink-0 ml-2">🪙 {g.balance?.toLocaleString()}</span>
                </button>
              );
            })}
          </div>

          {/* Actions */}
          <div className="px-2 py-2 bg-slate-50 dark:bg-gray-900/40 border-t border-slate-200 dark:border-gray-700 flex gap-2">
            <button
              onClick={() => { setOpen(false); onRequestCreate?.(); }}
              className="flex-1 text-xs font-semibold text-slate-700 dark:text-gray-200 bg-white dark:bg-gray-800 border border-slate-200 dark:border-gray-700 rounded-lg py-1.5 hover:border-navy-800 dark:hover:border-white"
            >
              + Create group
            </button>
            <button
              onClick={() => { setOpen(false); onRequestJoin?.(); }}
              className="flex-1 text-xs font-semibold text-slate-700 dark:text-gray-200 bg-white dark:bg-gray-800 border border-slate-200 dark:border-gray-700 rounded-lg py-1.5 hover:border-navy-800 dark:hover:border-white"
            >
              🔑 Join via code
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export { groupColour, groupInitials };
