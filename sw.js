/* Service worker: permite usar la app sin conexión cuando se sirve por http(s). */
const CACHE = 'recallo-v9';
// Únicos orígenes externos que se guardan en caché (librerías JSZip, sql.js).
const CDN_HOSTS = ['cdnjs.cloudflare.com', 'cdn.jsdelivr.net'];
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'icons/icon.svg', 'css/app.css',
  'css/harden.css', 'css/adapt.css', 'css/a11y.css', 'css/delight.css', 'css/onboard.css', 'css/polish.css',
  'css/home.css', 'css/editor.css', 'css/browse.css', 'css/settings.css',
  'js/config.js', 'js/core/util.js', 'js/core/db.js', 'js/core/scheduler.js', 'js/core/cards.js',
  'js/core/store.js', 'js/core/anki.js', 'js/ui/ui.js', 'js/ui/home.js', 'js/ui/study.js',
  'js/ui/editor.js', 'js/ui/browse.js', 'js/ui/settings.js', 'js/app.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Red primero para los archivos de la app (así ves siempre la última versión),
// caché primero para las librerías externas (JSZip, sql.js), que no cambian.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const external = url.origin !== location.origin;
  if (external) {
    // Otros orígenes: no se interceptan, el navegador los gestiona con normalidad.
    if (!CDN_HOSTS.includes(url.hostname)) return;
    // Si no hay copia y la red falla, el error se propaga tal cual (no se oculta).
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    })));
  } else {
    // cache:'no-cache' revalida con el servidor: nunca sirve un CSS/JS viejo de la caché HTTP.
    e.respondWith(fetch(req, { cache: 'no-cache' }).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch((err) => caches.match(req).then((hit) => hit || Promise.reject(err))));
  }
});
