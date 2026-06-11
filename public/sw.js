// Cache-first shell so dyad mode runs with zero connectivity once loaded.
const CACHE = 'blackbox-v5';
const ASSETS = [
  '/', '/index.html', '/styles.css', '/deck.json',
  '/js/main.js', '/js/util.js', '/js/audio.js', '/js/storage.js', '/js/deck.js', '/js/tutorial.js',
  '/js/scoring.js', '/js/stats.js', '/js/statsview.js', '/js/table.js', '/js/stage.js', '/js/local.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin || e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then(m => m || caches.match('/index.html')))
  );
});
