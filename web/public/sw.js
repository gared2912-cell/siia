// Service worker de la app SIIA: muestra las notificaciones push y, al tocarlas, abre la sección indicada.
// No guarda páginas en caché: la app siempre carga la versión publicada.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'SIIA', body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'SIIA', {
      body: data.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-96.png',
      tag: data.tag,
      renotify: !!data.tag,
      data: { url: data.url || '/portal/' },
      lang: 'es-MX',
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/portal/', self.location.origin);
  event.waitUntil(
    (async () => {
      const ventanas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      // Si la app ya está abierta en esa sección (portal o panel), se reutiliza esa ventana.
      const misma = ventanas.find((c) => new URL(c.url).pathname === url.pathname);
      if (misma) {
        await misma.focus();
        return misma.navigate(url.href).catch(() => undefined);
      }
      return self.clients.openWindow(url.href);
    })(),
  );
});
