// PitchPulse push notification service worker.
// Receives payloads from the server via webpush and shows OS-level notifications.

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
