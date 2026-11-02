#!/usr/bin/env python3
"""Guard 7: AST check that src/mpesa_core stays free of I/O and dynamic code."""

import ast
import sys

from _common import iter_files, parse_root, report

CORE = "src/mpesa_core/"
BRIDGE = f"{CORE}bridge.py"
# importlib and builtins would otherwise walk straight around this list.
BANNED_MODULES = {
    "os", "sys", "socket", "subprocess", "pathlib", "urllib", "http", "importlib", "builtins",
}
BRIDGE_ONLY_MODULES = {"js", "pyodide", "pyodide_js"}
BANNED_NAMES = {"open", "__import__", "eval", "exec", "print"}


def count_violations(tree, is_bridge):
    banned = BANNED_MODULES if is_bridge else BANNED_MODULES | BRIDGE_ONLY_MODULES
    count = 0
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            count += sum(a.name.partition(".")[0] in banned for a in node.names)
        elif isinstance(node, ast.ImportFrom):
            root = (node.module or "").partition(".")[0]
            count += node.level == 0 and root in banned
        elif isinstance(node, ast.Name):
            count += node.id in BANNED_NAMES
    return count


def main():
    args = parse_root(__doc__).parse_args()
    findings = {}
    for rel in iter_files(args.root):
        if not (rel.startswith(CORE) and rel.endswith(".py")):
            continue
        try:
            tree = ast.parse((args.root / rel).read_bytes())
        except (SyntaxError, ValueError):
            findings[rel] = 1  # Fail closed: an unparsable file cannot be shown pure.
            continue
        count = count_violations(tree, rel == BRIDGE)
        if count:
            findings[rel] = count
    return report("check_core_purity", findings)


if __name__ == "__main__":
    sys.exit(main())
