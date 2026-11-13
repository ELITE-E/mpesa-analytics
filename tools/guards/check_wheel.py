#!/usr/bin/env python3
"""Guard 8 (CI only): the wheel is py3-none-any, contains only mpesa_core, and needs nothing.

Its one allowed dependency is pandas, pinned, under the optional extra ``analysis`` (ADR 0006).
"""

import argparse
import re
import sys
import zipfile
from pathlib import Path

NAME = re.compile(r"mpesa_core-([^-]+)-py3-none-any\.whl")
REQUIREMENT = re.compile(r"^Requires-Dist:\s*(?P<requirement>[^;]+?)\s*(?:;\s*(?P<marker>.*))?$")
ALLOWED_EXTRA_REQUIREMENT = re.compile(r"pandas==[0-9][0-9.]*")
ALLOWED_EXTRA_MARKER = re.compile(r"""extra\s*==\s*['"]analysis['"]""")


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
    """Count naming, content and dependency problems in one wheel.

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
    metadata_name = f"mpesa_core-{match.group(1)}.dist-info"
    allowed = {"mpesa_core", metadata_name}
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        tops = [entry.split("/", 1)[0] for entry in names]
        metadata_path = f"{metadata_name}/METADATA"
        metadata = archive.read(metadata_path).decode() if metadata_path in names else ""
    content_problems = sum(top not in allowed for top in tops) + ("mpesa_core" not in tops)
    return content_problems + count_dependency_problems(metadata)


def count_dependency_problems(metadata):
    """Count the dependencies a wheel declares beyond the one allowed.

    Args:
        metadata: Text of the wheel's METADATA file.

    Returns:
        Number of ``Requires-Dist`` lines other than pinned pandas under the extra ``analysis``.

    Side Effects:
        None.
    """
    problems = 0
    for line in metadata.splitlines():
        declared = REQUIREMENT.match(line)
        if declared is None:
            continue
        is_allowed = ALLOWED_EXTRA_REQUIREMENT.fullmatch(
            declared["requirement"]
        ) and ALLOWED_EXTRA_MARKER.fullmatch(declared["marker"] or "")
        problems += not is_allowed
    return problems


if __name__ == "__main__":
    sys.exit(main())
