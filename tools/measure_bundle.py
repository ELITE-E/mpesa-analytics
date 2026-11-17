#!/usr/bin/env python3
"""Enforce the download budget on the runtime the browser loads (ADR 0006).

Measures every file in the built runtime's manifest as gzip -9 would serve it: with pandas (all of
it) and without (leaving out numpy, pandas and pandas's dependencies, which load only when the
analysis step needs them). With ``--app``, the frontend's static export (every file outside its
``runtime/`` folder: pages, Next's chunks and the engine) counts towards both totals (CP8b item 7).
With ``--fetched``, only the app files a real visit downloaded count: the JSON list of paths
``tools/measure_app_download.mjs`` records in Chrome while it reads a statement and opens every
page. Prints byte counts and PASS or FAIL; exits 1 over either budget, 2 if the app was not built.

    python tools/measure_bundle.py [--runtime DIR] [--app web/out [--fetched FILE]]
"""

import argparse
import gzip
import json
import sys
from pathlib import Path

from vendor import RUNTIME_MANIFEST, RUNTIME_POINTER, RUNTIME_ROOT

BUDGET_WITH_PANDAS = 15_000_000
BUDGET_WITHOUT_PANDAS = 8_000_000
GZIP_LEVEL = 9
ANALYSIS_FILE_PREFIXES = (
    "pyodide/numpy-",
    "pyodide/pandas-",
    "pyodide/python_dateutil-",
    "pyodide/six-",
)
OVER_BUDGET = 1
APP_MISSING = 2
# The static export's copy of the runtime, measured from the runtime's own manifest instead.
APP_RUNTIME_DIR = "runtime"


def main():
    """Measure the built runtime and compare it with both budgets.

    Returns:
        Process exit code: 1 if either total is over its budget, otherwise 0.

    Side Effects:
        Reads the runtime and writes counts to stdout.
    """
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runtime", type=Path, default=RUNTIME_ROOT)
    parser.add_argument("--app", type=Path, default=None)
    parser.add_argument("--fetched", type=Path, default=None)
    parser.add_argument("--with-pandas-budget", type=int, default=BUDGET_WITH_PANDAS)
    parser.add_argument("--without-pandas-budget", type=int, default=BUDGET_WITHOUT_PANDAS)
    args = parser.parse_args()
    if args.app is not None and not args.app.is_dir():
        print("app: not built (run npm run build in web/)", file=sys.stderr)
        return APP_MISSING
    totals = measure_runtime(args.runtime)
    if args.app is not None:
        fetched = None if args.fetched is None else json.loads(args.fetched.read_text("utf-8"))
        app = measure_app(args.app, fetched=fetched)
        print(f"app: files={app['app_files']} raw={app['app_raw']} gzip={app['app_gzip']}")
        print(f"app_measured: {'every exported file' if fetched is None else 'fetched by a visit'}")
        for kind in ("raw", "gzip"):
            totals[f"with_pandas_{kind}"] += app[f"app_{kind}"]
            totals[f"without_pandas_{kind}"] += app[f"app_{kind}"]
    with_ok = totals["with_pandas_gzip"] <= args.with_pandas_budget
    without_ok = totals["without_pandas_gzip"] <= args.without_pandas_budget
    print(f"with_pandas: raw={totals['with_pandas_raw']} gzip={totals['with_pandas_gzip']}")
    print(
        f"without_pandas: raw={totals['without_pandas_raw']} gzip={totals['without_pandas_gzip']}"
    )
    print(f"budget_with_pandas_gzip: {args.with_pandas_budget} {'ok' if with_ok else 'over'}")
    print(
        f"budget_without_pandas_gzip: {args.without_pandas_budget} {'ok' if without_ok else 'over'}"
    )
    passed = with_ok and without_ok
    print(f"bundle_budget: {'PASS' if passed else 'FAIL'}")
    return 0 if passed else OVER_BUDGET


def measure_runtime(runtime_root):
    """Total the runtime's raw and gzip sizes, with and without the analysis packages.

    Args:
        runtime_root: The directory ``tools/vendor.py runtime`` built.

    Returns:
        Map of ``with_pandas_raw``, ``with_pandas_gzip``, ``without_pandas_raw`` and
        ``without_pandas_gzip`` to byte counts.

    Side Effects:
        Reads the runtime's pointer, manifest and files.
    """
    version = json.loads((runtime_root / RUNTIME_POINTER).read_text())["version"]
    version_dir = runtime_root / version
    paths = json.loads((version_dir / RUNTIME_MANIFEST).read_text())["files"]
    totals = dict.fromkeys(
        ("with_pandas_raw", "with_pandas_gzip", "without_pandas_raw", "without_pandas_gzip"), 0
    )
    for path in paths:
        content = (version_dir / path).read_bytes()
        packed = len(gzip.compress(content, GZIP_LEVEL, mtime=0))
        totals["with_pandas_raw"] += len(content)
        totals["with_pandas_gzip"] += packed
        if not is_analysis_file(path):
            totals["without_pandas_raw"] += len(content)
            totals["without_pandas_gzip"] += packed
    return totals


def measure_app(app_root, fetched=None):
    """Total the static export's raw and gzip sizes, leaving out its copy of the runtime.

    Args:
        app_root: The static export (``web/out``).
        fetched: URL paths a visit downloaded, or None for every exported file. A page's path
            ("/ledger/") means its ``index.html``; a path the export does not hold adds nothing.

    Returns:
        Map of ``app_files``, ``app_raw`` and ``app_gzip`` to counts.

    Side Effects:
        Reads the files counted.
    """
    if fetched is None:
        paths = sorted(path for path in app_root.rglob("*") if path.is_file())
    else:
        paths = sorted({_exported_file(app_root, url_path) for url_path in fetched} - {None})
    totals = {"app_files": 0, "app_raw": 0, "app_gzip": 0}
    for path in paths:
        if path.relative_to(app_root).parts[0] == APP_RUNTIME_DIR:
            continue
        content = path.read_bytes()
        totals["app_files"] += 1
        totals["app_raw"] += len(content)
        totals["app_gzip"] += len(gzip.compress(content, GZIP_LEVEL, mtime=0))
    return totals


def _exported_file(app_root, url_path):
    """Find the exported file a URL path is served from.

    Args:
        app_root: The static export.
        url_path: A path such as "/ledger/" or "/_next/static/chunks/a.js", without its query.

    Returns:
        The file, or None if the export holds none for it.

    Side Effects:
        Reads the filesystem.
    """
    candidate = app_root / url_path.lstrip("/")
    if candidate.is_dir():
        candidate = candidate / "index.html"
    return candidate if candidate.is_file() else None


def is_analysis_file(path):
    """Tell whether a runtime file loads only for the analysis step.

    Args:
        path: The file's path in the manifest.

    Returns:
        True for numpy, pandas and pandas's dependencies.

    Side Effects:
        None.
    """
    return path.startswith(ANALYSIS_FILE_PREFIXES)


if __name__ == "__main__":
    sys.exit(main())
