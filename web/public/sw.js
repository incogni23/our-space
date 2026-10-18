/* Between Us service worker.
 *
 * - Pages: network first, falling back to the last copy, then /offline.html.
 * - App code (/_next/static, hashed): cache first. Skipped on localhost, where
 *   the dev server changes files without changing names.
 * - Your data (GET /api/v1/...): network first, last copy when offline. Never the
 *   live stream, exports, downloads or public links. Cleared on sign-out.
 * - Photo thumbnails: cache first (immutable per id).
 * - Web Push: shows the notification; tapping it opens the right screen.
 */
const VERSION = "bu-v1";
const PAGES = `${VERSION}-pages`;
const STATIC = `${VERSION}-static`;
const DATA = `${VERSION}-data`;
const DEV = self.location.hostname === "localhost" || self.location.hostname === "127.0.0.1";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(PAGES).then((c) => c.addAll(["/offline.html"])).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function noStoreApi(path) {
  return (
    path === "/api/v1/live" ||
    path === "/api/v1/export" ||
    path.startsWith("/api/v1/public/") ||
    path.startsWith("/api/v1/auth/") ||
    path.endsWith("/download") ||
    /^\/api\/v1\/media\/[^/]+\/full$/.test(path)
  );
}

async function networkFirst(request, cacheName, fallback) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(request);
    if (hit) return hit;
    if (fallback) return (await caches.match(fallback)) || Response.error();
    throw err;
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    if (url.pathname.startsWith("/p/")) return; // public links: never cached
    event.respondWith(networkFirst(request, PAGES, "/offline.html"));
    return;
  }
  if (url.pathname.startsWith("/_next/static/")) {
    if (!DEV) event.respondWith(cacheFirst(request, STATIC));
    return;
  }
  if (/^\/api\/v1\/media\/[^/]+\/thumb$/.test(url.pathname)) {
    event.respondWith(cacheFirst(request, DATA));
    return;
  }
  if (url.pathname.startsWith("/api/v1/") && !noStoreApi(url.pathname)) {
    event.respondWith(networkFirst(request, DATA));
  }
});

self.addEventListener("message", (event) => {
  if (event.data === "clear") {
    // Sign-out: forget everything this device kept.
    event.waitUntil(caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))));
  }
});

self.addEventListener("push", (event) => {
  let data = { title: "Between Us", body: "", url: "/home", tag: undefined };
  try {
    data = { ...data, ...event.data.json() };
  } catch {}
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      tag: data.tag,
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-96.png",
      data: { url: data.url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/home", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ("focus" in c) {
          c.navigate(target);
          return c.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
