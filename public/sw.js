/* global self, caches */
/*
 * App-shell service worker. Scope "/", registered only from the field layout
 * in production (components/pwa/register-sw.tsx).
 *
 * This worker caches the SHELL and nothing else:
 *   - hashed Next.js assets under /_next/static/ (cache-first, immutable)
 *   - MapLibre's worker chunks under /maplibre/ (stale-while-revalidate)
 *   - the /field HTML document (network-first, 3 s, then the cached copy)
 *   - the manifest, icons and /offline.html (precached on install)
 *
 * It never touches data. Dexie owns the assignment snapshot and the outbox
 * (lib/field/db.ts, lib/sync/queue.ts). Every cross-origin request — Supabase
 * REST/Auth/Realtime, MapTiler — and every non-GET, every ?_rsc= payload and
 * every route outside /field passes through untouched: the fetch listener
 * returns without respondWith, so the browser does its normal network fetch.
 * There is no "sync" or "periodicsync" handler and no IndexedDB access here,
 * because the flush lives in lib/sync/queue.ts and there is exactly one of it.
 */

const SW_VERSION = "1";
// Set when this worker instance boots. A cold open shows a fresh value.
const STARTED_AT = Date.now();
const SHELL_CACHE = `d2d-shell-v${SW_VERSION}`;
const STATIC_CACHE = "d2d-static";

const HTML_NETWORK_TIMEOUT_MS = 3_000;
const STATIC_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1_000;

const OFFLINE_URL = "/offline.html";

// Stable, unhashed URLs. Hashed chunks cannot be listed here — their names
// change every build — so they are warmed by the page after load instead.
const PRECACHE = [
  OFFLINE_URL,
  "/manifest.webmanifest",
  "/maplibre/maplibre-gl-worker.mjs",
  "/maplibre/maplibre-gl-shared.mjs",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
];

// Install fails only if the offline fallback itself cannot be fetched.
const PRECACHE_REQUIRED = new Set([OFFLINE_URL]);

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      await Promise.all(
        PRECACHE.map(async (url) => {
          try {
            const response = await fetch(url, { cache: "reload" });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            await cache.put(url, response);
          } catch (error) {
            if (PRECACHE_REQUIRED.has(url)) throw error;
          }
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith("d2d-shell-v") && name !== SHELL_CACHE)
          .map((name) => caches.delete(name)),
      );
      await pruneStatic();
      await self.clients.claim();
    })(),
  );
});

// The page posts the /_next/static/ URLs it actually loaded, plus its own
// path, so a single online visit leaves a complete shell behind.
self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data) return;
  if (data.type === "PING" && event.source) {
    event.source.postMessage({ type: "PONG", version: SW_VERSION, startedAt: STARTED_AT });
    return;
  }
  if (data.type !== "WARM" || !Array.isArray(data.urls)) return;
  event.waitUntil(warm(data.urls));
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  if (url.pathname.startsWith("/maplibre/")) {
    event.respondWith(staleWhileRevalidate(request, SHELL_CACHE));
    return;
  }

  if (isPrecached(url.pathname)) {
    event.respondWith(cacheFirst(request, SHELL_CACHE));
    return;
  }

  if (request.mode === "navigate" && isFieldPath(url.pathname)) {
    event.respondWith(fieldDocument(event, request, url));
    return;
  }

  // Everything else: no respondWith. Straight to the network, untouched.
});

// ---------------------------------------------------------------------------

function isFieldPath(pathname) {
  return pathname === "/field" || pathname.startsWith("/field/");
}

function isPrecached(pathname) {
  return PRECACHE.includes(pathname);
}

function isCacheableDocument(response, url) {
  if (!response || !response.ok || response.redirected || response.type !== "basic") return false;
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) return false;
  return isFieldPath(new URL(response.url || url.href).pathname);
}

function documentKey(url) {
  // One copy per path. The query string never changes what the shell is.
  return url.origin + url.pathname;
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Network-first with a short timeout, then the cached document, then the
 * offline page. Cache-first on HTML would skip middleware's cookie refresh,
 * keep serving a stale build after every deploy, and hand a signed-out user
 * the shell instead of /login; offline behaviour is identical either way.
 */
async function fieldDocument(event, request, url) {
  const cache = await caches.open(SHELL_CACHE);
  const key = documentKey(url);

  // Let the network fetch keep running past the timeout so a slow-but-alive
  // connection still refreshes the cached copy for next time.
  const network = fetch(request).then((response) => {
    if (isCacheableDocument(response, url)) {
      const store = cache.put(key, response.clone()).catch(() => undefined);
      try {
        event.waitUntil(store);
      } catch {
        // The event has already settled (cached copy was served after the
        // timeout). The put still runs; it just cannot extend the worker.
      }
    }
    return response;
  });
  // A rejected network promise we did not await must not surface as unhandled.
  network.catch(() => undefined);

  try {
    return await withTimeout(network, HTML_NETWORK_TIMEOUT_MS);
  } catch {
    const cached = await cache.match(key);
    if (cached) return cached;
  }

  // Nothing cached for this path. If the network is merely slow, wait for it
  // rather than showing the offline page to someone with signal.
  try {
    return await network;
  } catch {
    const offline = await cache.match(OFFLINE_URL);
    if (offline) return offline;
    return new Response("Open the app once with signal to prepare it for offline use.", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok && response.type === "basic") {
    await cache.put(request, response.clone());
  }
  return response;
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then(async (response) => {
      if (response.ok && response.type === "basic") {
        await cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => undefined);
  if (cached) return cached;
  const fresh = await network;
  if (fresh) return fresh;
  return new Response("", { status: 504 });
}

async function warm(urls) {
  const cache = await caches.open(STATIC_CACHE);
  const shell = await caches.open(SHELL_CACHE);
  const origin = self.location.origin;

  await Promise.all(
    urls.map(async (raw) => {
      let url;
      try {
        url = new URL(raw, origin);
      } catch {
        return;
      }
      if (url.origin !== origin) return;

      if (url.pathname.startsWith("/_next/static/")) {
        if (await cache.match(url.href)) return;
        try {
          const response = await fetch(url.href);
          if (response.ok && response.type === "basic") await cache.put(url.href, response);
        } catch {
          // Warm-up is best effort; the runtime cache-first handler catches up.
        }
        return;
      }

      if (isFieldPath(url.pathname)) {
        // Fetching the document from here sends the page's cookies (same
        // origin), so middleware sees the session and answers with the real
        // shell rather than a redirect. Redirects are refused by
        // isCacheableDocument.
        try {
          const response = await fetch(url.origin + url.pathname, {
            credentials: "same-origin",
            cache: "no-store",
          });
          if (isCacheableDocument(response, url)) await shell.put(documentKey(url), response);
        } catch {
          // Best effort, as above.
        }
      }
    }),
  );
}

/** Drop hashed assets older than a fortnight so a deploy stream cannot grow storage forever. */
async function pruneStatic() {
  const cache = await caches.open(STATIC_CACHE);
  const requests = await cache.keys();
  const cutoff = Date.now() - STATIC_MAX_AGE_MS;
  await Promise.all(
    requests.map(async (request) => {
      const response = await cache.match(request);
      const date = response && response.headers.get("date");
      const stamp = date ? Date.parse(date) : NaN;
      if (!Number.isNaN(stamp) && stamp < cutoff) await cache.delete(request);
    }),
  );
}
