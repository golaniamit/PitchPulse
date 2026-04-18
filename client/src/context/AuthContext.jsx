import { createContext, useContext, useState, useEffect } from 'react';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.user) setUser(data.user); })
      .finally(() => setLoading(false));
  }, []);

  async function login(username, password) {
    const r = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error);
    setUser(data.user);
    return data.user;
  }

  async function register(username, password, display_name, email) {
    const r = await fetch('/api/auth/register', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, display_name, email }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error);
    // Returns { ok, requiresVerification, email } — no user session yet
    return data;
  }

  async function resendVerification(email) {
    const r = await fetch('/api/auth/resend-verification', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error);
    return data;
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    setUser(null);
  }

  function updateBalance(newBalance) {
    setUser(u => u ? { ...u, balance: newBalance } : u);
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, register, resendVerification, logout, updateBalance }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
