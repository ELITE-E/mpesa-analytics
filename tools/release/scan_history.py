#!/usr/bin/env python3
"""Scan every commit on every ref for statement-shaped text, PDFs, large binaries and secrets.

Each file version is scanned once, at the first commit that holds it, and so is every commit
message. Prints file name, commit and category only, never the matched text; file names are
redacted like the guards'. Fails if anything is found (CP10b item 4).

Categories: receipt, phone (masked phones included), email, id, pdf, large-binary, secret. The
synthetic fixtures keep the guards' allowances (fake ranges, PDFs, large files), in
tests/fixtures/synthetic/ and in fixtures/synthetic/, where they lived until commit d27198a moved
them. Reserved example domains (RFC 2606) and no-reply addresses are not emails of a person.
"""

import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

# The guards' shared rules, so the history is held to the same patterns as the tree.
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "guards"))

from _common import SYNTHETIC, display_name, parse_root, token_categories  # noqa: E402
from check_secrets import CONFIG as GITLEAKS_CONFIG  # noqa: E402
from check_secrets import LEAK_FOUND, gitleaks_binary  # noqa: E402

FORMER_SYNTHETIC = "fixtures/synthetic/"
COMMIT_MESSAGE = "(commit message)"
LARGE_BINARY_BYTES = 1024 * 1024
BINARY_SNIFF_BYTES = 8000
SHORT_COMMIT = 12
TOKEN_CATEGORY = {"phone": "phone", "masked": "phone", "receipt": "receipt"}
EMAIL = re.compile(r"(?<![\w.+\\-])([\w.+-]+)@((?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,})(?![\w-])")
RESERVED_DOMAIN = re.compile(
    r"(^|\.)(example\.(com|net|org)|example|test|invalid|localhost)$", re.I
)
NO_REPLY = re.compile(r"no-?reply", re.I)
NATIONAL_ID = re.compile(
    r"(?i)\b(?:national\s+)?id(?:entity)?(?:\s*(?:no|number|num|card))?\.?\s*[:#]\s*\d{6,10}\b"
)


def main():
    """Scan the history and print the findings.

    Returns:
        Process exit code: 0 when clean, 1 when anything is found, 2 when gitleaks cannot run.

    Side Effects:
        Runs git and gitleaks, uses a temporary directory and writes the report to stdout.
    """
    root = parse_root(__doc__).parse_args().root.resolve()
    binary = gitleaks_binary()
    if binary is None:
        print("scan_history: ERROR (gitleaks not found; run tools/vendor.py fetch gitleaks)")
        return 2
    commits = _git(root, "rev-list", "--all", "--reverse", "--topo-order").split()
    versions = first_versions(root, commits)
    findings = set(scan_versions(root, versions)) | set(scan_messages(root, commits))
    secrets = scan_secrets(binary, root) if commits else set()
    if secrets is None:
        print("scan_history: ERROR (gitleaks could not scan the history)")
        return 2
    return report(findings | secrets, commits, len(versions))


def first_versions(root, commits):
    """List each file version with the first commit that holds it.

    Args:
        root: Repo root.
        commits: Every commit, oldest first.

    Returns:
        Dict of ``(path, blob id)`` to ``(commit, size)``.

    Side Effects:
        Runs ``git ls-tree`` once per commit.
    """
    versions = {}
    for commit in commits:
        for entry in _git(root, "ls-tree", "-r", "-l", "-z", commit).split("\0"):
            if not entry:
                continue
            meta, path = entry.split("\t", 1)
            _mode, kind, blob, size = meta.split()
            if kind == "blob":
                versions.setdefault((path, blob), (commit, int(size)))
    return versions


def scan_versions(root, versions):
    """Find statement-shaped content, PDFs and large binaries in file versions.

    Args:
        root: Repo root.
        versions: From ``first_versions``.

    Returns:
        Findings as ``(path, commit, category)``.

    Side Effects:
        Reads every blob once with ``git cat-file``.
    """
    contents = read_blobs(root, {blob for _path, blob in versions})
    findings = []
    for (path, blob), (commit, size) in versions.items():
        content = contents[blob]
        for category in categories_of_version(path, content, size):
            findings.append((path, commit, category))
    return findings


def categories_of_version(path, content, size):
    """Name what one file version holds that must not be in the history.

    Args:
        path: Its repo-relative path.
        content: Its bytes.
        size: Its size in bytes.

    Returns:
        Set of categories.

    Side Effects:
        None.
    """
    rules_path = as_guard_path(path)
    in_fixtures = rules_path.startswith(SYNTHETIC)
    categories = text_categories(path, None) | text_categories(
        content.decode("utf-8", errors="replace"), rules_path
    )
    if path.lower().endswith(".pdf") and not in_fixtures:
        categories.add("pdf")
    is_binary = b"\0" in content[:BINARY_SNIFF_BYTES]
    if is_binary and size > LARGE_BINARY_BYTES and not in_fixtures:
        categories.add("large-binary")
    return categories


