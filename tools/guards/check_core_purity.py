#!/usr/bin/env python3
"""Guard 7: AST check that src/mpesa_core stays free of I/O and dynamic code."""

import ast
import sys

from _common import iter_files, parse_root, report

CORE = "src/mpesa_core/"
BRIDGE = f"{CORE}bridge.py"
# importlib and builtins would otherwise walk straight around this list.
BANNED_MODULES = {
    "os",
    "sys",
    "socket",
    "subprocess",
    "pathlib",
    "urllib",
    "http",
    "importlib",
    "builtins",
}
BRIDGE_ONLY_MODULES = {"js", "pyodide", "pyodide_js"}
BANNED_NAMES = {"open", "__import__", "eval", "exec", "print"}


def main():
    """Check every core module.

    Returns:
        Process exit code: 1 on any violation, otherwise 0.

    Side Effects:
        Reads the core sources and writes the report to stdout.
    """
    args = parse_root(__doc__).parse_args()
    findings = {}
    for rel in iter_files(args.root):
        if not (rel.startswith(CORE) and rel.endswith(".py")):
            continue
        try:
            tree = ast.parse((args.root / rel).read_bytes())
        except SyntaxError, ValueError:
            findings[rel] = 1  # Fail closed: an unparsable file cannot be shown pure.
            continue
        count = count_violations(tree, is_bridge=rel == BRIDGE)
        if count:
            findings[rel] = count
    return report("check_core_purity", findings)


def count_violations(tree, *, is_bridge):
    """Count banned imports and banned builtin references in one module.

    Args:
        tree: Parsed module.
        is_bridge: Whether this is the one module allowed to import js and pyodide.

    Returns:
        Number of violations.

    Side Effects:
        None.
    """
    banned = BANNED_MODULES if is_bridge else BANNED_MODULES | BRIDGE_ONLY_MODULES
    count = 0
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            count += sum(alias.name.partition(".")[0] in banned for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            root = (node.module or "").partition(".")[0]
            count += node.level == 0 and root in banned
        elif isinstance(node, ast.Name):
            count += node.id in BANNED_NAMES
    return count


if __name__ == "__main__":
    sys.exit(main())
