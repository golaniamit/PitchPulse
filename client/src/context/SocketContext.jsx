import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { useAuth } from './AuthContext';

const SocketContext = createContext(null);

export function SocketProvider({ children }) {
  const { user, updateBalance } = useAuth();
  const ws = useRef(null);
  const listeners = useRef({});
  const [connected, setConnected] = useState(false);

  const on = useCallback((type, fn) => {
    if (!listeners.current[type]) listeners.current[type] = new Set();
    listeners.current[type].add(fn);
    return () => listeners.current[type]?.delete(fn);
  }, []);

  const send = useCallback((msg) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify(msg));
    }
  }, []);

  useEffect(() => {
    if (!user) return;

    function connect() {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = new WebSocket(`${protocol}//${window.location.hostname}:3001`);
      ws.current = socket;

      socket.onopen = () => setConnected(true);
      socket.onclose = () => {
        setConnected(false);
        // Reconnect after 3s
        setTimeout(connect, 3000);
      };

      socket.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          // Handle balance updates globally
          if (msg.type === 'balance_update' && msg.userId === user.id) {
            updateBalance(msg.newBalance);
          }
          // Dispatch to listeners
          const fns = listeners.current[msg.type];
          if (fns) fns.forEach(fn => fn(msg));
          // Also dispatch to wildcard listeners
          const all = listeners.current['*'];
          if (all) all.forEach(fn => fn(msg));
        } catch (e) {
          // ignore
        }
      };
    }

    connect();
    return () => {
      ws.current?.close();
    };
  }, [user?.id]);

  return (
    <SocketContext.Provider value={{ connected, on, send }}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  return useContext(SocketContext);
}
