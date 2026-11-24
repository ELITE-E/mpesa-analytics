# 0015. The web app is a static export, served with the architecture CSP plus per-page script hashes

Status: Accepted (CP8b, owner instruction; measured in Chrome). Its per-page CSP rules are superseded by ADR 0019 (CP10b): one site-wide hash set.
Date: 2026-11-17

## Context

CP8b moved the prototype frontend onto the local engine: no server, no login, no API. The prototype ran on a Next.js server, whose `proxy.ts` gave every response a fresh nonce for its inline scripts. A static export has no server to make a nonce, but Next still writes inline scripts into every page (its flight data, `self.__next_f.push(…)`). The architecture CSP (ADR 0013) has `script-src 'self' 'wasm-unsafe-eval'` and `style-src 'self'`, and CP8b item 1 forbids `'unsafe-inline'` and `'unsafe-eval'` in `script-src`.

## Decision

- `next.config.ts` builds with `output: "export"` and `trailingSlash: false`, so each route is a page file (`ledger.html` at `/ledger`) and the app keeps the prototype's own URLs (`/ledger?scope=…`). It was `true` (a folder per route) until the prototype's browser tests ran on the export: their URL expectations are the prototype's, and keeping them avoided editing those tests. Static hosts serve page files at clean URLs (Netlify, Cloudflare Pages and GitHub Pages do so by default; nginx needs `try_files $uri $uri.html`). `proxy.ts`, `next/server` in the layout and `headers()` are gone.
- `web/scripts/postbuild.mjs` runs after `next build`. It copies the engine (`pdf_reader/`) into `out/` and removes dev-only vendored files. For each page, it takes a SHA-256 hash of every inline script and writes that page's policy to `out/_headers`: the architecture CSP with those hashes added to `script-src`, and nothing else changed. Other paths (`/_next/*`, `/runtime/*`, `/pdf_reader/*`) get the plain architecture CSP.
- `style-src 'self'` holds unchanged. The five live `style=` widths became classes (`lib/bar-width.ts`), and the icon font became inline SVG paths (`scripts/build_icons.mjs`). No relaxation was needed or applied.
- `web/scripts/serve_static.mjs` serves `out/` with those headers for the tests and for trying the app by hand.
- A static page cannot read its query on the server, so every page shows the session's latest statement (`importId = null`). Choosing another statement comes with ledger switching (CP9).

## Alternatives considered

| Option | Tradeoff |
|---|---|
| Static export with per-page hashes (chosen) | No server; `script-src` stays strict; a page's hashes change whenever its inline scripts do, so `_headers` must come from the same build |
| `'unsafe-inline'` in `script-src` | Simple, but forbidden by CP8b item 1, and it defeats the CSP |
| Keep a Next.js server for nonces | Brings back a server that the app no longer needs, and a host to run it on |
| `strict-dynamic` with one hash | Fewer hashes, but every script it loads becomes trusted; not needed |

## Consequences

- The host must serve `out/_headers` (the Netlify and Cloudflare Pages format) or set the same per-path policies. A host that ignores the file would serve no CSP at all.
- Next's client router prefetches each visible link. In a static export it first sends a same-origin `HEAD` to the page, then GETs its data file. **Owner decision (2026-11-17): allowed.** The request rule (`tools/browser/request_rule.js`) is: a GET to the app's origin, or a HEAD to one of the app's own pages, never with a body. A HEAD carries no data, and the GET after it names the same page, so it tells the host nothing new. Anything else, POST or another origin included, still fails.
- The bundle counts the app too: the files a recorded first visit downloads (`tools/measure_app_download.mjs`, then `tools/measure_bundle.py --app web/out --fetched`).

## Enforcement

`web/tests/static-export-csp.test.mjs`: every route is exported; no server code is left; each route's CSP equals the architecture CSP apart from its script hashes, and never holds `'unsafe-inline'` or `'unsafe-eval'`; every inline script is covered by a hash, and a planted one is caught; every route loads in Chrome with 0 violations and 0 foreign requests. `web/tests/e2e-local.test.mjs`: a full import through the real UI, with every route, has 0 CSP violations.
