# CP8 notes

Things to act on at CP8. Add to this file as they come up; do not bury them in other records.

## Desktop limits (CP8a)

Measured with `node tools/measure_browser_limits.mjs` in headless Chrome 152 on the dev machine (the 2015 i5 laptop of ADR 0006), from the synthetic F-LARGE layout. Cold is the first statement after the runtime loads (pandas loads during it); warm is the same statement again. `peak_rss_bytes` is the summed RSS of Chrome's whole process tree, sampled every 100 ms.

| Measure | F-LARGE (5,700 rows) | `--rows 17400` |
|---|---:|---:|
| pdf_bytes | 3,093,438 | 9,446,847 |
| pages | 98 | 298 |
| runtime_load_ms | 22,743 | 29,012 |
| cold_read_ms | 8,444 | 40,631 |
| cold_core_ms (pandas load included) | 105,788 | 234,449 |
| cold_pandas_load_ms | 9,270 | 8,227 |
| cold_total_ms | 118,415 | 288,799 |
| warm_read_ms | 8,712 | 25,131 |
| warm_core_ms | 34,476 | 101,635 |
| warm_total_ms | 47,048 | 136,451 |
| peak_rss_bytes | 1,596,080,128 | 1,882,783,744 |
| wasm_memory_bytes | 113,115,136 | 206,176,256 |
| other_requests | 0 | 0 |

The 298-page run shared the CPU with a test run for part of its cold phase, so its cold numbers may read high.

Limits, in `pdf_reader/limits.js` and tested by `tests/pdf_readers/desktop_limits.test.js`:

- **10 MiB**: the 298-page synthetic statement fits (synthetic PDFs are uncompressed; real ones are smaller). Same as the old API.
- **300 pages**: about twice the largest real statement seen (148 pages).
- **600 s**: twice the cold run at the page limit. The old 120 s default would have timed out F-LARGE itself when cold.

The phone is out of scope: phone unverified. Memory near 1.9 GB at the page limit suggests phones will need a lower limit. `browser_run.mjs` prints whether the owner's real statement falls within each limit.

## Tie order between the browser and CPython (CP8a-3)

The owner's run found 4 report paths differing between Pyodide and CPython on the real statement. Same versions on both sides: numpy 2.4.6, pandas 3.0.2, python-dateutil 2.9.0.post0, pytz 2026.1.post1 (Pyodide 314.0.7's lock file and the CPython `.venv`); bottleneck, numexpr and pyarrow absent. No pin change was needed. The cause is the build, not the version: CPython's numpy uses x86 SIMD (`X86_V3`), and numpy's default unstable sort orders ties differently there than in wasm. Shown directly: `sort_values` on 400 rows of two amounts gives different first rows in each.

Fixed by stable sorts with a tie-breaker in the three unstable sorts (behaviour-changes T-1 to T-3). The other orderings by value in `analysis/` were already stable over input order, which is the same in both: `sort_values(kind="stable")` in `spending.calculate_merchant_usage_frequency` and `report` (recurring recency), Python's `sorted` in `transfers` (by count, by amount, months), `report` (recurring), `investments` and `recurrence`, and `idxmax` (first unreadable date) in `frame`. `groupby` sorts its keys.

Pre-fix code (HEAD) against the fix, on every synthetic fixture with rows and F-TIED: differing report paths are all proven tie order only (`other=0`): F-MULTILINE 1 (`cash_flow.closing_balance`), F-SUMMARY-MISMATCH 1 (same), F-TIED 30 (`cash_flow.closing_balance` 1, `spending.largest_purchases[].date` 7, `.recipient` 10, `.transaction` 10, `spending.top_recipients[].recipient` 2); every other fixture 0. The old mpesa-parser itself could not be run on the synthetic PDFs (its entity step raises a pandas `KeyError` there), so the owner's real run is where `compare.py` checks the old report: `report_paths_tie_order_only` and `report_tie_order_only <class>` lines.

## Per-stage timing (CP8a-2)

`node tools/measure_stage_timing.mjs` (F-LARGE: 3,093,438 bytes, 98 pages, 61,285 items, 5,700 rows), median of 3 runs, the machine otherwise idle, headless Chrome 152. Cold is a fresh worker; warm is the same worker again. Memory: `wasm` is Pyodide's wasm memory growth in the stage (it never shrinks), `rss` the rise in Chrome's summed RSS during it.

| Stage | Cold ms | Warm ms | Cold wasm bytes | Cold rss bytes | Warm rss bytes |
|---|---:|---:|---:|---:|---:|
| pyodide_init | 11,333 | - | 31,457,280 | 310,558,720 | - |
| wheel_install | 391 | - | - | - | - |
| pdfjs_extract | 3,782 | 3,523 | 0 | 70,692,864 | 46,104,576 |
| json_serialise | 135 | 150 | 0 | 65,536 | 5,328,896 |
| bridge_in | 677 | 685 | 13,893,632 | 34,172,928 | 24,633,344 |
| attest | 40 | 28 | 0 | 2,433,024 | 28,672 |
| build_rows | 9,722 | 7,801 | 9,109,504 | 23,396,352 | 118,784 |
| canonicalize | 1,207 | 581 | 0 | 21,651,456 | 45,056 |
| classify | 332 | 377 | 0 | 4,349,952 | 8,192 |
| pandas_load | 4,603 | - | 24,051,712 | 93,167,616 | - |
| pandas_import | 18,089 | - | 34,603,008 | 128,917,504 | - |
| analyze | 2,159 | 1,319 | 0 | 21,286,912 | 516,096 |
| reconcile | 3,751 | 3,724 | 0 | 20,480 | 4,096 |
| bridge_out | 266 | 166 | 0 | 7,774,208 | 8,396,800 |

