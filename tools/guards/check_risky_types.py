#!/usr/bin/env python3
"""Guard 3: risky file types and stray JSON fail outside explicit allowlists."""

import fnmatch
import sys

from _common import CONFIG, iter_files, parse_root, report

TYPES = CONFIG["types"]


def is_risky(rel):
    name = rel.rsplit("/", 1)[-1].lower()
    for suffix in TYPES["risky_suffixes"]:
        # Matches a.csv and a.sqlite3, and also dotfiles such as .env.local.
        if fnmatch.fnmatch(name, f"*{suffix}"):
            return not any(fnmatch.fnmatch(rel.lower(), g) for g in TYPES["risky_allow"])
    if name.endswith(".json"):
        in_dir = any(rel.startswith(d) for d in TYPES["json_allow_dirs"])
        return not in_dir and rel not in TYPES["json_allow"]
    return False


def main():
    args = parse_root(__doc__).parse_args()
    findings = {rel: 1 for rel in iter_files(args.root) if is_risky(rel)}
    return report("check_risky_types", findings, "risky file(s)")


if __name__ == "__main__":
    sys.exit(main())
