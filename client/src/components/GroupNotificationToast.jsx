import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSocket } from '../context/SocketContext';
import { useGroup } from '../context/GroupContext';

// Lightweight in-app toast that fires when something newsworthy happens in a
// group the user is a member of but isn't currently viewing — so they know
// to switch over. Complements ResolutionToast (which fires on the user's own
// bet settlement) and the feed rail (which shows everything passively).
//
// Only fires if the member has notify_enabled on for that group.
// Public-context events never cross into this toast — those belong to
// ResolutionToast.

export default function GroupNotificationToast() {
  const { on } = useSocket();
  const { groups, currentGroupId, setCurrent } = useGroup();
  const [toast, setToast] = useState(null);
  const timerRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    // `groups` carries the user's notify_enabled flag per group via
    // /api/groups/mine — we read it to decide whether to surface the event.
    const enabledIn = new Set(
      (groups || []).filter(g => g.notify_enabled).map(g => g.id)
    );
    if (enabledIn.size === 0) return;

    function handle(type, msg) {
      const gid = msg?.groupId;
      if (!gid) return;                    // public event — not ours
      if (gid === currentGroupId) return;  // already in this group — they'll see it in feed
      if (!enabledIn.has(gid)) return;     // not subscribed
      const group = groups.find(g => g.id === gid);
      if (!group) return;
      const body = type === 'contract_created'
        ? `📝 New contract in ${group.name}: "${msg.contract?.title || 'Untitled'}"`
        : `⚖️ A contract in ${group.name} just resolved ${msg.resolution || ''}`;
      setToast({ body, groupId: gid });
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setToast(null), 7000);
    }

    const unsubs = [
      on('contract_created',  (m) => handle('contract_created', m)),
      on('contract_resolved', (m) => handle('contract_resolved', m)),
    ];
    return () => unsubs.forEach(fn => fn?.());
  }, [on, groups, currentGroupId]);

  if (!toast) return null;

  function openGroup() {
    setCurrent(toast.groupId);
    navigate('/');
    setToast(null);
  }

  return (
    <div className="fixed bottom-20 right-4 z-[9998] w-72 pointer-events-auto">
      <div
        onClick={openGroup}
        role="button" tabIndex={0}
        className="cursor-pointer rounded-xl shadow-xl border border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-900/40 p-3 flex items-start gap-2 transition-transform hover:scale-[1.02]"
      >
        <div className="text-xl flex-shrink-0">🔔</div>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-purple-900 dark:text-purple-200 leading-snug">{toast.body}</p>
          <p className="text-[10px] text-purple-700 dark:text-purple-300 mt-0.5">Tap to switch →</p>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); setToast(null); }}
          className="text-purple-400 hover:text-purple-700 text-sm leading-none flex-shrink-0"
          aria-label="Dismiss"
        >✕</button>
      </div>
    </div>
  );
}
