// The Chapter — service worker.
// Deliberately conservative caching so app updates are never stuck stale:
//   · Navigations (HTML): network-first, cached /app as offline fallback.
//   · Hashed build assets (/assets/*): cache-first — filenames change per
//     build, so these are immutable by construction.
//   · Chapter text (/api/gutenberg): cache-first — public-domain text never
//     changes, and this is what makes offline reading work on the subway.
//   · Everything else (other /api/*, third parties): straight to network.
const VERSION = "chapter-v1";
const SHELL = ["/app", "/manifest.webmanifest", "/icons/icon-192.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // App navigations: fresh when online, shell when not.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put("/app", copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match("/app"))
    );
    return;
  }

  // Immutable: hashed build assets + icons + chapter text.
  const cacheFirst =
    url.pathname.startsWith("/assets/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/manifest.webmanifest" ||
    url.pathname === "/api/gutenberg";
  if (cacheFirst) {
    e.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
            }
            return res;
          })
      )
    );
  }
  // All other requests (subscriptions, send, claude, checkout): network only.
});
