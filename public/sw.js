const CACHE_NAME = "what-you-ate-v5";
const CORE_ASSETS = [
  "/",
  "/beta",
  "/login",
  "/manifest.json",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((key) => (key === CACHE_NAME ? null : caches.delete(key))))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  if (!event.request.url.startsWith("http")) return;

  // Never cache Supabase API requests — always fetch fresh from network.
  if (event.request.url.includes("supabase.co")) return;

  // Never cache AI API routes — always fresh.
  if (event.request.url.includes("/api/")) return;

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(() => caches.match("/"))
    );
    return;
  }

  // Cache-first for static assets (JS chunks, CSS, fonts, images).
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          // Cache _next/static assets — they're content-hashed so safe to cache forever.
          if (
            response.ok &&
            (event.request.url.includes("/_next/static/") ||
              event.request.url.includes("/icons/") ||
              event.request.url.includes(".png") ||
              event.request.url.includes(".svg") ||
              event.request.url.includes(".woff"))
          ) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => cached);
    })
  );
});
