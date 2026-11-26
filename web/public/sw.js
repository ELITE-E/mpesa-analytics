// The app's service worker, written by hand (CP10a item 4). It lets the app open and read a
// statement with no network, and does nothing else:
//
// - It knows one list of files: /sw-allow-list.js, written by the build from the checksum
//   manifests (the app shell, the runtime and the wheel). It caches those files and no others.
// - When it installs, it fetches every listed file with its SHA-256 integrity hash, so a changed
//   or damaged file is refused, and keeps them in one cache named after the list's version.
// - Files whose names carry a hash (/_next/static, /runtime/<version>) come from the cache first.
//   Pages and the other listed files come from the network first, then from the cache offline.
// - A HEAD for a listed file (Next's link prefetch) is answered from the cache: headers, no body.
// - Anything else (any other URL, any other method, any other site) it leaves alone: the browser
//   fetches it as if there were no service worker, and nothing is cached.
// - It never reads a request's body, and statements never pass through it: the PDF is read in the
//   page's memory, never fetched.
// - A new version installs beside the old one and waits. It takes over only when the person
//   accepts the update prompt, which sends SKIP_WAITING.

importScripts("/sw-allow-list.js");

const LIST = self.SW_ALLOW_LIST;
const CACHE_PREFIX = LIST.cachePrefix; // The app's name (src/content/brand.ts), via the allow-list.
const CACHE_NAME = CACHE_PREFIX + LIST.version;
const ENTRIES = new Map(LIST.entries.map((entry) => [entry.path, entry]));

self.addEventListener("install", (event) => {
  event.waitUntil(precache());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(removeOldCaches().then(() => self.clients.claim()));
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const entry = listedEntry(event.request);
  if (!entry) return;
  if (event.request.method === "HEAD") event.respondWith(headersFromCache(entry));
  else event.respondWith(entry.kind === "hashed" ? cacheFirst(entry) : networkFirst(entry));
});

/**
 * Fetch and keep every listed file. If any one fails, the install fails and the cache is dropped,
 * so a half-filled cache is never used.
 */
async function precache() {
  const cache = await caches.open(CACHE_NAME);
  try {
    for (const entry of ENTRIES.values()) {
      await cache.put(entry.path, await fetchListed(entry));
    }
  } catch (error) {
    await caches.delete(CACHE_NAME);
    throw error;
  }
}

/** Delete this app's older caches, under its name or its earlier one; other caches are not ours. */
async function removeOldCaches() {
  const names = await caches.keys();
  const prefixes = [CACHE_PREFIX, "mpesa-analytics-"];
  const old = names.filter(
    (name) => name !== CACHE_NAME && prefixes.some((prefix) => name.startsWith(prefix)),
  );
  await Promise.all(old.map((name) => caches.delete(name)));
}

/**
 * The allow-list entry a request is for, or null to leave the request alone. Only same-origin
 * GETs and HEADs are considered; a page's query string (?import=3, ?_rsc=...) does not change the file.
 * @param {Request} request The request.
 * @returns {object|null} Its entry, or null.
 */
function listedEntry(request) {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return null;
  return ENTRIES.get(url.pathname) || null;
}

/**
 * A HEAD answered from the cache: the cached file's status and headers, no body, no network.
 * @param {object} entry Its allow-list entry.
 * @returns {Promise<Response>} The answer.
 */
async function headersFromCache(entry) {
  const cached = await (await caches.open(CACHE_NAME)).match(entry.path);
  return new Response(
    null,
    cached ? { status: cached.status, headers: cached.headers } : { status: 504 },
  );
}

/**
 * A hashed file: from the cache, else fetched (with its integrity) and kept.
 * @param {object} entry Its allow-list entry.
 * @returns {Promise<Response>} The file.
 */
async function cacheFirst(entry) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(entry.path);
  if (cached) return cached;
  const response = await fetchListed(entry);
  await cache.put(entry.path, response.clone());
  return response;
}

/**
 * A page or another listed file: from the network (with its integrity, so only this version's
 * file is accepted), else from the cache. A fetched copy refreshes the cached one.
 * @param {object} entry Its allow-list entry.
 * @returns {Promise<Response>} The file.
 */
async function networkFirst(entry) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetchListed(entry);
    await cache.put(entry.path, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(entry.path);
    if (cached) return cached;
    throw error;
  }
}

/**
 * The worker's only network call: one listed file, by its listed path, checked against its
 * integrity hash. Nothing else is ever fetched.
 * @param {object} entry Its allow-list entry.
 * @returns {Promise<Response>} The file.
 */
async function fetchListed(entry) {
  const response = await fetch(entry.path, { integrity: entry.integrity, cache: "no-cache" });
  if (!response.ok) throw new Error("listed file could not be fetched");
  return response;
}
