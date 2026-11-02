#!/usr/bin/env python3
"""Guard 3: risky file types and stray JSON fail outside explicit allowlists."""

import fnmatch
import sys

from _common import CONFIG, iter_files, parse_root, report

TYPES = CONFIG["types"]


def main():
    """Report every file whose type is not allowed where it sits.

    Returns:
        Process exit code: 1 when a risky file is found, otherwise 0.

    Side Effects:
        Reads the tree and writes the report to stdout.
    """
    args = parse_root(__doc__).parse_args()
    findings = {rel: 1 for rel in iter_files(args.root) if is_risky(rel)}
    return report("check_risky_types", findings, "risky file(s)")


def is_risky(rel):
    """Apply the type rules and allowlists to one path.

    Args:
        rel: Repo-relative path.

    Returns:
        True if the file type is not allowed at this path.

    Side Effects:
        None.
    """
    name = rel.rsplit("/", 1)[-1].lower()
    for suffix in TYPES["risky_suffixes"]:
        # Matches a.csv and a.sqlite3, and also dotfiles such as .env.local.
        if fnmatch.fnmatch(name, f"*{suffix}"):
            return not any(fnmatch.fnmatch(rel.lower(), glob) for glob in TYPES["risky_allow"])
    if name.endswith(".json"):
        in_dir = any(rel.startswith(directory) for directory in TYPES["json_allow_dirs"])
        return not in_dir and rel not in TYPES["json_allow"]
    return False


if __name__ == "__main__":
    sys.exit(main())
