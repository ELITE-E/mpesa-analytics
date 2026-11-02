# 0002: Pandas probe

Status: measured on one machine. **D2 is not decided here**; re-run on your reference desktop first.
OQ-08 is answered below for the main thread only.

Measured 2026-11-02 with headless Chrome 152 on this machine (4 cores reported, CPU model not
recorded), by `web/probe/run_probe.mjs`, using Pyodide 314.0.7 and pandas 3.0.2.

## Result against thresholds

| Threshold (desktop, 6x CPU throttle) | Limit | Measured (median) | Range | Verdict |
|---|---|---|---|---|
| Cold first run | 60 s | 173.8 s | 170.1-214.4 s (3 runs) | **Fail**, about 2.9x over |
| Repeat cold start | 20 s | 163.3 s | 143.7-188.2 s (6 runs) | **Fail**, about 8x over |
| Download, gzip | 15 MB | 14014489 bytes | identical in all cold runs | Pass |
| Download, uncompressed | 15 MB | 21426158 bytes | | **Fail** |

Download passes only if the host compresses `pyodide.asm.wasm`.

## How much of this is the machine

This machine is slow at this workload, so these numbers may not represent your target desktop:

- Unthrottled Chrome: cold 32.4 s, repeat 22.5 s (one run each). Repeat misses the 20 s limit even with no throttling.
- The same work in Node, no browser: 33.9-43.1 s (3 runs), on an otherwise idle machine. So Chrome and the driver are not the cause.

Throttled runs also vary. An earlier smoke run of the same script gave cold 296.8 s and repeat
180.5 s and 154.8 s. It is excluded from the table, and it was the slowest cold run seen.

A faster desktop would need to be about 2.9x quicker to pass the cold limit and about 8x quicker to pass the repeat limit.

## Where the time goes

Typical 6x cold run (baseline-3):

| Phase | Time |
|---|---|
| `loadPyodide` | 64.2 s |
| Load pandas and dependencies | 22.7 s |
| `import pandas` plus the groupby | 86.7 s |

Most of the repeat-start time survives a full HTTP cache (0 bytes over the network), so this is CPU
cost, not download cost. Faster hosting will not fix it. The largest single phase is `import pandas`;
the probe does not time the import and the groupby separately.

## Memory

| Measure | Value |
|---|---|
| Peak JS heap (`performance.memory`, sampled every 100 ms) | 59.8-63.8 MB |
| WASM heap at end of run | 78512128 bytes, every run |

The sampler runs on the main thread, which is mostly blocked during load, so the JS peak may be
understated. The JS heap figure excludes WASM memory.

## CSP (OQ-08)

| Policy | CPU | Result | Violations | Total |
|---|---|---|---|---|
| `script-src 'self' 'wasm-unsafe-eval'` | 6x | **Works**, cold and repeat | 0 | 173.1 s, 187.3 s |
| `script-src 'self'` (negative control) | 1x | Fails as expected: blocked by CSP | 3 (`wasm-eval`) | n/a |

**Pyodide and pandas work without `'unsafe-eval'`.** The control shows the policy was really enforced.
The probe also crosses the Python/JS boundary both ways (`create_proxy`, `to_js`, a JS call from Python).

Not covered: a Web Worker, which is where `engine/engine.worker.js` will run, and pdf.js under this CSP.
Without the probe's handling, a blocked wasm compile hangs instead of throwing, so the app will need its own timeout.

## What the numbers do not include

- **Network time.** Everything is served over loopback. Real first-run time adds the 14 MB download.
- **Worker throttling.** The probe runs on the main thread, where the CPU throttle is applied.
- **Headed Chrome and other browsers.** All runs are headless Chrome.
- **Any real workload.** The groupby is four rows.

## Run it yourself

Automated, about 40 minutes at this machine's speed. Prints every row above:

    uv run python tools/vendor.py fetch pyodide
    node web/probe/run_probe.mjs --repeats 3

Set `CHROME_BIN` if Chrome is not `google-chrome-stable`.

By hand in Chrome DevTools:

1. Run `python3 web/probe/serve.py --port 8000`. For the CSP test add `--csp strict`; for the control, `--csp no-wasm`. Add `--no-gzip` to see the uncompressed size.
2. Open `http://127.0.0.1:8000/probe/` and open DevTools (F12).
3. Performance tab: gear icon, CPU: **6x slowdown**. The throttle only applies while DevTools stays open.
4. Network tab: tick **Disable cache**, reload, and wait for "Done". This is the cold first run.
5. Untick **Disable cache** and reload. This is the repeat start. The "Bytes over network" row should be 0.
6. Read the table on the page. It keeps the last cold and last warm result, and `performance.memory` needs Chrome. For finer memory values start Chrome with `--enable-precise-memory-info`.
7. For CSP, check the "CSP violations" row and the Console.

Each server restart keeps the browser cache, so use a fresh profile or "Disable cache" when changing `--csp`.
