#!/usr/bin/env python3
"""Release gate: the public name is chosen, avoids the M-Pesa trademark, and is the one shown.

Reads the owner's choice from docs/NAMING.md ("Chosen name: ..." and "Domain: ..."), and the
names the app shows: the one source web/src/content/brand.ts (APP_NAME), the web manifest
(web/src/app/manifest.ts, which must name the app with APP_NAME; or a hand-written
web/public/manifest.webmanifest) and the root layout's title (APP_NAME, or a literal). Run by the
release workflow before it deploys (CP10b item 8); it fails until the owner has chosen.
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
TITLE_FROM_BRAND = re.compile(r"^\s*title:\s*APP_NAME\b", re.MULTILINE)
BRAND_NAME = re.compile(r'^export const APP_NAME = "([^"]*)";', re.MULTILINE)
MANIFEST_FIELDS = ("name", "short_name")
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
        Reads brand.ts, the web manifest and the root layout.
    """
    web = root / "web"
    brand_file = web / "src" / "content" / "brand.ts"
    brand = ""
    if brand_file.exists():
        brand = _first(BRAND_NAME, brand_file.read_text(encoding="utf-8"))
    problems = []
    if brand_file.exists() and brand != chosen:
        problems.append("APP_NAME in web/src/content/brand.ts is not the chosen name")
    problems += _manifest_problems(web, chosen, brand)
    layout = (web / "src" / "app" / "layout.tsx").read_text(encoding="utf-8")
    title = (
        brand if brand_file.exists() and TITLE_FROM_BRAND.search(layout) else _first(TITLE, layout)
    )
    if title != chosen:
        problems.append("the page title in web/src/app/layout.tsx is not the chosen name")
    return problems


def _manifest_problems(web, chosen, brand):
    """Check the web manifest's name and short name.

    Args:
        web: The web app's folder.
        chosen: The chosen public name.
        brand: APP_NAME from brand.ts, or an empty string without that file.

    Returns:
        Problems naming the manifest field that differs.

    Side Effects:
        Reads web/src/app/manifest.ts or web/public/manifest.webmanifest.
    """
    generated = web / "src" / "app" / "manifest.ts"
    if generated.exists():
        source = generated.read_text(encoding="utf-8")
        return [
            f"the web manifest's {field} (web/src/app/manifest.ts) is not APP_NAME, the chosen name"
            for field in MANIFEST_FIELDS
            if not re.search(rf"\b{field}:\s*APP_NAME\b", source) or brand != chosen
        ]
    manifest = json.loads((web / "public" / "manifest.webmanifest").read_text(encoding="utf-8"))
    return [
        f"the web manifest's {field} is not the chosen name"
        for field in MANIFEST_FIELDS
        if manifest.get(field) != chosen
    ]


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
