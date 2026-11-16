#!/usr/bin/env python3
"""Enforce the download budget on the runtime the browser loads (ADR 0006).

Measures every file in the built runtime's manifest as gzip -9 would serve it: with pandas (all of
it) and without (leaving out numpy, pandas and pandas's dependencies, which load only when the
analysis step needs them). Prints byte counts and PASS or FAIL; exits 1 over either budget.

    python tools/measure_bundle.py [--runtime DIR]
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
    "pyodide/pytz-",
    "pyodide/six-",
)
OVER_BUDGET = 1


def main():
    """Measure the built runtime and compare it with both budgets.

    Returns:
        Process exit code: 1 if either total is over its budget, otherwise 0.

    Side Effects:
        Reads the runtime and writes counts to stdout.
    """
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runtime", type=Path, default=RUNTIME_ROOT)
    parser.add_argument("--with-pandas-budget", type=int, default=BUDGET_WITH_PANDAS)
    parser.add_argument("--without-pandas-budget", type=int, default=BUDGET_WITHOUT_PANDAS)
    args = parser.parse_args()
    totals = measure_runtime(args.runtime)
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
