#!/usr/bin/env python3
"""Guard 5: gitleaks over staged changes, full history, or the working tree."""

import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from _common import REPO, iter_files, parse_root, report

CONFIG = REPO / ".gitleaks.toml"
MODES = ("staged", "history", "tree")
LEAK_FOUND = 1


def main():
    """Run gitleaks in the requested mode.

    Returns:
        Process exit code: 0 when clean, 1 on a leak, 2 when gitleaks could not run.

    Side Effects:
        Runs gitleaks and git, uses a temporary directory and writes the report to stdout.
    """
    parser = parse_root(__doc__)
    parser.add_argument("--mode", choices=MODES, default="tree")
    args = parser.parse_args()
    root = args.root.resolve()
    binary = gitleaks_binary()
    if binary is None:
        print("check_secrets: ERROR (gitleaks not found; run tools/vendor.py fetch gitleaks)")
        return 2
    if args.mode == "history" and _count_commits(root) == "0":
        print("check_secrets: PASS (history: 0 commits to scan)")
        return 0
    with tempfile.TemporaryDirectory() as scratch:
        work = Path(scratch).resolve()
        report_path = work / "report.json"
        code, base = _scan(binary, args.mode, root, work)
        if code not in (0, LEAK_FOUND) or not report_path.exists():
            print(f"check_secrets: ERROR (gitleaks exited {code})")
            return 2
        findings = count_by_file(report_path, base)
    if code == LEAK_FOUND and not findings:
        print("check_secrets: ERROR (gitleaks reported a leak but no file)")
        return 2
    return report(f"check_secrets[{args.mode}]", findings, "secret(s)")


def gitleaks_binary():
    """Find gitleaks, preferring the pinned copy from tools/vendor.py.

    Returns:
        Path of the binary, or None if it is not installed.

    Side Effects:
        None.
    """
    local = REPO / ".cache" / "bin" / "gitleaks"
    return str(local) if local.is_file() else shutil.which("gitleaks")


def count_by_file(report_path, base):
    """Reduce a gitleaks report to file names and counts.

    Args:
        report_path: Path of the JSON report.
        base: Directory that absolute paths in the report are relative to.

    Returns:
        Map of repo-relative path to secret count.

    Side Effects:
        Reads the report.
    """
    findings = {}
    for leak in json.loads(report_path.read_text(encoding="utf-8") or "[]"):
        rel = Path(leak["File"])
        rel = rel.relative_to(base).as_posix() if rel.is_absolute() else rel.as_posix()
        findings[rel] = findings.get(rel, 0) + 1
    return findings


def _scan(binary, mode, root, work):
    """Dispatch one gitleaks scan.

    Args:
        binary: Path of gitleaks.
        mode: One of ``MODES``.
        root: Repo root.
        work: Temporary directory that receives the report.

    Returns:
        Tuple of gitleaks' exit code and the base directory of its report paths.

    Side Effects:
        Runs gitleaks; tree mode also copies files into ``work``.
    """
    if mode == "tree":
        copy = _copy_tree(root, work)
        return _run(binary, ["dir", str(copy)], root, work / "report.json"), copy
    scan = ["git", "--staged", "."] if mode == "staged" else ["git", "--log-opts=--all", "."]
    return _run(binary, scan, root, work / "report.json"), root


def _copy_tree(root, work):
    """Copy what the guards walk, so gitleaks skips .venv and the vendored runtime.

    Args:
        root: Repo root.
        work: Temporary directory to copy into.

    Returns:
        Resolved path of the copy.

    Side Effects:
        Writes files under ``work``.
    """
    copy = work / "tree"
    for rel in iter_files(root):
        source = root / rel
        if source.is_file():
            target = copy / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
    copy.mkdir(exist_ok=True)
    return copy.resolve()


def _run(binary, scan, cwd, report_path):
    """Run gitleaks with redaction and a JSON report.

    Args:
        binary: Path of gitleaks.
        scan: Scan subcommand and its arguments.
        cwd: Working directory.
        report_path: Where gitleaks writes its report.

    Returns:
        Gitleaks' exit code.

    Side Effects:
        Runs gitleaks, which writes the report file.
    """
    command = [
        binary,
        *scan,
        "--config",
        str(CONFIG),
        "--redact",
        "--no-banner",
        "--exit-code",
        str(LEAK_FOUND),
        "--report-format",
        "json",
        "--report-path",
        str(report_path),
    ]
    return subprocess.run(command, cwd=cwd, capture_output=True, text=True).returncode


def _count_commits(root):
    """Count commits on all refs, since gitleaks errors on an empty history.

    Args:
        root: Repo root.

    Returns:
        The count as printed by git.

    Side Effects:
        Runs git.
    """
    return subprocess.run(
        ["git", "-C", str(root), "rev-list", "--all", "--count"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()


if __name__ == "__main__":
    sys.exit(main())