def text_categories(text, rel):
    """Name the statement-shaped tokens in a text.

    Args:
        text: The text: file content, a file name or a commit message.
        rel: The guard path that selects exemptions, or None for names and messages.

    Returns:
        Set of categories among receipt, phone, email and id.

    Side Effects:
        None.
    """
    categories = {TOKEN_CATEGORY[name] for name in token_categories(text, rel)}
    if any(is_personal_email(*match.groups()) for match in EMAIL.finditer(text)):
        categories.add("email")
    if NATIONAL_ID.search(text):
        categories.add("id")
    return categories


def is_personal_email(local, domain):
    """Decide whether an address could belong to a person.

    Args:
        local: The part before the at sign.
        domain: The domain.

    Returns:
        False for reserved example domains and no-reply addresses, otherwise True.

    Side Effects:
        None.
    """
    return not (RESERVED_DOMAIN.search(domain) or NO_REPLY.search(local) or NO_REPLY.search(domain))


def as_guard_path(path):
    """Map the fixtures' former folder onto the current one, so it keeps the same allowances.

    Args:
        path: A repo-relative path from any commit.

    Returns:
        The path the guards' rules should see.

    Side Effects:
        None.
    """
    if path.startswith(FORMER_SYNTHETIC):
        return f"tests/{path}"
    return path


def scan_messages(root, commits):
    """Find statement-shaped text in commit messages.

    Args:
        root: Repo root.
        commits: Every commit.

    Returns:
        Findings as ``(COMMIT_MESSAGE, commit, category)``.

    Side Effects:
        Runs ``git log``.
    """
    if not commits:
        return []
    log = _git(root, "log", "--all", "--format=%H%x00%B%x00")
    fields = log.split("\0")
    findings = []
    for commit, message in zip(fields[0::2], fields[1::2], strict=False):
        for category in text_categories(message, None):
            findings.append((COMMIT_MESSAGE, commit.strip(), category))
    return findings


def scan_secrets(binary, root):
    """Run gitleaks over every commit on every ref.

    Args:
        binary: Path of gitleaks.
        root: Repo root.

    Returns:
        Findings as ``(path, commit, "secret")``, or None if gitleaks failed.

    Side Effects:
        Runs gitleaks with redaction; its report goes to a temporary directory.
    """
    with tempfile.TemporaryDirectory() as scratch:
        report_path = Path(scratch) / "report.json"
        command = [
            binary,
            "git",
            "--log-opts=--all",
            ".",
            "--config",
            str(GITLEAKS_CONFIG),
            "--redact",
            "--no-banner",
            "--exit-code",
            str(LEAK_FOUND),
            "--report-format",
            "json",
            "--report-path",
            str(report_path),
        ]
        code = subprocess.run(command, cwd=root, capture_output=True, text=True).returncode
        if code not in (0, LEAK_FOUND) or not report_path.exists():
            return None
        leaks = json.loads(report_path.read_text(encoding="utf-8") or "[]")
    return {(leak["File"], leak["Commit"], "secret") for leak in leaks}


def read_blobs(root, blobs):
    """Read blobs' contents in one ``git cat-file --batch`` run.

    Args:
        root: Repo root.
        blobs: Blob ids.

    Returns:
        Dict of blob id to bytes.

    Side Effects:
        Runs git.
    """
    ordered = sorted(blobs)
    output = subprocess.run(
        ["git", "-C", str(root), "cat-file", "--batch"],
        input="".join(f"{blob}\n" for blob in ordered).encode(),
        capture_output=True,
        check=True,
    ).stdout
    contents, offset = {}, 0
    for blob in ordered:
        header_end = output.index(b"\n", offset)
        size = int(output[offset:header_end].split()[2])
        contents[blob] = output[header_end + 1 : header_end + 1 + size]
        offset = header_end + 1 + size + 1
    return contents


def report(findings, commits, version_count):
    """Print one line per finding and a verdict.

    Args:
        findings: Set of ``(path, commit, category)``.
        commits: Every commit, oldest first, which orders the lines.
        version_count: How many file versions were scanned.

    Returns:
        Process exit code: 1 when there are findings, otherwise 0.

    Side Effects:
        Writes to stdout.
    """
    order = {commit: index for index, commit in enumerate(commits)}
    for path, commit, category in sorted(
        findings, key=lambda finding: (order.get(finding[1], -1), finding[0], finding[2])
    ):
        print(f"{display_name(path)} @ {commit[:SHORT_COMMIT]}: {category}")
    if findings:
        commit_count = len({commit for _path, commit, _category in findings})
        print(f"scan_history: FAIL ({len(findings)} finding(s) in {commit_count} commit(s))")
        return 1
    print(f"scan_history: PASS ({len(commits)} commit(s), {version_count} file version(s))")
    return 0


def _git(root, *args):
    """Run git in the repo and return its output.

    Args:
        root: Repo root.
        *args: Git arguments.

    Returns:
        Standard output as text.

    Side Effects:
        Runs git.
    """
    return subprocess.run(
        ["git", "-C", str(root), *args], capture_output=True, text=True, check=True
    ).stdout


if __name__ == "__main__":
    sys.exit(main())
