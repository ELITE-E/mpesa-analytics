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
CONFIG_PATH = GUARDS_DIR / "guards.toml"
CONFIG = tomllib.loads(CONFIG_PATH.read_text(encoding="utf-8"))
SYNTHETIC = "fixtures/synthetic/"

MASK_CHARS = "Xx*#•"
MIN_MASK_CHARS = 2
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
            r"(?<![0-9A-Za-z])(?:\+?254[ -]?|0)[17]"
            rf"(?:[ -]?[0-9{MASK_CHARS}]){{5,10}}(?![0-9A-Za-z])"
        ),
        False,
    ),
    ("receipt", re.compile(r"(?<![A-Z0-9])(?=[A-Z0-9]{0,9}\d)[A-Z0-9]{10}(?![A-Z0-9])"), True),
]
# Hex digests hold 10-digit runs often enough (about 1 sha256 in 4) to need excluding.
_DIGEST = re.compile(r"(?<![0-9A-Za-z])(?:[0-9a-f]{40}|[0-9a-f]{64})(?![0-9A-Za-z])")
# Every PDF's cross-reference table holds 10-digit byte offsets, which read as receipts. Requiring
# three leading zeros keeps this exemption from ever covering a phone number or a receipt.
_PDF_OFFSET = re.compile(r"(?m)^000\d{7} \d{5} [nf]\b")
_FAKE = [re.compile(pattern) for pattern in CONFIG["patterns"]["fake_ranges"]]
_LOCKFILES = set(CONFIG["patterns"]["lockfiles"])


def parse_root(description):
    """Build the argument parser every guard shares.

    Args:
        description: Help text for the guard.

    Returns:
        A parser that accepts ``--root``, defaulting to this repo.

    Side Effects:
        None.
    """
    parser = argparse.ArgumentParser(description=description)
    parser.add_argument("--root", type=Path, default=REPO)
    return parser


def iter_files(root):
    """List the files a guard must check: the pruned walk plus everything git tracks.

    Args:
        root: Directory to walk.

    Returns:
        Sorted repo-relative POSIX paths.

    Side Effects:
        Reads the directory tree and runs ``git ls-files`` when ``root`` is a repo.
    """
    root = Path(root).resolve()
    found = _walk_unpruned(root)
    if (root / ".git").exists():
        found.update(_tracked_files(root))
    return sorted(found)


def report(guard, findings, noun="finding(s)"):
    """Print one line per file and a verdict.

    Args:
        guard: Guard name shown on the verdict line.
        findings: Map of repo-relative path to finding count.
        noun: What the counts are counting.

    Returns:
        Process exit code: 1 when there are findings, otherwise 0.

    Side Effects:
        Writes to stdout.
    """
    for rel, count in sorted(findings.items()):
        print(f"{display_name(rel)}: {count} {noun}")
    total = sum(findings.values())
    status = "FAIL" if findings else "PASS"
    print(f"{guard}: {status} ({total} in {len(findings)} file(s))")
    return 1 if findings else 0


def find_tokens(text, rel=None):
    """Locate phone numbers, masked phones and receipt-like tokens.

    Args:
        text: Text to search.
        rel: Repo-relative path of the text, which selects path-based exemptions.

    Returns:
        Set of ``(start, end)`` spans, one per distinct token.

    Side Effects:
        None.
    """
    is_lock = rel is not None and rel.rsplit("/", 1)[-1] in _LOCKFILES
    in_fixtures = rel is not None and rel.startswith(SYNTHETIC)
    digests = [match.span() for match in _DIGEST.finditer(text)]
    if in_fixtures and rel.endswith(".pdf"):
        digests += [match.span() for match in _PDF_OFFSET.finditer(text)]
    spans = set()
    for name, pattern, lock_exempt in RULES:
        if is_lock and lock_exempt:
            continue
        for match in pattern.finditer(text):
            if _is_exempt(match, name, in_fixtures=in_fixtures, digests=digests):
                continue
            spans.add(match.span())
    return spans


def display_name(rel):
    """Redact any token in a file name before it reaches the terminal.

    Args:
        rel: Repo-relative path.

    Returns:
        The path with every token replaced by ``[redacted]``.

    Side Effects:
        None.
    """
    for start, end in sorted(find_tokens(rel), reverse=True):
        rel = f"{rel[:start]}[redacted]{rel[end:]}"
    return rel


def _is_exempt(match, name, *, in_fixtures, digests):
    """Decide whether a pattern match is not a real finding.

    Args:
        match: The regex match.
        name: Name of the rule that matched.
        in_fixtures: Whether the text lives in the synthetic fixtures directory.
        digests: Spans of hex digests and PDF offsets in the same text, which never count.

    Returns:
        True if the match should be ignored.

    Side Effects:
        None.
    """
    token = match.group()
    if name == "masked" and sum(token.count(mask) for mask in MASK_CHARS) < MIN_MASK_CHARS:
        return True
    if in_fixtures and _is_fake(token):
        return True
    return any(start <= match.start() and match.end() <= end for start, end in digests)


def _is_fake(token):
    """Check a token against the declared fake phone ranges.

    Args:
        token: Matched text, possibly with separators.

    Returns:
        True if the token falls inside a declared fake range.

    Side Effects:
        None.
    """
    plain = re.sub(r"[ +-]", "", token)
    return any(pattern.fullmatch(plain) for pattern in _FAKE)


def _walk_unpruned(root):
    """Walk a directory, skipping the tooling locations listed in guards.toml.

    Args:
        root: Resolved directory to walk.

    Returns:
        Set of repo-relative POSIX paths.

    Side Effects:
        Reads the directory tree.
    """
    walk = CONFIG["walk"]
    names, paths = {".git", *walk["prune_names"]}, set(walk["prune_paths"])
    found = set()
    for directory, subdirs, files in root.walk():
        rel_dir = directory.relative_to(root).as_posix()
        subdirs[:] = [
            subdir
            for subdir in subdirs
            if subdir not in names
            and (subdir if rel_dir == "." else f"{rel_dir}/{subdir}") not in paths
        ]
        found.update((directory / name).relative_to(root).as_posix() for name in files)
    return found


def _tracked_files(root):
    """List what git tracks, so a force-added file cannot hide in a pruned location.

    Args:
        root: Resolved repository root.

    Returns:
        Repo-relative POSIX paths.

    Side Effects:
        Runs ``git ls-files``.
    """
    tracked = subprocess.run(
        ["git", "-C", str(root), "ls-files", "-c", "-z"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    return [path for path in tracked.split("\0") if path]
