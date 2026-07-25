const SHELL_CACHE = "azcc-shell-v2";
const PRECACHE_URLS = [
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];
const PUBLIC_ICON_PATHS = new Set([
  "/icons/icon-192.png",
  "/icons/icon-512.png",
]);

async function precachePublicAssets() {
  const cache = await caches.open(SHELL_CACHE);
  for (const path of PRECACHE_URLS) {
    const response = await fetch(path, { cache: "reload" });
    const request = { url: new URL(path, self.location.origin).href };
    if (isCacheableStaticResponse(request, response)) {
      await cache.put(path, response.clone());
    }
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    precachePublicAssets().then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter(
              (name) => name.startsWith("azcc-shell-") && name !== SHELL_CACHE,
            )
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function isPublicStaticAsset(request) {
  if (request.method !== "GET") return false;
  if (request.mode === "navigate" || request.destination === "document") {
    return false;
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/sign-in")
  ) {
    return false;
  }

  return (
    url.pathname.startsWith("/_next/static/") ||
    PUBLIC_ICON_PATHS.has(url.pathname) ||
    url.pathname === "/manifest.webmanifest"
  );
}

function isCacheableStaticResponse(request, response) {
  if (!response.ok) return false;
  if (response.type !== "basic" && response.type !== "default") return false;

  const contentType = response.headers.get("content-type")?.toLowerCase();
  if (!contentType) return false;

  const pathname = new URL(request.url).pathname;
  if (PUBLIC_ICON_PATHS.has(pathname)) {
    return contentType.startsWith("image/png");
  }
  if (pathname === "/manifest.webmanifest") {
    return (
      contentType.startsWith("application/manifest+json") ||
      contentType.startsWith("application/json")
    );
  }

  return [
    "application/javascript",
    "application/json",
    "application/wasm",
    "font/",
    "image/",
    "text/css",
    "text/javascript",
  ].some((allowedType) => contentType.startsWith(allowedType));
}

self.addEventListener("fetch", (event) => {
  if (!isPublicStaticAsset(event.request)) return;

  event.respondWith(
    caches.match(event.request).then(async (cached) => {
      if (cached) return cached;

      const response = await fetch(event.request);
      if (isCacheableStaticResponse(event.request, response)) {
        const cache = await caches.open(SHELL_CACHE);
        await cache.put(event.request, response.clone());
      }
      return response;
    }),
  );
});
