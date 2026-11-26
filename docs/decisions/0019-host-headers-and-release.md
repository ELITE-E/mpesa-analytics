# 0019. Host headers: one hash-based CSP on every response, Cache-Control per path; deploys from tags only

Status: Proposed (CP10b). The host is the owner's choice: Cloudflare Pages or Netlify.
Date: 2026-11-23

## Context

CP10b item 1 asks for host headers generated from the build, for Cloudflare Pages and Netlify,
with a hash-based CSP, nosniff, no referrer, a Permissions-Policy denying camera, microphone and
geolocation, COOP same-origin, immutable caching for hashed files and no-cache for HTML; item 8
adds noindex for the private beta. Both hosts read a `_headers` file. Both apply every rule whose
path matches a request, and a header set by two matching rules is joined into one value. ADR 0015
gave each page its own CSP in its own rule, beside asset rules: under that joining, any catch-all
rule carrying a CSP would add a second policy to every page, and unknown addresses (the 404 page)
had no rule at all.

## Decision

- `web/scripts/host_headers.mjs` writes `_headers` for a host. `postbuild.mjs` writes it into
  `web/out` for `DEPLOY_HOST`, or in Netlify's form when unset (it has no host-only lines, and the
  local test server reads it).
- **One CSP for the whole site**, in the `/*` rule: the architecture CSP plus one SHA-256 hash for
  every distinct inline script in every page (19 today, 1,287 characters on the longest line).
  This supersedes ADR 0015's per-page policies. A page may now run another page's inline script,
  but only those exact bytes from this build; nothing else changes, and `'unsafe-inline'` and
  `'unsafe-eval'` never appear. The 404 page is covered too.
- The other shared headers sit in `/*` as well. **Every other rule sets Cache-Control only**:
  `public, max-age=31536000, immutable` under `/_next/*` and `/runtime/<version>/*`, `no-cache`
  for pages and every other file. A folder gets one `/folder/*` rule when everything below it has
  the same value. So no header is ever set by two matching rules (`web/tests/host-headers.test.mjs`
  resolves every route, every file and unknown paths the way the hosts do).
- Host differences: for Cloudflare Pages, `/*` detaches Pages' default
  `Access-Control-Allow-Origin`, and the generator refuses more than 100 rules or a line over 2,000
  characters (Pages' limits). Netlify does not read the `!` syntax, so its file has none.
- `public/.gitkeep` no longer ships: a host may refuse a dotfile, and the service worker would
  then fail to precache it.
- `web/scripts/serve_static.mjs` now sends the generated headers, resolved the same way, except
  Cache-Control, which stays `no-store` so a test never runs a file cached from an older build.
- **Deploys only from a version tag** (`.github/workflows/release.yml`): it runs `ci.yml`, checks
  that the tag matches the version and that the public name is chosen (`check_naming.py`), builds
  for `DEPLOY_HOST`, deploys, and drafts a GitHub release whose notes hold the SHA-256 of
  `sha256sums.txt` (every file of the export), attached.
- `tools/release/check_deployed.mjs` checks the deployed site: the expected headers (the CSP
  recomputed from the deployed pages), every allow-listed file's integrity, the runtime against its
  manifest, no third-party host in any header, redirect or text body (scripts are covered by the
  checksums: the bundles hold inert documentation links), no sitemap, and an active service
  worker in Chrome. It is the only tool in the repo that makes network requests.

## Host reporting exception

Added after the first `check_deployed` run against Cloudflare Pages (2026-11-24).

Cloudflare adds two headers to every response, `Report-To` and `NEL` (Network Error Logging).
They ask the browser to send Cloudflare a short report if the site cannot be reached: the address
that failed and the type of error (for example a DNS or connection failure). The report is sent by
the browser itself, not by the app, and it never holds anything from a statement: the app has not
run when the site cannot be reached, and statements never leave the device anyway. `NEL` here sets
`success_fraction` to 0, so successful loads are not reported.

`check_deployed` used to fail `no_third_party` on these headers, because `Report-To` names
Cloudflare's reporting endpoint. The check is not silenced. It allows exactly this:

- only the headers `Report-To` and `NEL`;
- only the host `a.nel.cloudflare.com`, matched exactly (`HOST_REPORTING_DOMAIN` in
  `tools/release/check_deployed.mjs`; a look-alike such as `a.nel.cloudflare.com.example.net` or
  another subdomain fails);
- and when they are present it prints `NOTE host reporting header present (documented)` on its
  own line after `no_third_party`, so the exception is visible on every run.

Any other third-party host still fails, wherever it appears: in a header, redirect, page,
stylesheet, script or runtime file, and in those two headers too. That reporting domain in any
other header also fails.
The check now also reads JSON-escaped URLs (`https:\/\/host`), the form these headers use, so a
host written that way can no longer slip past it.

The same run found `/robots.txt` answered by the host with no Cache-Control from `_headers`: the
build ships no robots.txt, so no rule matched it. The generator now writes a `no-cache` rule for
it (`HOST_ANSWERED_PATHS` in `web/scripts/host_headers.mjs`), and `check_deployed` expects it.

If the owner would rather not have the reports at all, Cloudflare's dashboard can turn off Network
Error Logging for a zone on a custom domain; the exception then never shows its NOTE line.

## Alternatives considered

| Option | Tradeoff |
|---|---|
| One site-wide CSP in `/*`, Cache-Control rules apart (chosen) | No header from two rules; 404 covered; a page may run another page's exact inline scripts |
| Per-page CSP rules (ADR 0015) | Tightest per page, but nothing may carry a CSP in `/*`, so unknown addresses get none |
| Cloudflare's `!` to detach and reset per rule | Cloudflare only; Netlify has no such syntax |
| `netlify.toml` and a Pages Function | Two formats, and a function brings back server code |

## Consequences

- The site CSP grows with each distinct inline script. The generator fails the build for
  Cloudflare Pages if a line passes 2,000 characters; then the choice is ADR 0015's per-page form
  again or fewer inline scripts.
- Hosts may add headers of their own. `check_deployed` reports a wrong value of a checked header,
  any `Access-Control-Allow-Origin`, and any header that names another host; the owner turns
  those off or accepts them in writing. Cloudflare's `Report-To` and `NEL` are the one accepted
  exception (see "Host reporting exception").
- The deploy CLIs' versions and the host secrets are repository settings, set by the owner
  (`docs/RELEASE_CHECKLIST.md`).
