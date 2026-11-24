# Changelog

Every release, newest first. Versions follow semantic versioning; the core (`pyproject.toml`) and
the app (`web/package.json`) share one version. A release is deployed only from its version tag
(`docs/RELEASE_CHECKLIST.md`), and its GitHub release notes carry its SHA-256 checksum.

## [1.0.0] - unreleased

The first release: a private beta, desktop Chrome only.

### Added

- Reads an M-PESA statement PDF in the browser with pdf.js and a Python core under Pyodide; no
  server, nothing leaves the device (CP2 to CP8).
- Reconciliation: balance chains, the statement summary's totals, and the verification
  instruction as printed on the statement (CP7).
- The web app as a static export under a hash-based CSP: summary, ledger, breakdowns and CSV
  export (CP8b).
- Remember on this device, off by default: an encrypted vault, one ledger per account, merging
  with confirmation, auto-lock and delete-all (CP9).
- Columns printed once or never, a capability check, hardened CSV export, offline use through a
  hand-written service worker, and accessibility checks (CP10a).
- The release pack (CP10b): host headers for Cloudflare Pages and Netlify, a deployed-site check,
  a history scan, third-party notices, release checksums, and deploys from version tags only.

### Known limits

See the README's Limits: desktop only, phone unverified, about 24% of rows uncategorised, a first
import of about a minute, and consistency checks that are not proof of authenticity.
