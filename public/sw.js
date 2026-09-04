// Crew Pocket app-shell cache.  Every deploy changes this revision, so an
// activated Service Worker can never serve JavaScript from a previous build.
const BUILD_REVISION = 'auto-8ab93a578c94';
const APP_SHELL_CACHE = `crew-pocket-shell-${BUILD_REVISION}`;
const RUNTIME_CACHE = `crew-pocket-runtime-${BUILD_REVISION}`;
const APP_SHELL = [
  "/",
  "/manifest.json?v=085e5d3a565e",
  "/css/style.css?v=b3d2fbdbe3c2",
  "/css/style-premium.css?v=d7f488f0e295",
  "/js/i18n.js?v=658a42026ca6",
  "/js/ui.js?v=f3e6467243ff",
  "/js/tools.js?v=a1e169518419",
  "/js/storage.js?v=0e143c8da2fc",
  "/js/chat.js?v=a160805fd2bc",
  "/js/tasks.js?v=2e5e3f5e9e77",
  "/js/live.js?v=42a1deb1ed79",
  "/js/phone_agent.js?v=6346f686519a",
  "/js/app.js?v=d09867829da4",
  "/dompurify.min.js",
  "/heic2any.min.js",
  "/icon-192.png",
  "/icon-512.png",
  "/icon.png",
  "https://cdn.tailwindcss.com",
  "https://cdn.jsdelivr.net/npm/marked/marked.min.js",
  "https://cdn.jsdelivr.net/npm/chart.js",
  "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/atom-one-dark.min.css",
  "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"
];
const CDN_HOSTS = new Set(['cdn.tailwindcss.com', 'cdn.jsdelivr.net', 'cdnjs.cloudflare.com']);

function isCacheable(response) {
  return response && (response.ok || response.type === 'opaque');
}

async function cacheAppShell() {
  const cache = await caches.open(APP_SHELL_CACHE);
  // A missing optional resource must not prevent installation of the whole PWA.
  await Promise.all(APP_SHELL.map(async (url) => {
    try {
      const response = await fetch(url, {
        cache: 'reload',
        // Cross-origin CDN files can be stored as opaque responses; the browser
        // can later execute the same request from Cache Storage offline.
        mode: url.startsWith('http') ? 'no-cors' : 'same-origin'
      });
      if (isCacheable(response)) await cache.put(url, response);
    } catch (err) {
      console.warn('[Crew Pocket SW] shell cache skipped:', url, err.message);
    }
  }));
}

self.addEventListener('install', (event) => {
  event.waitUntil(cacheAppShell().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter(name => name.startsWith('crew-pocket-') && name !== APP_SHELL_CACHE && name !== RUNTIME_CACHE)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (isCacheable(response)) {
      const cache = await caches.open(RUNTIME_CACHE);
      await cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    return (await caches.match(request)) || (await caches.match('/')) || Response.error();
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (isCacheable(response)) {
    const cache = await caches.open(RUNTIME_CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET') return;
  const isLocalRequest = url.origin === self.location.origin;
  const isTrustedCdn = CDN_HOSTS.has(url.hostname);
  // Dynamic data and streams must always stay live. Only the explicitly named
  // static CDNs are cacheable; no arbitrary external page is intercepted.
  if ((!isLocalRequest && !isTrustedCdn) || (isLocalRequest && url.pathname.startsWith('/api/'))) return;

  if (isTrustedCdn) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }

  // Versioned JS/CSS and local media are safe to serve directly from cache.
  if (url.searchParams.has('v') || /\.(?:js|css|wasm|jpg|jpeg|png|svg|webp|heic|heif)$/i.test(url.pathname)) {
    event.respondWith(cacheFirst(request));
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url && 'focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow('/');
      }
    })
  );
});
