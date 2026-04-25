// PitchPulse service worker.
// Two responsibilities:
//   1. PWA installability — install/activate/fetch handlers let Chrome offer "Add to Home Screen".
//   2. Push notifications — receive webpush payloads and show OS-level notifications.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Network-only pass-through. We don't cache anything — a live trading app wants fresh data.
// The presence of this handler is what qualifies the app as installable in Chrome.
self.addEventListener('fetch', () => {});

self.addEventListener('push', (event) => {
  let data = { title: 'PitchPulse', body: '', url: '/' };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch { /* keep defaults */ }

  const { title, body, url } = data;
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/favicon.ico',
      badge: '/favicon.ico',
      data: { url },
    })
  );
});

// When the user clicks the notification, focus an existing tab or open a new one.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url || '/';
  event.waitUntil(
    (async () => {
      const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const c of clientsList) {
        if ('focus' in c) {
          c.navigate?.(target);
          return c.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(target);
      }
    })()
  );
});
