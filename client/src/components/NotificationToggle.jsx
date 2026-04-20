import { useEffect, useState } from 'react';

/**
 * Deliberate opt-in control for Web Push.
 * Intentionally NOT auto-firing Notification.requestPermission() on page load —
 * users hate that. This component shows "Enable notifications" only when supported,
 * and the actual browser prompt only fires when the user clicks.
 *
 * Lives inside the profile dropdown.
 */
function urlBase64ToUint8Array(base64) {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const norm = (base64 + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(norm);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export default function NotificationToggle() {
  const [supported, setSupported] = useState(false);
  const [state, setState] = useState('loading');
  // 'unsupported' | 'disabled' | 'granted' | 'subscribed' | 'loading' | 'denied'
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    const ok = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    setSupported(ok);
    if (!ok) { setState('unsupported'); return; }
    (async () => {
      try {
        const r = await fetch('/api/push/status', { credentials: 'include' });
        const d = await r.json();
        if (d.subscribed) setState('subscribed');
        else if (Notification.permission === 'denied') setState('denied');
        else setState('disabled');
      } catch { setState('disabled'); }
    })();
  }, []);

  async function subscribe() {
    setBusy(true); setMsg('');
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        setState(perm === 'denied' ? 'denied' : 'disabled');
        throw new Error(perm === 'denied'
          ? 'Notifications blocked — enable them in your browser site settings.'
          : 'Permission not granted');
      }
      const reg = await navigator.serviceWorker.register('/service-worker.js');
      await navigator.serviceWorker.ready;

      const keyRes = await fetch('/api/push/public-key', { credentials: 'include' });
      const { publicKey } = await keyRes.json();
      if (!publicKey) throw new Error('Server has no VAPID key configured');

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      await fetch('/api/push/subscribe', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sub.toJSON()),
      });
      setState('subscribed');
      setMsg('Enabled ✓');
      // Send a welcome ping so the user immediately sees it work.
      fetch('/api/push/test', { method: 'POST', credentials: 'include' }).catch(() => {});
    } catch (e) {
      setMsg(e.message);
    } finally { setBusy(false); }
  }

  async function unsubscribe() {
    setBusy(true); setMsg('');
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await fetch('/api/push/unsubscribe', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setState('disabled');
      setMsg('Disabled');
    } catch (e) { setMsg(e.message); }
    finally { setBusy(false); }
  }

  if (state === 'unsupported' || state === 'loading') return null;

  const label = state === 'subscribed'
    ? '🔔 Notifications on'
    : state === 'denied'
    ? '🔕 Blocked in browser'
    : '🔔 Enable notifications';

  return (
    <button
      onClick={state === 'subscribed' ? unsubscribe : subscribe}
      disabled={busy || state === 'denied'}
      className="w-full flex items-center justify-between px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-60"
      title={state === 'denied' ? 'Your browser has notifications blocked for this site. Re-enable in site settings.' : ''}
    >
      <span>{label}</span>
      {state === 'subscribed' && <span className="text-[10px] text-green-600">ON</span>}
    </button>
  );
}
