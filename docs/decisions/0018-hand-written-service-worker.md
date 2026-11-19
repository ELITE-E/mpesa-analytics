# 0018. A hand-written service worker that caches only the build's allow-list

Status: Accepted (owner instruction, CP10a)
Date: 2026-11-18

## Context

The architecture planned a static PWA whose service worker precaches the shell, runtime and wheel
by hash and never touches statement data (migration plan, section 6). Until CP10a the app had no
service worker, so it needed the network on every visit. A PWA plugin or generator would write a
worker we cannot read line by line, and would cache by its own rules.

## Decision

- **Hand-written.** `web/public/sw.js`, about 130 lines, commented in plain words. No plugin, no
  generator, no library.
- **One allow-list.** The build (`web/scripts/sw_allow_list.mjs`, from `postbuild.mjs`) writes
  `out/sw-allow-list.js`: every shipped file by the path it is served at, with its SHA-256
  integrity. The app shell's hashes are taken from the built files; the runtime's and the wheel's
  come from the runtime's own checksum manifest, and the build stops if a file does not match it.
  The host's `_headers`, the 404 page and the worker's own two files are not listed. The list's
  version is a digest of the whole list.
- **Precache only the list.** On install the worker fetches every listed file with its integrity
  hash into one cache named after the version; a failed or changed file fails the install.
- **Serving.** Hashed files (`/_next/static/`, `/runtime/<version>/`) come from the cache first.
  Pages and the other listed files come from the network first (with their integrity, so only this
  version's file is accepted) and from the cache offline. A HEAD for a listed file (Next's link
  prefetch) is answered from the cache, headers only.
- **Nothing else.** Any other URL, any other method, any other origin is left to the browser and
  never cached. The worker never reads a request body; statements never pass through it (the PDF
  is read from memory). Its only `fetch` call is for a listed path.
- **Updates wait for the person.** A new version installs and waits; the page shows "A new version
  of the app is ready" with "Reload to update" and "Later". Only acceptance sends `SKIP_WAITING`.
- **CSP unchanged.** The worker and its list are same-origin scripts served with the architecture
  CSP; no inline script.
- **Web manifest and generic icons.** `public/manifest.webmanifest`, `icon.svg`, `icon-maskable.svg`.

## Alternatives considered

| Option | Tradeoff |
|---|---|
| No service worker | Simplest; the app needs the network every visit |
| A PWA plugin (next-pwa, Workbox) | Less code to write; rules and caching we did not write, and a dependency in the download |
| Runtime caching of whatever the app fetches | Fewer moving parts; could cache something we never meant to keep |

## Consequences

- After a first full load the app opens and reads a statement with no network.
- A first visit also downloads every allow-listed file once in the background, the whole runtime
  included (about 22 MB raw), so the app works offline afterwards. Measured: 15.16 MB gzip with
  pandas (14.67 MB before the worker), 7.86 MB without. **Owner decision (2026-11-19):** the
  with-pandas budget rises from 15 MB to 15.5 MB gzip (`tools/measure_bundle.py`); the 8 MB
  budget without pandas is unchanged. Dropping pandas (`docs/ROADMAP.md`) would bring it far below.
- Every build is a new version; the person decides when to take it.

## Enforcement

- `web/tests/service-worker.test.mjs`: the worker in a sandbox (precache only the list with
  integrity, cache-first and network-first, HEAD, nothing else touched, update waits, one fetch call);
  the allow-list builder; the manifest; the update prompt and registration.
- `web/tests/pwa-chrome.test.mjs`: real Chrome: offline read of a synthetic statement with no
  network response; Cache Storage holds only allow-listed paths and no statement data.
- `web/tests/vault-chrome.test.mjs` (N-35): one place registers one worker, `/sw.js`.
