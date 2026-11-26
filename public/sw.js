// Fair Whack service worker: offline shell + push notifications.
const CACHE = 'fw-shell-v72';
const SHELL = ['/', '/index.html', '/app.css?v=49', '/app.js?v=61', '/profile.js?v=14', '/household.js?v=8', '/fuel.js?v=6', '/maps.js?v=1', '/barcode.js?v=4', '/social.js?v=4', '/brands.js?v=6', '/manifest.webmanifest', '/icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  // Network first, cache fallback (keeps the beta fresh while working offline).
  e.respondWith(fetch(e.request).then((r) => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request).then((r) => r || caches.match('/index.html'))));
});

self.addEventListener('push', (e) => {
  // Special alerts (pipeline) carry their text. Friend requests and shared products arrive as an empty
  // wake-up push: fetch what is waiting and show it (iPhone needs every push to show something).
  if (e.data) {
    let d = {};
    try { d = e.data.json(); } catch { d = { body: e.data.text() }; }
    e.waitUntil(self.registration.showNotification(d.title || 'Fair Whack', {
      body: d.body || 'Items on your list are on special',
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-96.png',
      tag: d.tag || 'fw-specials',
      data: { url: d.url || '/#/digest' },
    }));
    return;
  }
  e.waitUntil(fetch('/api/notifications/pending', { credentials: 'same-origin' })
    .then((r) => (r.ok ? r.json() : { notifications: [] }))
    .catch(() => ({ notifications: [] }))
    .then(({ notifications: list }) => {
      const show = (title, body, url, tag) => self.registration.showNotification(title, { body: body || '', icon: '/icons/icon-192.png', badge: '/icons/badge-96.png', tag, data: { url: url || '/#/' } });
      // Friends (requests, shares) and brand deals (FW2.2) share this path.
      const friendly = list.every((n) => !String(n.kind || '').startsWith('brand'));
      if (!list.length) return show('Fair Whack', 'You have something new', '/#/', 'fw-social');
      if (list.length > 3) return show(friendly ? `${list.length} new from your friends` : `${list.length} new on Fair Whack`, list.slice(0, 3).map((n) => n.title).join('\n'), friendly ? '/#/shared' : '/#/', 'fw-social');
      return Promise.all(list.map((n) => show(n.title, n.body, n.url, `fw-${n.id}`)));
    }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = e.notification.data && e.notification.data.url || '/#/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
    // An open app is asked to go there itself (no new history entry: tab pages stay the top level).
    for (const c of cs) if ('focus' in c) { c.postMessage({ fwGo: new URL(target, self.location.origin).hash || '#/' }); return c.focus(); }
    return self.clients.openWindow(target);
  }));
});
