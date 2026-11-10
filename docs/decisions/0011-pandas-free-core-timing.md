# 0011. Timing of the pandas-free core

Status: Measured (CP5). Informs the pandas decision at the CP5 gate (ADR 0006); it does not decide it.
Date: 2026-11-10

## Context

ADR 0006 asks for the measured start-up of the pandas-free core before deciding whether analytics keeps pandas. The core now builds rows, cleans and classifies with no dataframe library.

## Measurement

`tools/measure_core_timing.mjs` under Node 24.21.0, Pyodide 314.0.7, from the built wheel. Input: F-LARGE, generated on demand (5,700 rows, 93 pages), as its `model.json` statement pages. The step is `build_rows`, then `canonicalize_rows`, then `classify_transactions`. Three separate processes on the dev machine (Intel Core i5-6300U, 4 threads), unthrottled. `cold_load_seconds` covers loading Pyodide, installing the wheel and importing the core. Each process then runs the step 3 times.

| Label | Run 1 | Run 2 | Run 3 |
|---|---|---|---|
| rows | 5,700 | 5,700 | 5,700 |
| cold_load_seconds | 10.46 | 10.595 | 9.945 |
| first_run_seconds | 4.193 | 4.209 | 4.294 |
| median_run_seconds | 4.031 | 4.021 | 4.294 |
| wasm_memory_bytes | 54,460,416 | 54,460,416 | 54,460,416 |
| node_rss_bytes | 220,491,776 | 226,803,712 | 221,741,056 |

The same step under CPython 3.14 on the same machine took 2.089 seconds.

**For reference, from ADR 0002 on the same machine:** loading Pyodide with pandas under Node took 33.9 to 43.1 seconds. That run included `import pandas` and a four-row groupby, and no core code.

## What the numbers do not include

- **pdf.js extraction.** The input is already statement pages.
- **A browser, a worker or CPU throttling.** ADR 0002's thresholds are for Chrome with a 6x throttle. These are unthrottled Node numbers, so they are not directly comparable to its limits.
- **Analytics,** which is not ported yet.
- **Peak JavaScript heap.** WASM memory only grows, so `wasm_memory_bytes` is its peak; `node_rss_bytes` is read after the runs, not as a peak.

## Consequences

The pandas-free load is about a quarter of the pandas load under the same conditions. The pipeline on a 5,700-row statement takes about 4 seconds under Pyodide, roughly twice CPython. The decision itself stays with ADR 0006.
