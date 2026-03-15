/**
 * Service Worker for Claude Code Mobile PWA
 * Strategy: Cache static assets, network-first for navigation, skip WebSocket and API
 */

const CACHE_NAME = "claude-code-mobile-v1";
const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
];

// Install event: cache static assets
self.addEventListener("install", (event) => {
  console.log("[SW] Install event");
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log("[SW] Caching static assets");
        return cache.addAll(STATIC_ASSETS);
      })
      .catch((error) => {
        console.error("[SW] Cache installation failed:", error);
        // Continue without SW cache
      })
  );
  // Activate immediately
  self.skipWaiting();
});

// Activate event: clean up old caches
self.addEventListener("activate", (event) => {
  console.log("[SW] Activate event");
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log("[SW] Deleting old cache:", cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  // Take control of all clients immediately
  self.clients.claim();
});

// Fetch event: network-first for navigation, skip /ws and /api
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip WebSocket and API requests
  if (url.pathname.startsWith("/ws") || url.pathname.startsWith("/api")) {
    return; // Let the request pass through
  }

  // Network-first strategy for navigation requests
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .catch(() => {
          // Fallback to cached index.html if offline
          return caches.match("/index.html");
        })
    );
    return;
  }

  // Cache-first for static assets
  event.respondWith(
    caches.match(request)
      .then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(request).then((response) => {
          // Cache successful responses for JS, CSS, images
          if (
            response.ok &&
            (request.url.match(/\.(js|css|png|jpg|jpeg|svg|ico)$/) ||
             request.url.includes("/icons/"))
          ) {
            const responseToCache = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseToCache);
            });
          }
          return response;
        });
      })
  );
});
