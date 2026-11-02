#!/usr/bin/env python3
"""Guard 1: reject phone numbers, masked phones and receipt-like tokens."""

import sys

from _common import find_tokens, iter_files, parse_root, report


def main():
    args = parse_root(__doc__).parse_args()
    findings = {}
    for rel in iter_files(args.root):
        count = len(find_tokens(rel))
        path = args.root / rel
        if path.is_file():
            text = path.read_bytes().decode("utf-8", errors="replace")
            count += len(find_tokens(text, rel))
        if count:
            findings[rel] = count
    return report("scan_patterns", findings)


if __name__ == "__main__":
    sys.exit(main())
