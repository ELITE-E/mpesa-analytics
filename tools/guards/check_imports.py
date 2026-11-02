#!/usr/bin/env python3
"""Guard 6: run import-linter and reduce its output to file names and counts."""

import os
import re
import subprocess
import sys
from pathlib import Path

from _common import parse_root, report

LINK = re.compile(r"^\s*(?:-\s+)?(mpesa_core[\w.]*) -> [\w.]+ \(l\.", re.MULTILINE)


def main():
    """Run the contracts in ``.importlinter`` against the given root.

    Returns:
        Process exit code: 0 when kept, 1 when broken, 2 when the linter could not run.

    Side Effects:
        Runs ``lint-imports`` and writes the report to stdout.
    """
    root = parse_root(__doc__).parse_args().root.resolve()
    linter = Path(sys.executable).parent / "lint-imports"
    env = {**os.environ, "PYTHONPATH": str(root / "src"), "NO_COLOR": "1"}
    completed = subprocess.run(
        [str(linter), "--no-cache", "--config", str(root / ".importlinter")],
        cwd=root,
        env=env,
        capture_output=True,
        text=True,
    )
    if completed.returncode == 0:
        return report("check_imports", {})
    findings = {}
    for module in LINK.findall(completed.stdout):
        rel = module_file(root, module)
        findings[rel] = findings.get(rel, 0) + 1
    if not findings:
        print(f"check_imports: ERROR (import-linter exited {completed.returncode}, no result)")
        return 2
    return report("check_imports", findings, "forbidden import link(s)")


def module_file(root, module):
    """Map a dotted module name to its source file.

    Args:
        root: Repo root.
        module: Dotted module name.

    Returns:
        Repo-relative path of the module's source file.

    Side Effects:
        Checks whether the module is a package directory.
    """
    base = "src/" + module.replace(".", "/")
    return f"{base}/__init__.py" if (root / base).is_dir() else f"{base}.py"


if __name__ == "__main__":
    sys.exit(main())
