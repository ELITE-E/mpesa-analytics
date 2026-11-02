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


def gitleaks_binary():
    local = REPO / ".cache" / "bin" / "gitleaks"
    return str(local) if local.is_file() else shutil.which("gitleaks")


def run(binary, scan, cwd, report_path):
    command = [
        binary, *scan, "--config", str(CONFIG), "--redact", "--no-banner",
        "--exit-code", "1", "--report-format", "json", "--report-path", str(report_path),
    ]
    return subprocess.run(command, cwd=cwd, capture_output=True, text=True).returncode


def count_by_file(report_path, base):
    findings = {}
    for leak in json.loads(report_path.read_text(encoding="utf-8") or "[]"):
        rel = Path(leak["File"])
        rel = rel.relative_to(base).as_posix() if rel.is_absolute() else rel.as_posix()
        findings[rel] = findings.get(rel, 0) + 1
    return findings


def scan_tree(binary, root, work):
    # Copied so gitleaks sees what the guards walk, not .venv or the vendored runtime.
    copy = work / "tree"
    for rel in iter_files(root):
        source = root / rel
        if source.is_file():
            target = copy / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
    copy.mkdir(exist_ok=True)
    return run(binary, ["dir", str(copy)], root, work / "report.json"), copy.resolve()


def main():
    parser = parse_root(__doc__)
    parser.add_argument("--mode", choices=MODES, default="tree")
    args = parser.parse_args()
    root = args.root.resolve()
    binary = gitleaks_binary()
    if binary is None:
        print("check_secrets: ERROR (gitleaks not found; run tools/vendor.py fetch gitleaks)")
        return 2
    if args.mode == "history":
        commits = subprocess.run(
            ["git", "-C", str(root), "rev-list", "--all", "--count"],
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()
        if commits == "0":
            print("check_secrets: PASS (history: 0 commits to scan)")
            return 0
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp).resolve()
        report_path = work / "report.json"
        if args.mode == "tree":
            code, base = scan_tree(binary, root, work)
        else:
            scan = ["git", "--staged", "."] if args.mode == "staged" else ["git", "--log-opts=--all", "."]
            code, base = run(binary, scan, root, report_path), root
        if code not in (0, 1) or not report_path.exists():
            print(f"check_secrets: ERROR (gitleaks exited {code})")
            return 2
        findings = count_by_file(report_path, base)
    if code == 1 and not findings:
        print("check_secrets: ERROR (gitleaks reported a leak but no file)")
        return 2
    return report(f"check_secrets[{args.mode}]", findings, "secret(s)")


if __name__ == "__main__":
    sys.exit(main())
