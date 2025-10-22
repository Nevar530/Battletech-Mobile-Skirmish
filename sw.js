// ===== MSS:84 PWA Service Worker =====
// Safe for GitHub Pages subpath. Does not touch non-GET or cross-origin requests.

const CACHE_NAME = "mss84-shell-v2"; // bump when you change the shell list

// Compute base path dynamically (e.g., "/Battletech-Mobile-Skirmish/")
const BASE = new URL('./', self.location).pathname;

// Keep precache TINY to avoid 404s breaking install. We add files individually.
const PRECACHE_URLS = [
  "./",                  // resolves to BASE
  "./index.html",
  "./style.css",
  "./script.js",
  "./manifest.webmanifest",
  "./modules/catalog.json"
];

// ---- Install: precache shell (best-effort; ignore missing files) ----
self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    for (const url of PRECACHE_URLS) {
      try { await cache.add(url); } catch (e) { /* ignore missing */ }
    }
    self.skipWaiting();
  })());
});

// ---- Activate: cleanup old caches when CACHE_NAME changes ----
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.map(k => (k === CACHE_NAME ? null : caches.delete(k)))
    );
    await self.clients.claim();
  })());
});

// Utility: quick path helpers under the detected BASE
const under = (path) => (p) => p.startsWith(BASE + path);
const isAssets = under("assets/");
const isData   = under("data/");
const isPresets= under("presets/");
const isModules= under("modules/");

function isShellPath(pathname){
  // match any of the shell entries relative to BASE
  for (const u of PRECACHE_URLS){
    const rel = u.replace("./","/");
    if (pathname === (BASE.endsWith('/') ? BASE.slice(0,-1) : BASE) + rel || pathname.endsWith(rel)) return true;
  }
  return false;
}

async function cachePutSafe(cacheName, req, res){
  // Only cache GET, same-origin, and OK responses
  if (req.method !== "GET") return;
  try {
    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return;
    if (!res || !res.ok) return;
    const clone = res.clone(); // clone BEFORE putting
    const cache = await caches.open(cacheName);
    await cache.put(req, clone);
  } catch (e) {
    // swallow quota/opaque/stream errors
  }
}

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
  if (req.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const net = await fetch(req);
        cachePutSafe(CACHE_NAME, req, net);
        return net;
      } catch (_) {
        return (await caches.match("./index.html")) ||
               (await caches.match(req)) ||
               new Response("Offline", { status: 503, statusText: "Offline" });
      }
    })());
    return;
  }

  // B) HTML accepts or presets JSON → network-first
  const acceptsHTML = req.headers.get('accept')?.includes('text/html');
  if (acceptsHTML || isPresets(path)) {
    event.respondWith((async () => {
      try {
        const net = await fetch(req);
        cachePutSafe(CACHE_NAME, req, net);
        return net;
      } catch (_) {
        return caches.match(req);
      }
    })());
    return;
  }

  // C) App shell files (precache list) → cache-first
  if (isShellPath(path)) {
    event.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        cachePutSafe(CACHE_NAME, req, res);
        return res;
      }).catch(() => caches.match(req)))
    );
    return;
  }

  // D) JSON and heavy data (assets/, data/, modules/) → stale-while-revalidate
  if (isAssets(path) || isData(path) || isModules(path)) {
    event.respondWith(
      caches.match(req).then(cached => {
        const netPromise = fetch(req).then(res => {
          cachePutSafe(CACHE_NAME, req, res);
          return res;
        }).catch(() => cached || Promise.reject("offline"));
        return cached || netPromise;
      })
    );
    return;
  }

  // E) Default → network-first with cache fallback
  event.respondWith(
    fetch(req).then(res => {
      cachePutSafe(CACHE_NAME, req, res);
      return res;
    }).catch(() => caches.match(req))
  );
});
