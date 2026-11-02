#!/usr/bin/env python3
"""Guard 2: any PDF outside fixtures/synthetic/ fails."""

import sys

from _common import SYNTHETIC, iter_files, parse_root, report


def main():
    """Report every PDF outside the synthetic fixtures directory.

    Returns:
        Process exit code: 1 when a PDF is misplaced, otherwise 0.

    Side Effects:
        Reads the tree and writes the report to stdout.
    """
    args = parse_root(__doc__).parse_args()
    findings = {
        rel: 1
        for rel in iter_files(args.root)
        if rel.lower().endswith(".pdf") and not rel.startswith(SYNTHETIC)
    }
    return report("check_pdf_location", findings, "misplaced PDF(s)")


if __name__ == "__main__":
    sys.exit(main())