Peak RSS 1,594,609,664 bytes; wasm memory at the end 135,790,592 bytes; 0 other requests.

- **Time:** cold, pandas (load 4,603 + import 18,089 ms) is about half of the statement's 44.8 s; warm, `build_rows` (7,801 ms) is about 42% of 18.4 s. A CPython profile of `build_rows` on F-LARGE shows `group_lines` called 196 times for 98 pages, 1.72 s of 2.32 s cumulative: column calibration and row assembly each group every page's lines.
- **Memory:** Pyodide's start (310 MB RSS) is the largest and fixed. Of the per-statement stages, pandas grows wasm memory most (58.7 MB for load and import) and pdf.js extraction raises RSS most (70.7 MB cold, 46.1 MB warm).
- **Proposed, not done:** group each page's lines once and hand the result to both calibration and assembly (no behaviour change; the counts must stay identical). For pandas, either load it in the background once the runtime is ready (an ADR 0006 decision, since it would load for statements that never reach analysis) or the v1.1 plain-Python analysis. For extraction memory, keep only the JSON text, not the page objects, once a page is read (the architecture's per-page streaming).
- Repeated after CP8a-3's stable sorts (median of 3, idle): cold `pandas_import` 22,149 ms and warm `build_rows` 8,071 ms still dominate; warm `analyze` rose from 1,319 to 2,329 ms, most likely the cost of the two-column stable sorts, with run-to-run variation of about 5 to 15% on the other stages; peak RSS 1,547,001,856 bytes; 0 other requests.
- The desktop-limit numbers above were taken while other work ran on the machine: the idle per-stage run is about twice as fast (extraction 3.5 s idle against 8.7 s then), so the limits are on the safe side.

## Resolved at CP8a

- **Timeout in a real browser worker.** Measured: the engine client terminates the worker and starts a fresh one. A hostile PDF that takes about 10 s to read times out at the engine's 1 s deadline, well before the read would end, and the next statement runs on the fresh worker (`tests/browser/engine.test.js`). The adapter's own deadline is now a backstop at twice the engine's.
- **Legacy build against the browser build.** On every committed fixture, the browser build (`build/pdf.min.mjs`) in Chrome gives statement pages equal item for item to the Node legacy build. No differences to record. Chrome 152 has `Uint8Array.prototype.toHex`; other browsers are unchecked.

## Timeout

The adapter's deadline in `pdf_reader/pdfjs/adapter.js` is a timer plus a check after opening the document and after each page.

- **Under Node, a stuck step cannot be interrupted.** pdf.js runs on the same thread there, so a slow step is only noticed once it finishes. A 1 ms timeout on F-DENSE reports `TIMEOUT` after about 700 ms on the dev machine.
- **A real browser worker is untested.** There pdf.js has its own thread, so the timer should fire on time, but no test has shown it. CP8 should measure this in a browser, including that `loadingTask.destroy()` actually stops a slow page.

## Legacy build

- **The tested build is not the shipped build.** Node tests use `legacy/build/pdf.min.mjs` from pdfjs-dist 6.4.299, because the modern `build/pdf.min.mjs` needs `Uint8Array.prototype.toHex`, which Node 24 lacks. The browser is meant to load the modern build, which has no automated test yet.
- **Recorded fixtures come from the legacy build.** Every `items.json` is recorded with it. CP8 should compare both builds on the fixtures in a browser and record any differences.
- **Browser support needs checking.** The modern build requires `toHex`, so any target browser without it cannot load the app with this build. Which browsers that excludes has not been checked.

## Bundle budget

Enforced at CP8a-2. `tools/measure_bundle.py` measures the built runtime (every file in its manifest, gzip -9) and fails CI over 15,000,000 bytes with pandas or 8,000,000 without. Measured: 14,569,080 with pandas, 6,886,551 without. Tested by `tests/guards/test_bundle_budget.py`.

## PDF metadata for attestation

`StatementPages` carries no PDF metadata, so `attest` reads page 1's printed text only (behaviour-changes B-1). The old code also looked for the brand in metadata. If the owner's `compare.py` run shows `attestation: FAIL (BRAND_MISSING)`, CP8 should add an optional metadata text to `StatementPages` from pdf.js `getMetadata()`: a contract change that needs an ADR.

## Two ESLint versions (ADR 0014)

The web app is linted by its own ESLint 9.39.5 because `eslint-config-next` 16.3.6 brings `eslint-plugin-react` 7.37.5, which crashes under ESLint 10. ESLint 9 is end-of-life. When `eslint-config-next` supports ESLint 10, move the web app onto the root's ESLint 10 and drop the second version.

## Timing in tests

A test that depends on how long something takes calibrates on the machine running it, never on a fixed duration measured once on the dev laptop. The browser timeout test failed on GitHub's runner for this reason: its hostile PDF, slow on the laptop, read in under a second there. It now measures the engine's own read time first and sets the timeout from it (`tests/browser/engine.test.js`, `calibrated_hostile_pdf`).

## Column calibration needs two values in each amount column (found CP8b)

`extraction/columns.py` calibrates the paid in, withdrawn and balance columns by clustering where amounts print, and keeps a cluster only with at least `MINIMUM_AMOUNT_VALUES` (2) values. A statement with no money in, or only one money-in row, is refused as `LAYOUT_UNRECOGNIZED`. Three of the five edge-case scenarios hit this (`tools/equivalence/scenario_compare.py`: stress has 0 money-in rows, no-spending and savings 1). A real statement for a quiet period could too. Owner decision (2026-11-17): the rule stays; the refusal now has its own core code, `TOO_FEW_AMOUNTS`, and user message; relaxing it is on the CP10 list (`cp10-list.md`).
