const CACHE_NAME = 'car-ia-photobooth-cache-v1';
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/assets/01A.png',
  '/assets/02A.png',
  '/assets/02B.png',
  '/assets/03A.png',
  '/assets/03B.png',
  '/assets/03C.png'
];

// Install Event - Pre-cache essential assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Pre-caching core application shell');
      return cache.addAll(PRECACHE_ASSETS);
    }).then(() => {
      return self.skipWaiting();
    })
  );
});

// Activate Event - Clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('[Service Worker] Deleting obsolete cache store:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      return self.clients.claim();
    })
  );
});

// Fetch Event - Intercepting network request
self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);

  // 0. Completely bypass interception in AI Studio development/preview sandboxes and localhost to prevent Vite ESM loading issues on Safari
  if (
    requestUrl.hostname.includes('localhost') ||
    requestUrl.hostname.includes('127.0.0.1') ||
    requestUrl.hostname.includes('ais-dev') ||
    requestUrl.hostname.includes('ais-pre')
  ) {
    return;
  }

  // 1. Bypass Service Worker entirely for dev tools, web sockets, livereload & non-GET requests
  if (
    event.request.method !== 'GET' ||
    requestUrl.pathname.includes('/vite') ||
    requestUrl.pathname.includes('/@vite') ||
    requestUrl.pathname.includes('/@react') ||
    requestUrl.pathname.includes('/@id') ||
    requestUrl.pathname.includes('/src/') ||
    requestUrl.pathname.includes('ws') ||
    requestUrl.hostname === 'localhost' && requestUrl.port === '3000' && requestUrl.pathname.includes('socket')
  ) {
    return;
  }

  // 2. Direct Network bypass for all dynamic API endpoints (e.g., photo removal endpoints, backend endpoints)
  if (requestUrl.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request).catch(() => {
        return new Response(
          JSON.stringify({ error: 'Network error. The background removal API is unavailable while offline.' }),
          { headers: { 'Content-Type': 'application/json' }, status: 503 }
        );
      })
    );
    return;
  }

  // 3. Main HTML page fallback / navigation fallback (for single page routing)
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => {
        return caches.match('/');
      })
    );
    return;
  }

  // 4. Cache-First or Stale-While-Revalidate for other static assets (images, fonts, bundles)
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        // Fetch fresh copy in the background to update the cache
        fetch(event.request).then((networkResponse) => {
          if (networkResponse.status === 200) {
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, networkResponse));
          }
        }).catch(() => {/* Ignore background sync failures */});
        
        return cachedResponse;
      }

      // If of type image, audio, font or css and was missed, fetch and cache
      return fetch(event.request).then((networkResponse) => {
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
          return networkResponse;
        }

        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });

        return networkResponse;
      }).catch((err) => {
        // Fallback for missing images
        if (event.request.destination === 'image') {
          return caches.match('/assets/01A.png');
        }
        throw err;
      });
    })
  );
});
