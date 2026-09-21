/* Service worker del panel LedBox (issue #23). Sin dependencias.
 *
 * Estrategia:
 * - Navegación (el shell del panel): red primero. Si no hay red, sirve la última
 *   copia cacheada de esa misma URL; si nunca se visitó, la página offline
 *   honesta (`/offline.html`). Nunca reemplaza datos frescos cuando hay red.
 * - Estáticos con hash de Next (`/_next/static/*`), assets, iconos y el manifest:
 *   cache primero con revalidación en segundo plano (esos archivos no cambian).
 * - `/api/*`: jamás se cachea. Sin conexión, el panel muestra el error real y la
 *   acción de campo se guarda en la cola local (IndexedDB), no acá.
 */

const VERSION = "ledbox-pwa-v1";
const STATIC_CACHE = `${VERSION}-static`;
const PAGE_CACHE = `${VERSION}-pages`;
const PAGE_LIMIT = 8;

const PRECACHE = [
  "/offline.html",
  "/icon.svg",
  "/manifest-panel.webmanifest",
  "/assets/icon-192.png",
  "/assets/icon-512.png",
  "/assets/apple-touch-icon.png",
  "/assets/favicon-32.png",
];

const STATIC_PREFIXES = ["/_next/static/", "/assets/"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      await Promise.allSettled(PRECACHE.map((url) => cache.add(new Request(url, { cache: "reload" }))));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => !key.startsWith(VERSION)).map((key) => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});

function isStaticAsset(pathname) {
  return STATIC_PREFIXES.some((prefix) => pathname.startsWith(prefix)) || pathname === "/icon.svg" || pathname.endsWith(".webmanifest");
}

async function trimPageCache(cache) {
  const keys = await cache.keys();
  const excess = keys.length - PAGE_LIMIT;
  if (excess <= 0) return;
  await Promise.all(keys.slice(0, excess).map((key) => cache.delete(key)));
}

async function navigateFromNetwork(request) {
  const cache = await caches.open(PAGE_CACHE);
  try {
    const response = await fetch(request);
    if (response && response.ok && response.type === "basic" && response.status === 200) {
      await cache.put(request, response.clone());
      await trimPageCache(cache);
    }
    return response;
  } catch {
    const cached = (await cache.match(request)) || (await cache.match(new URL(request.url).pathname));
    if (cached) return cached;
    const offline = await caches.match("/offline.html");
    if (offline) return offline;
    return Response.error();
  }
}

async function staleWhileRevalidate(event, request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  const revalidate = fetch(request)
    .then((response) => {
      if (response && response.ok && response.type === "basic") return cache.put(request, response.clone()).then(() => response);
      return response;
    })
    .catch(() => null);
  if (cached) {
    event.waitUntil(revalidate);
    return cached;
  }
  const response = await revalidate;
  return response || Response.error();
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Datos del panel: siempre frescos. Sin conexión falla el fetch y el panel lo dice.
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(navigateFromNetwork(request));
    return;
  }

  // Navegación RSC de Next: red o error honesto (el router cae a navegación dura,
  // que sí puede servirse del cache de páginas).
  if (request.headers.get("RSC") === "1" || url.searchParams.has("_rsc")) return;

  if (isStaticAsset(url.pathname)) {
    event.respondWith(staleWhileRevalidate(event, request));
  }
});
