"""Shared walk, patterns and reporting for the guards.

Guards print file names and counts only, never matched text. File names are
redacted too, since a statement is often named after a phone number.
"""

import argparse
import re
import subprocess
import tomllib
from pathlib import Path

GUARDS_DIR = Path(__file__).resolve().parent
REPO = GUARDS_DIR.parents[1]
CONFIG = tomllib.loads((GUARDS_DIR / "guards.toml").read_text(encoding="utf-8"))
SYNTHETIC = "fixtures/synthetic/"

MASK_CHARS = "Xx*#•"
# (name, pattern, exempt in lockfiles)
RULES = [
    ("phone", re.compile(r"(?<!\d)\+?2547\d{8}(?!\d)"), True),
    ("phone", re.compile(r"(?<!\d)\+?2541\d{8}(?!\d)"), True),
    ("phone", re.compile(r"(?<!\d)07\d{8}(?!\d)"), True),
    ("phone", re.compile(r"(?<!\d)01\d{8}(?!\d)"), True),
    ("phone", re.compile(r"(?<!\d)(?:\+?254[ -]?|0)[17]\d{2}[ -]\d{3}[ -]\d{3}(?!\d)"), False),
    (
        "masked",
        re.compile(
            rf"(?<![0-9A-Za-z])(?:\+?254[ -]?|0)[17](?:[ -]?[0-9{MASK_CHARS}]){{5,10}}(?![0-9A-Za-z])"
        ),
        False,
    ),
    ("receipt", re.compile(r"(?<![A-Z0-9])(?=[A-Z0-9]{0,9}\d)[A-Z0-9]{10}(?![A-Z0-9])"), True),
]
# Hex digests hold 10-digit runs often enough (about 1 sha256 in 4) to need excluding.
_DIGEST = re.compile(r"(?<![0-9A-Za-z])(?:[0-9a-f]{40}|[0-9a-f]{64})(?![0-9A-Za-z])")
_FAKE = [re.compile(p) for p in CONFIG["patterns"]["fake_ranges"]]
_LOCKFILES = set(CONFIG["patterns"]["lockfiles"])


def _is_token(name, text):
    # A masked token needs real masking, otherwise it is only a run of digits.
    return name != "masked" or sum(text.count(c) for c in MASK_CHARS) >= 2


def _is_fake(token):
    plain = re.sub(r"[ +-]", "", token)
    return any(p.fullmatch(plain) for p in _FAKE)


def find_tokens(text, rel=None):
    """Return the set of spans holding a finding. `rel` selects path-based exemptions."""
    is_lock = rel is not None and rel.rsplit("/", 1)[-1] in _LOCKFILES
    in_fixtures = rel is not None and rel.startswith(SYNTHETIC)
    digests = [m.span() for m in _DIGEST.finditer(text)]
    spans = set()
    for name, pattern, lock_exempt in RULES:
        if is_lock and lock_exempt:
            continue
        for match in pattern.finditer(text):
            if not _is_token(name, match.group()):
                continue
            if in_fixtures and _is_fake(match.group()):
                continue
            if any(start <= match.start() and match.end() <= end for start, end in digests):
                continue
            spans.add(match.span())
    return spans


def display_name(rel):
    """Redact any token in a file name before it reaches the terminal."""
    spans = sorted(find_tokens(rel), reverse=True)
    for start, end in spans:
        rel = f"{rel[:start]}[redacted]{rel[end:]}"
    return rel


def parse_root(description):
    parser = argparse.ArgumentParser(description=description)
    parser.add_argument("--root", type=Path, default=REPO)
    return parser


def iter_files(root):
    """Yield repo-relative POSIX paths: the pruned walk plus everything git tracks."""
    root = Path(root).resolve()
    walk = CONFIG["walk"]
    names, paths = {".git", *walk["prune_names"]}, set(walk["prune_paths"])
    found = set()
    for directory, subdirs, files in root.walk():
        rel_dir = directory.relative_to(root).as_posix()
        subdirs[:] = [
            d
            for d in subdirs
            if d not in names and (d if rel_dir == "." else f"{rel_dir}/{d}") not in paths
        ]
        found.update((directory / f).relative_to(root).as_posix() for f in files)
    if (root / ".git").exists():
        tracked = subprocess.run(
            ["git", "-C", str(root), "ls-files", "-c", "-z"],
            capture_output=True,
            text=True,
            check=True,
        ).stdout
        found.update(p for p in tracked.split("\0") if p)
    return sorted(found)


def report(guard, findings, noun="finding(s)"):
    """Print one `file: count noun` line per file and return the exit code."""
    for rel, count in sorted(findings.items()):
        print(f"{display_name(rel)}: {count} {noun}")
    total = sum(findings.values())
    status = "FAIL" if findings else "PASS"
    print(f"{guard}: {status} ({total} in {len(findings)} file(s))")
    return 1 if findings else 0
