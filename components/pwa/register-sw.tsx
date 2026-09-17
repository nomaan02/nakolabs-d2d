"use client";

import { useEffect } from "react";

const STATIC_PREFIX = "/_next/static/";
const WARM_DEBOUNCE_MS = 1_500;

/**
 * All four tab routes. Navigation between them is client-side, so the worker
 * would otherwise never see three of the four documents and a cold open on,
 * say, /field/logger in airplane mode would hit the offline page.
 */
const FIELD_ROUTES = ["/field", "/field/logger", "/field/leads", "/field/profile"];

/**
 * Registers the app-shell worker at /sw.js and keeps it warm.
 *
 * Production only: Turbopack's HMR and a service worker do not mix, and the
 * field layout is the only place this mounts — admin and office users never
 * register a worker. Registration waits for `load` so it never competes with
 * the first paint or with SyncProvider's mount flush; the worker itself has
 * no say in when or how the outbox flushes.
 *
 * Hashed chunk names cannot be precached from a static sw.js, so after load
 * the page posts every same-origin /_next/static/ URL it actually used (and
 * its own path, so the HTML is cached on the very first visit) and the
 * worker stores them. A PerformanceObserver keeps posting as late chunks and
 * font files arrive.
 */
export function RegisterServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    // On the first ever visit no worker controls the page, so the navigation
    // that produced this document was never seen by the fetch handler. Only
    // then does the document itself need warming; afterwards the handler
    // caches it on every online navigation.
    const wasControlled = navigator.serviceWorker.controller !== null;

    let disposed = false;
    let observer: PerformanceObserver | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const posted = new Set<string>();
    const pendingUrls = new Set<string>();

    const collectLoaded = (): string[] => {
      const urls = new Set<string>();
      for (const script of Array.from(document.scripts)) {
        if (script.src) urls.add(script.src);
      }
      for (const link of Array.from(document.querySelectorAll<HTMLLinkElement>("link[href]"))) {
        urls.add(link.href);
      }
      for (const entry of performance.getEntriesByType("resource")) {
        urls.add(entry.name);
      }
      return Array.from(urls);
    };

    const isStatic = (raw: string): boolean => {
      try {
        const url = new URL(raw, location.origin);
        return url.origin === location.origin && url.pathname.startsWith(STATIC_PREFIX);
      } catch {
        return false;
      }
    };

    const post = async (urls: string[]) => {
      const fresh = urls.filter((url) => !posted.has(url));
      if (fresh.length === 0) return;
      const registration = await navigator.serviceWorker.ready;
      if (disposed) return;
      const worker = registration.active;
      if (!worker) return;
      for (const url of fresh) posted.add(url);
      worker.postMessage({ type: "WARM", urls: fresh });
    };

    const queue = (urls: string[]) => {
      for (const url of urls) pendingUrls.add(url);
      if (timer !== null) return;
      timer = setTimeout(() => {
        timer = null;
        const batch = Array.from(pendingUrls);
        pendingUrls.clear();
        void post(batch).catch(() => undefined);
      }, WARM_DEBOUNCE_MS);
    };

    const start = async () => {
      try {
        await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
          updateViaCache: "none",
        });
      } catch {
        // No worker, no offline shell. The page works exactly as before.
        return;
      }
      if (disposed) return;

      const initial = collectLoaded().filter(isStatic);
      // The documents themselves, so one online visit is enough to cold-open
      // any tab offline. `warm()` refuses anything that redirects, so a
      // signed-out user caches nothing.
      if (!wasControlled) initial.push(location.pathname);
      queue(initial.concat(FIELD_ROUTES));

      if (typeof PerformanceObserver !== "undefined") {
        observer = new PerformanceObserver((list) => {
          const late = list
            .getEntries()
            .map((entry) => entry.name)
            .filter(isStatic);
          if (late.length > 0) queue(late);
        });
        try {
          observer.observe({ type: "resource", buffered: true });
        } catch {
          observer = null;
        }
      }
    };

    const onLoad = () => void start();
    if (document.readyState === "complete") onLoad();
    else window.addEventListener("load", onLoad, { once: true });

    return () => {
      disposed = true;
      window.removeEventListener("load", onLoad);
      observer?.disconnect();
      if (timer !== null) clearTimeout(timer);
    };
  }, []);

  return null;
}
