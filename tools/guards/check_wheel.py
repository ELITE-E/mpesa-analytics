#!/usr/bin/env python3
"""Guard 8 (CI only): the wheel is py3-none-any and contains only mpesa_core."""

import argparse
import re
import sys
import zipfile
from pathlib import Path

NAME = re.compile(r"mpesa_core-([^-]+)-py3-none-any\.whl")


def main():
    """Check each wheel named on the command line.

    Returns:
        Process exit code: 1 when a wheel fails or none is given, otherwise 0.

    Side Effects:
        Reads the wheels and writes the report to stdout.
    """
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("wheels", nargs="*", type=Path)
    args = parser.parse_args()
    if not args.wheels:
        print("check_wheel: FAIL (no wheel given)")
        return 1
    failed = 0
    for path in args.wheels:
        count = count_problems(path)
        print(f"{path.name}: {count} problem(s)")
        failed += bool(count)
    print(f"check_wheel: {'FAIL' if failed else 'PASS'}")
    return 1 if failed else 0


def count_problems(path):
    """Count naming and content problems in one wheel.

    Args:
        path: Path of the wheel.

    Returns:
        Number of problems: a bad name counts once and stops the check.

    Side Effects:
        Reads the wheel.
    """
    match = NAME.fullmatch(path.name)
    if not match:
        return 1
    allowed = {"mpesa_core", f"mpesa_core-{match.group(1)}.dist-info"}
    with zipfile.ZipFile(path) as archive:
        tops = [entry.split("/", 1)[0] for entry in archive.namelist()]
    return sum(top not in allowed for top in tops) + ("mpesa_core" not in tops)


if __name__ == "__main__":
    sys.exit(main())
