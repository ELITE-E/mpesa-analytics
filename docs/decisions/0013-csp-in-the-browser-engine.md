# 0013. The architecture CSP holds for the browser engine (OQ-08)

Status: Accepted (CP8a, measured in Chrome 152, headless, on the dev machine)
Date: 2026-11-16

## Context

The migration plan's architecture (section 6) sets this policy, as a host header with a meta tag as backup:

```
default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self';
connect-src 'self'; img-src 'self' data:; font-src 'self'; style-src 'self';
manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
```

ADR 0002 showed Pyodide and pandas work without `'unsafe-eval'` on the main thread only. Not covered there: a module worker, pdf.js under the policy, the wheel, and numpy loaded as a package. OQ-08 asked whether the policy can stand as written.

## Decision

Keep the policy exactly as written. Nothing needed loosening.

`web/harness/serve.js` sends it as a header on every response, the worker scripts included (a worker takes the policy of its own script's response). `ARCHITECTURE_CSP` there is the single copy the tests read.

## What was measured

`node --test tests/browser/csp.test.js`, against the runtime `tools/vendor.py runtime` builds:

| Check | Result |
|---|---|
| Header on the page and on `pdf_reader/reader.worker.js` | Exactly the policy above; no `'unsafe-eval'`, no `'unsafe-inline'` |
| Pyodide 314.0.7 in a module worker, the core wheel installed from verified bytes | Loads |
| pdf.js 6.4.299 (browser build) in the same worker, with its own nested worker | Reads every synthetic fixture |
| numpy and pandas, loaded at the analysis step | Load; the report is built |
| `securitypolicyviolation` events, page and worker | 0 and 0 |
| Console lines mentioning Content Security Policy | 0 |
| Requests other than same-origin static GETs | 0 |
| Control: the same policy without `'wasm-unsafe-eval'` | Runtime refused; the engine reports `ENGINE_FAILED` at the runtime stage, and Chrome logs the refusal |

Why each part of the policy is enough:

- `script-src 'self' 'wasm-unsafe-eval'`: Pyodide, numpy and pandas compile wasm, which needs `'wasm-unsafe-eval'`. Nothing calls `eval` or `new Function`: pdf.js runs with `isEvalSupported: false`.
- `worker-src 'self'`: the engine worker and pdf.js's nested worker are both same-origin module scripts.
- `connect-src 'self'`: every runtime file is fetched from `runtime/<version>/`. Pyodide is given `packageBaseUrl` explicitly, because with a lock file passed in and no base URL it would fetch packages from its CDN, which this policy would block (and the no-network test would catch).
- `style-src 'self'`: the harness uses a stylesheet and no inline style. CP8b's components still need checking against this (the architecture notes that icon sizes use style attributes today).

## Alternatives considered

| Option | Tradeoff |
|---|---|
| Add `'unsafe-eval'` | Not needed; would allow string-to-code everywhere |
| Drop `'wasm-unsafe-eval'` | Pyodide cannot start at all (the control) |
| Keep the policy as written (chosen) | None found for the engine; CP8b must keep components free of inline styles or record a decision |

## Consequences

- A blocked wasm compile hangs instead of throwing, as ADR 0002 warned. The engine client's start timeout turns it into `ENGINE_FAILED`. Under the control policy this takes the full start timeout (120 s), so CP8b should show progress while the runtime loads.
- Only Chrome on desktop was measured. Firefox, Safari and phones are unverified.

## Enforcement

- `tests/browser/csp.test.js`: the header, a full run with zero violations, and the control.
- `tests/browser/engine.test.js`: zero requests other than same-origin static GETs during and after the imports.
