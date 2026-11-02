#!/usr/bin/env python3
"""Report vendored download sizes in bytes, raw and as gzip -9 would serve them."""

import gzip
import sys

from vendor import GROUPS, VENDOR

THRESHOLD = 15_000_000


def main():
    totals = {}
    for group, members in GROUPS.items():
        raw = packed = 0
        for rel in members:
            data = (VENDOR / rel).read_bytes()
            raw += len(data)
            packed += len(gzip.compress(data, 9, mtime=0))
        totals[group] = (raw, packed)
        print(f"{group}: raw={raw} gzip={packed} files={len(members)}")
    python = [totals[g] for g in ("pyodide-core", "numpy", "pandas")]
    raw, packed = sum(t[0] for t in python), sum(t[1] for t in python)
    print(f"python-runtime (core+numpy+pandas): raw={raw} gzip={packed}")
    everything = raw + totals["pdfjs"][0], packed + totals["pdfjs"][1]
    print(f"all: raw={everything[0]} gzip={everything[1]}")
    print(f"threshold {THRESHOLD}: raw {'ok' if raw <= THRESHOLD else 'over'}, gzip {'ok' if packed <= THRESHOLD else 'over'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
