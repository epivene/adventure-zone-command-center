// Store only explicitly prepared, public production build files. Private
// workspace records belong to the separately owner-scoped IndexedDB store.
const SCOPE = new URL(self.registration.scope);
const CACHE_PREFIX = `adventure-zone-offline-shell-v2:${SCOPE.pathname}:`;
const STATE_CACHE = `${CACHE_PREFIX}state`;
const STATE_URL = new URL(".offline-shell-state", SCOPE).href;
const MANIFEST_URL = new URL("offline-shell-manifest.json", SCOPE).href;
const STATIC_EXTENSION = /\.(?:m?js|css|woff2?|ttf|otf|eot|png|jpe?g|svg|gif|webp|avif|ico|wasm)$/i;
let preparation;
const progressListeners = new Set();

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

function withinScope(url) {
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { return false; }
  return url.origin === SCOPE.origin && url.pathname.startsWith(SCOPE.pathname) &&
    !/(?:^|\/)api(?:\/|$)/i.test(pathname);
}

function validateManifest(value) {
  if (!value || typeof value.version !== "string" || !/^[\w-]{1,128}$/.test(value.version) || !Array.isArray(value.assets) ||
      value.assets.length < 2 || value.assets.length > 2000) throw new Error("Invalid offline build manifest.");
  const shell = new URL("index.html", SCOPE).href;
  if (typeof value.shell !== "string" || new URL(value.shell, SCOPE).href !== shell) throw new Error("Invalid offline shell.");
  const integrity = {};
  const assets = value.assets.map((path) => {
    if (typeof path !== "string") throw new Error("Invalid offline asset.");
    const url = new URL(path, SCOPE);
    if (!withinScope(url) || url.search || url.hash || url.username || url.password ||
        (url.href !== shell && !STATIC_EXTENSION.test(url.pathname))) throw new Error("Offline assets must be public same-origin build files.");
    const hash = value.integrity?.[path];
    if (typeof hash !== "string" || !/^[a-f0-9]{64}$/.test(hash)) throw new Error("Missing offline file integrity.");
    integrity[url.href] = hash;
    return url.href;
  });
  if (!assets.includes(shell) || new Set(assets).size !== assets.length) throw new Error("Incomplete offline build manifest.");
  return { version: value.version, shell, assets, integrity };
}

function validResponse(response, url) {
  if (!response || !response.ok || response.type === "opaque" || response.redirected) return false;
  const type = (response.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
  const pathname = new URL(url).pathname;
  if (/\.html$/i.test(pathname)) return type === "text/html";
  if (/\.m?js$/i.test(pathname)) return /^(?:text|application)\/(?:javascript|ecmascript|x-javascript)$/.test(type);
  if (/\.css$/i.test(pathname)) return type === "text/css";
  return type !== "text/html";
}

async function verifyCache(cache, manifest) {
  for (const url of manifest.assets) if (!validResponse(await cache.match(url), url)) return false;
  return true;
}

async function storedShell() {
  if (!await caches.has(STATE_CACHE)) return null;
  const stateResponse = await (await caches.open(STATE_CACHE)).match(STATE_URL);
  if (!stateResponse) return null;
  const state = await stateResponse.json();
  if (typeof state.cacheName !== "string" || !state.cacheName.startsWith(`${CACHE_PREFIX}build:`) || !await caches.has(state.cacheName)) return null;
  const manifest = validateManifest(state.manifest);
  const cache = await caches.open(state.cacheName);
  return { cache, manifest };
}

async function completeShell() {
  const shell = await storedShell();
  return shell && await verifyCache(shell.cache, shell.manifest) ? shell : null;
}

async function prepareShell() {
  const response = await fetch(MANIFEST_URL, { cache: "no-store", credentials: "omit" });
  if (!response.ok || response.redirected) throw new Error("The production offline manifest could not be downloaded.");
  const manifest = validateManifest(await response.json());
  const cacheName = `${CACHE_PREFIX}build:${manifest.version}:${crypto.randomUUID()}`;
  const cache = await caches.open(cacheName);
  let published = false;
  try {
    let completed = 0;
    const progress = () => progressListeners.forEach((notify) => notify({ type: "progress", completed, total: manifest.assets.length }));
    progress();
    for (const url of manifest.assets) {
      // Omit cookies even for HTML: never store a server session response.
      const asset = await fetch(url, { cache: "no-store", credentials: "omit" });
      if (!validResponse(asset, url)) throw new Error("A required offline file was unavailable or had the wrong content type.");
      const digest = await crypto.subtle.digest("SHA-256", await asset.clone().arrayBuffer());
      const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
      if (hash !== manifest.integrity[url]) throw new Error("The application changed during download. Please prepare again.");
      await cache.put(url, asset);
      completed += 1;
      progress();
    }
    if (!await verifyCache(cache, manifest)) throw new Error("Offline storage did not retain every required file.");
    // One metadata write publishes the complete replacement. Partial downloads
    // never replace a previous good shell, including on storage quota failure.
    await (await caches.open(STATE_CACHE)).put(STATE_URL, Response.json({ cacheName, manifest }));
    published = true;
    await Promise.all((await caches.keys()).filter((name) => name.startsWith(`${CACHE_PREFIX}build:`) && name !== cacheName).map((name) => caches.delete(name))).catch(() => undefined);
  } catch (error) {
    if (!published) await caches.delete(cacheName).catch(() => undefined);
    throw error;
  }
}

self.addEventListener("message", (event) => {
  const port = event.ports && event.ports[0];
  if (!port) return;
  const notify = (message) => { try { port.postMessage(message); } catch { /* The requesting tab may have closed. */ } };
  if (event.data?.type === "OFFLINE_SHELL_STATUS") {
    event.waitUntil(completeShell().then((shell) => notify({ type: "ready", ready: Boolean(shell) })).catch(() => notify({ type: "ready", ready: false })));
  } else if (event.data?.type === "PREPARE_OFFLINE_SHELL") {
    progressListeners.add(notify);
    if (!preparation) preparation = prepareShell().finally(() => { preparation = undefined; });
    event.waitUntil(preparation.then(() => notify({ type: "complete" })).catch((error) => notify({ type: "error", error: error?.message || "Offline preparation failed." })).finally(() => progressListeners.delete(notify)));
  }
});

async function navigationResponse(request) {
  try { return await fetch(request); } catch {
    const shell = await completeShell().catch(() => null);
    return shell ? (await shell.cache.match(shell.manifest.shell)) || Response.error() : Response.error();
  }
}

async function assetResponse(request) {
  try {
    const response = await fetch(request);
    if (validResponse(response, request.url)) return response;
  } catch { /* Try only the exact public asset from the prepared shell. */ }
  // Navigation and readiness verify the whole cache. Individual asset loads
  // check their exact entry so loading N chunks does not perform N² reads.
  const shell = await storedShell().catch(() => null);
  if (shell && shell.manifest.assets.includes(request.url)) {
    const cached = await shell.cache.match(request.url);
    if (validResponse(cached, request.url)) return cached;
  }
  return Response.error();
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || !withinScope(url)) return;
  if (request.mode === "navigate") event.respondWith(navigationResponse(request));
  else if (STATIC_EXTENSION.test(url.pathname)) event.respondWith(assetResponse(request));
});
