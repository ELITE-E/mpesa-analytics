# 0001: Pinned versions and download sizes

Status: accepted. Closes OQ-06. Measured 2026-11-02 from the files `tools/vendor.py` fetched.

## Versions

| Component | Version | Notes |
|-----------|---------|-------|
| Pyodide | 314.0.7 | Python 3.14.2; lock ABI 2026_0. Published 2026-09-14. |
| pdfjs-dist | 6.4.299 | Published 2026-10-03. 6.5.438 was one day old at pin time, so it was passed over. |
| pandas (Pyodide wheel) | 3.0.2 | |
| numpy (Pyodide wheel) | 2.4.6 | |
| gitleaks | 8.30.1 | Linux x64 binary, dev tool only, never shipped. |
| Node (lint hooks) | 24.21.0 | Linux x64 binary under `.cache/bin`, dev tool only, never shipped. Git hooks use it because an editor may start them without nvm on PATH. |
| CPython (dev, CI) | 3.14 | `.python-version`; same minor as Pyodide. |

Pyodide has moved to a new version scheme: 314.x tracks Python 3.14. Older lines (0.29.x, 0.27.x)
still get releases; they were not measured.

**pdf.js build under Node:** the engine's Node tests use `legacy/build/pdf.min.mjs` from the same pdfjs-dist 6.4.299 tarball, vendored as `pdfjs-node/`. The modern `build/pdf.min.mjs` fails to load under Node 24 because it calls `Uint8Array.prototype.toHex`, which Node 24 lacks. The browser build and the tested build therefore differ. Node prints a warning about optional `@napi-rs/canvas`; it is not needed because nothing is rendered. This pair is dev only and outside the sizes below.

The `test-runner` group in `tools/vendor.py` pins 11 more wheels from Pyodide's lock (pytest 9.0.2 and its dependencies). They run `tests/core` under Pyodide and are never served, so they are outside the sizes below. Reportlab and pdfplumber are dev dependencies pinned by `uv.lock`, and never enter the wheel.

## Sizes in bytes

Gzip is `gzip -9`, from `tools/measure_bundle.py`. Brotli is Node's default quality 11, run once
by hand on the Python runtime files; it is not part of the tool.

| Group | Raw | Gzip | Made up of |
|-------|-----|------|-----------|
| Pyodide core | 13531207 | 6325376 | `pyodide.mjs`, `pyodide.asm.mjs`, `pyodide.asm.wasm`, `python_stdlib.zip`, `pyodide-lock.json` |
| numpy | 2960568 | 2924334 | numpy wheel |
| pandas | 4929180 | 4758195 | pandas wheel, plus its required dependencies python-dateutil, pytz and six. Excludes numpy. |
| pdf.js | 1723246 | 505611 | `pdf.min.mjs`, `pdf.worker.min.mjs` |
| **Python runtime** (core + numpy + pandas) | **21420955** | **14007905** | Brotli: 13039769 |
| **Everything** | 23144201 | 14513516 | |

Against the 15 MB download threshold, the Python runtime is **over when served raw and under only
if the host compresses**. Wheels and `python_stdlib.zip` barely compress; almost all the saving
comes from `pyodide.asm.wasm`.

The pdf.js total excludes optional assets in the same package that are not vendored: `wasm/`
decoders (`jbig2.wasm` 103671, `openjpeg.wasm` 251131, `qcms_bg.wasm` 96589), `cmaps/` (1167747)
and `standard_fonts/` (798046). Image decoding, unusual encodings and non-embedded fonts need them,
so re-measure if the engine turns out to need any.

## Checksums

Source of truth: `PINS` and `GITLEAKS_SHA256` in `tools/vendor.py`. `tools/vendor.py fetch` fails on
any mismatch. Pins were taken after checking npm's `dist.integrity` for both tarballs, Pyodide's
lock for each wheel, and gitleaks' published checksum file. That is trust on first use from those
sources; the wheels were not rebuilt from source.

| Group | File | Bytes | sha256 |
|-------|------|-------|--------|
| pyodide-core | `pyodide/pyodide.mjs` | 17931 | `6f1d60f7bf529beb300f0f47983c921d3982363640ba20af0e38efdddbc66109` |
| pyodide-core | `pyodide/pyodide.asm.mjs` | 1250344 | `f7cdc8ece80678ceb712f8e65ebe6d3a83203a180c399865f49612a051693635` |
| pyodide-core | `pyodide/pyodide.asm.wasm` | 9598218 | `cc36e3cab04fdfc9a63ff13eb52eae2b911bf46c025cc7b281f394bd3de1d5e6` |
| pyodide-core | `pyodide/python_stdlib.zip` | 2545637 | `fa1957e5777068fc4f7437f96d860ae2fbe9c19732ba06c84e004ec16dd7dd7a` |
| pyodide-core | `pyodide/pyodide-lock.json` | 119077 | `5dc2fc119108bc148c7457dc86e7675b5c87e1cafd420b9c34c1eaef7b36c010` |
| numpy | `pyodide/numpy-2.4.6-cp314-cp314-pyemscripten_2026_0_wasm32.whl` | 2960568 | `a292c1f5d7d8a2208cd5e94fc467604c131cabcd2fc14fed6eefde121e7fabdf` |
| pandas | `pyodide/pandas-3.0.2-cp314-cp314-pyemscripten_2026_0_wasm32.whl` | 4177749 | `45ff57772cc2f366a8582c7d3097cc4e6676342ecd5a3c08184a43462d5a02ae` |
| pandas | `pyodide/python_dateutil-2.9.0.post0-py2.py3-none-any.whl` | 229892 | `9b13365edf9c188f570baf9c540bbb3029ada2a2dacb9694b3659941693ee9e5` |
| pandas | `pyodide/pytz-2026.1.post1-py2.py3-none-any.whl` | 510489 | `b8249d6450146e0b61e6d710dc02ebb35a904796c4c2f97fe87d4ac5872db36a` |
| pandas | `pyodide/six-1.17.0-py2.py3-none-any.whl` | 11050 | `228c50f73aa7addf2c2ccf2979c256802a59ab69cad8152b31b9443cc8140f42` |
| pdfjs | `pdfjs/pdf.min.mjs` | 458904 | `57456c8e0c81e46be31174b499ef77f2b9f5ee46d04412ba627320a36755d4c2` |
| pdfjs | `pdfjs/pdf.worker.min.mjs` | 1264342 | `9536359f1b8367850d485731ca1d5e45c159a7b7a0912325e539937aa21ceb18` |
| dev tool | `gitleaks_8.30.1_linux_x64.tar.gz` | 8230402 | `551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb` |
