#!/usr/bin/env python3
"""Report vendored download sizes in bytes, raw and as gzip -9 would serve them.

The budget is NOT ENFORCED and this script is not a CI gate until CP8.
"""

import gzip
import sys

from vendor import GROUPS, VENDOR

THRESHOLD = 15_000_000
GZIP_LEVEL = 9


def main():
    """Print each group's size and how the Python runtime compares with the budget.

    Returns:
        Process exit code, always 0: the budget is not enforced until CP8.

    Side Effects:
        Reads the vendored files and writes to stdout.
    """
    totals = {group: measure_group(members) for group, members in GROUPS.items()}
    for group, (raw, packed) in totals.items():
        print(f"{group}: raw={raw} gzip={packed} files={len(GROUPS[group])}")
    python = [totals[group] for group in ("pyodide-core", "numpy", "pandas")]
    raw, packed = sum(sizes[0] for sizes in python), sum(sizes[1] for sizes in python)
    print(f"python-runtime (core+numpy+pandas): raw={raw} gzip={packed}")
    print(f"all: raw={raw + totals['pdfjs'][0]} gzip={packed + totals['pdfjs'][1]}")
    raw_verdict = "ok" if raw <= THRESHOLD else "over"
    gzip_verdict = "ok" if packed <= THRESHOLD else "over"
    print(f"threshold {THRESHOLD}, NOT ENFORCED until CP8: raw {raw_verdict}, gzip {gzip_verdict}")
    return 0


def measure_group(members):
    """Total one group's raw and compressed sizes.

    Args:
        members: Vendored paths in the group.

    Returns:
        Tuple of raw bytes and gzip bytes.

    Side Effects:
        Reads the vendored files.
    """
    raw = packed = 0
    for rel in members:
        content = (VENDOR / rel).read_bytes()
        raw += len(content)
        packed += len(gzip.compress(content, GZIP_LEVEL, mtime=0))
    return raw, packed


if __name__ == "__main__":
    sys.exit(main())
