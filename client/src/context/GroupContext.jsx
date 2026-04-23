import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useAuth } from './AuthContext';

// Tracks which "universe" the user is currently in — the public marketplace
// (groupId = null) or a specific friends group. Persists to localStorage so
// the choice survives a page reload. Every network call that should be
// context-scoped passes through api() below, which auto-appends ?group=<id>.

const GroupContext = createContext(null);
const STORAGE_KEY = 'pp.currentGroupId';

export function GroupProvider({ children }) {
  const { user } = useAuth();
  const [groups, setGroups]             = useState([]);   // all groups the user belongs to
  const [currentGroupId, _setCurrent]   = useState(null); // null = public
  const [ctxBalance, setCtxBalance]     = useState(null); // per-context wallet
  const [loading, setLoading]           = useState(true);

  // Load the saved context on boot and fetch /api/groups/mine so the switcher
  // dropdown is populated before first render.
  useEffect(() => {
    if (!user) { setGroups([]); _setCurrent(null); setCtxBalance(null); setLoading(false); return; }
    let cancelled = false;
    async function boot() {
      try {
        const r = await fetch('/api/groups/mine', { credentials: 'include' });
        const data = r.ok ? await r.json() : { groups: [] };
        if (cancelled) return;
        setGroups(data.groups || []);
        const saved = localStorage.getItem(STORAGE_KEY);
        const savedId = saved ? parseInt(saved, 10) : null;
        // Only keep the saved id if the user is still a member of that group.
        const validSaved = savedId && (data.groups || []).some(g => g.id === savedId) ? savedId : null;
        _setCurrent(validSaved);
        setCtxBalance(validSaved
          ? ((data.groups || []).find(g => g.id === validSaved)?.balance ?? null)
          : (user.balance ?? null));
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    boot();
    return () => { cancelled = true; };
  }, [user?.id]); // re-run when the user changes (login / logout)

  // Keep the public-wallet reading fresh when the AuthContext updates it
  // (e.g. after a trade). Group balances come via WebSocket balance_update.
  useEffect(() => {
    if (currentGroupId == null) setCtxBalance(user?.balance ?? null);
  }, [user?.balance, currentGroupId]);

  const setCurrent = useCallback((id) => {
    _setCurrent(id);
    if (id) localStorage.setItem(STORAGE_KEY, String(id));
    else localStorage.removeItem(STORAGE_KEY);
    // Refresh balance for new context immediately — no stale chip.
    const url = '/api/users/balance' + (id ? `?group=${id}` : '');
    fetch(url, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setCtxBalance(d.balance); })
      .catch(() => {});
  }, []);

  // After creating / joining a group, refresh the dropdown list.
  const refreshGroups = useCallback(async () => {
    const r = await fetch('/api/groups/mine', { credentials: 'include' });
    if (r.ok) {
      const data = await r.json();
      setGroups(data.groups || []);
    }
  }, []);

  // WebSocket balance_update hook — called by SocketContext to keep the chip
  // live without an extra round trip.
  const applyBalanceUpdate = useCallback((msg) => {
    if (!msg || msg.userId !== user?.id) return;
    const incomingGid = msg.groupId ?? null;
    if (incomingGid === currentGroupId) setCtxBalance(msg.newBalance);
    // Also update the groups list entry so the dropdown stays current.
    if (incomingGid) {
      setGroups(gs => gs.map(g => g.id === incomingGid ? { ...g, balance: msg.newBalance } : g));
    }
  }, [user?.id, currentGroupId]);

  const currentGroup = currentGroupId ? (groups.find(g => g.id === currentGroupId) || null) : null;

  return (
    <GroupContext.Provider value={{
      groups,
      currentGroupId,
      currentGroup,
      ctxBalance,
      loading,
      setCurrent,
      refreshGroups,
      applyBalanceUpdate,
    }}>
      {children}
    </GroupContext.Provider>
  );
}

export function useGroup() {
  return useContext(GroupContext);
}

// Helper: append the current group context to a URL. Call this for every
// fetch that should be context-scoped. Doesn't touch absolute URLs.
export function withGroup(url, groupId) {
  if (!groupId) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}group=${groupId}`;
}
