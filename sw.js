// ===== MSS:84 PWA Service Worker =====
// Safe for GitHub Pages subpath. Does not touch non-GET or cross-origin requests.

const CACHE_NAME = "mss84-shell-v1"; // bump when you change the shell list

// Compute base path dynamically (e.g., "/Battletech-Mobile-Skirmish/")
const BASE = new URL('./', self.location).pathname;

// Keep precache TINY to avoid 404s breaking install. We add files individually.
const PRECACHE_URLS = [
  "./",                  // resolves to BASE
  "./index.html",
  "./style.css",
  "./script.js",
  "./manifest.webmanifest"
];

// ---- Install: precache shell (best-effort; ignore missing files) ----
self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    for (const url of PRECACHE_URLS) {
      try { await cache.add(url); } catch (e) { /* ignore missing */ }
    }
    // Optional: self.skipWaiting();
  })());
});

// ---- Activate: cleanup old caches when CACHE_NAME changes ----
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.map(k => (k === CACHE_NAME ? null : caches.delete(k)))
    );
    // Optional: await self.clients.claim();
  })());
});

// Utility: quick path helpers under the detected BASE
const under = (path) => (p) => p.startsWith(BASE + path);
const isAssets = under("assets/");
const isData   = under("data/");
const isPresets= under("presets/");

// ---- Fetch: careful guards, then per-route strategies ----
self.addEventListener("fetch", (event) => {
  const req = event.request;

  // 1) GET only (don’t touch POST/PUT/etc. → safe for saves/transmits)
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // 2) Same-origin only (leave Firebase/Google APIs/websockets alone)
  if (url.origin !== self.location.origin) return;

  const path = url.pathname;

  // A) HTML navigations → network-first (with cached fallback to index.html)
  //    Matches your current behavior + supports SPA-style navigation.
  if (req.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const net = await fetch(req);
        const clone = net.clone();
        const c = await caches.open(CACHE_NAME);
        c.put(req, clone);
        return net;
      } catch (_) {
        // fallback to cached index.html (app shell)
        return (await caches.match("./index.html")) ||
               (await caches.match(req)) ||
               new Response("Offline", { status: 503, statusText: "Offline" });
      }
    })());
    return;
  }

  // B) Preserve your current rule: network-first for HTML + preset JSON
  const acceptsHTML = req.headers.get('accept')?.includes('text/html');
  if (acceptsHTML || isPresets(path)) {
    event.respondWith((async () => {
      try {
        const net = await fetch(req);
        const clone = net.clone();
        const c = await caches.open(CACHE_NAME);
        c.put(req, clone);
        return net;
      } catch (_) {
        return caches.match(req);
      }
    })());
    return;
  }

  // C) App shell files (precache list) → cache-first
  const isShell = PRECACHE_URLS.some(u => url.pathname.endsWith(u.replace("./", "/")));
  if (isShell) {
    event.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(req, clone));
        return res;
      }))
    );
    return;
  }

  // D) Heavy JSON (assets/ & data/) → stale-while-revalidate (fast + updates)
  if (isAssets(path) || isData(path)) {
    event.respondWith(
      caches.match(req).then(cached => {
        const net = fetch(req).then(res => {
          caches.open(CACHE_NAME).then(c => c.put(req, res.clone()));
          return res;
        }).catch(() => cached || Promise.reject("offline"));
        return cached || net;
      })
    );
    return;
  }

  // E) Default → network-first with cache fallback
  event.respondWith(
    fetch(req).then(res => {
      const clone = res.clone();
      caches.open(CACHE_NAME).then(c => c.put(req, clone));
      return res;
    }).catch(() => caches.match(req))
  );
});
