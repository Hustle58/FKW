/* Haze Tracker service worker: offline app shell + background threshold checks. */
importScripts('psi-core.js');

const CACHE = 'haze-tracker-v1';
const SHELL = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'psi-core.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/badge-96.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// App shell: stale-while-revalidate for same-origin GETs. NEA API calls are cross-origin and untouched.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req, { ignoreSearch: true });
      const network = fetch(req)
        .then((res) => {
          if (res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => cached || (req.mode === 'navigate' ? cache.match('index.html') : undefined));
      return cached || network;
    })
  );
});

// Chrome on Android, for installed PWAs: occasional background checks.
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'psi-check') {
    event.waitUntil(self.HazeCore.checkAndNotify(self.registration).catch(() => {}));
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) if ('focus' in w) return w.focus();
      return self.clients.openWindow((event.notification.data && event.notification.data.url) || './');
    })
  );
});
