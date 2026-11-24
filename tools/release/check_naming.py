#!/usr/bin/env python3
"""Release gate: the public name is chosen, avoids the M-Pesa trademark, and is the one shown.

Reads the owner's choice from docs/NAMING.md ("Chosen name: ..." and "Domain: ..."), and the
names the app shows from the web manifest and the root layout's title. Run by the release
workflow before it deploys (CP10b item 8); it fails until the owner has chosen.
"""

import argparse
import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
TRADEMARK = re.compile(r"m[\s._-]*pesa", re.IGNORECASE)
CHOSEN = re.compile(r"^Chosen name:\s*(.*)$", re.MULTILINE)
DOMAIN = re.compile(r"^Domain:\s*(.*)$", re.MULTILINE)
TITLE = re.compile(r'^\s*title:\s*"([^"]*)"', re.MULTILINE)
PENDING = re.compile(r"pending|^\s*$|^\(", re.IGNORECASE)


def main():
    """Check the naming and print the problems.

    Returns:
        Process exit code: 0 when the naming is ready for release, otherwise 1.

    Side Effects:
        Reads three files under the root and writes to stdout.
    """
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=REPO)
    root = parser.parse_args().root
    problems = naming_problems(root)
    for problem in problems:
        print(f"check_naming: {problem}")
    print(f"check_naming: {'FAIL' if problems else 'PASS'} ({len(problems)} problem(s))")
    return 1 if problems else 0


def naming_problems(root):
    """List what keeps the naming from being ready for release.

    Args:
        root: Repo root.

    Returns:
        Problems in plain words; empty when ready.

    Side Effects:
        Reads docs/NAMING.md, the web manifest and the root layout.
    """
    naming = (root / "docs" / "NAMING.md").read_text(encoding="utf-8")
    chosen = _first(CHOSEN, naming)
    domain = _first(DOMAIN, naming)
    if PENDING.search(chosen):
        return ["the public name is pending: the owner chooses it in docs/NAMING.md"]
    problems = []
    if TRADEMARK.search(chosen):
        problems.append("the chosen name uses the M-Pesa trademark")
    if not domain or PENDING.search(domain):
        problems.append("the domain is pending in docs/NAMING.md")
    elif TRADEMARK.search(domain):
        problems.append("the domain uses the M-Pesa trademark")
    problems += _shown_name_problems(root, chosen)
    return problems


def _shown_name_problems(root, chosen):
    """Compare the names the app shows with the chosen one.

    Args:
        root: Repo root.
        chosen: The chosen public name.

    Returns:
        Problems naming the file that differs.

    Side Effects:
        Reads the web manifest and the root layout.
    """
    manifest = json.loads(
        (root / "web" / "public" / "manifest.webmanifest").read_text(encoding="utf-8")
    )
    layout = (root / "web" / "src" / "app" / "layout.tsx").read_text(encoding="utf-8")
    problems = [
        f"the web manifest's {field} is not the chosen name"
        for field in ("name", "short_name")
        if manifest.get(field) != chosen
    ]
    if _first(TITLE, layout) != chosen:
        problems.append("the page title in web/src/app/layout.tsx is not the chosen name")
    return problems


def _first(pattern, text):
    """The first group of a pattern's first match.

    Args:
        pattern: A compiled pattern with one group.
        text: The text.

    Returns:
        The group, stripped, or an empty string without a match.

    Side Effects:
        None.
    """
    match = pattern.search(text)
    return match.group(1).strip() if match else ""


if __name__ == "__main__":
    sys.exit(main())
