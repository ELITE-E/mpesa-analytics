#!/usr/bin/env python3
"""Reject generic, single-letter and banned vocabulary names in Python code."""

import ast
import sys
import tomllib
from pathlib import Path

from _common import CONFIG_PATH, iter_files, parse_root, report

SOURCE_ROOTS = ("src/", "tools/", "pdf_reader/", "web/", "tests/")


def main():
    """Check every Python file against the name lists in guards.toml.

    Returns:
        Process exit code: 1 on any violation, otherwise 0.

    Side Effects:
        Reads the configuration and sources, and writes the report to stdout.
    """
    parser = parse_root(__doc__)
    parser.add_argument("--config", type=Path, default=CONFIG_PATH)
    args = parser.parse_args()
    names = tomllib.loads(args.config.read_text(encoding="utf-8"))["names"]
    findings = {}
    allow_entries = names.get("allow", [])
    unreasoned = _count_unreasoned(allow_entries)
    if unreasoned:
        findings[args.config.name] = unreasoned
    for rel in iter_files(args.root):
        if rel.startswith(SOURCE_ROOTS) and rel.endswith(".py"):
            source = (args.root / rel).read_bytes()
            allowed = {entry["name"] for entry in allow_entries if entry["path"] == rel}
            count = count_violations(source, names, allowed)
            if count:
                findings[rel] = count
    return report("check_banned_names", findings, "banned name(s)")


def count_violations(source, names, allowed):
    """Count the banned names in one module.

    Args:
        source: Module source as bytes.
        names: The ``[names]`` table from guards.toml.
        allowed: Names this file may use under the allowlist.

    Returns:
        Number of violations; an unparsable module counts as one.

    Side Effects:
        None.
    """
    try:
        tree = ast.parse(source)
    except SyntaxError, ValueError:
        return 1  # Fail closed: an unparsable file cannot be shown to comply.
    loop_targets = _loop_target_ids(tree)
    generic = set(names["generic"]) - allowed
    letters = set(names["loop_letters"])
    vocabulary = set(names["banned_names"]) - allowed
    count = 0
    for node in ast.walk(tree):
        count += sum(identifier in vocabulary for identifier in _identifiers(node))
        for name in _bound_names(node):
            if name not in allowed and _is_banned_binding(
                name, generic=generic, letters=letters if id(node) in loop_targets else set()
            ):
                count += 1
    return count


def _count_unreasoned(entries):
    """Count allowlist entries that give no reason.

    Args:
        entries: The ``[[names.allow]]`` entries.

    Returns:
        Number of entries with a missing or blank reason.

    Side Effects:
        None.
    """
    return sum(not entry.get("reason", "").strip() for entry in entries)


def _is_banned_binding(name, *, generic, letters):
    """Apply the generic and single-letter rules to one bound name.

    Args:
        name: The bound name.
        generic: Generic names to reject.
        letters: Single letters allowed at this binding, empty outside loops.

    Returns:
        True if the name is banned here.

    Side Effects:
        None.
    """
    if name in generic:
        return True
    return len(name) == 1 and name.isalpha() and name not in letters


def _loop_target_ids(tree):
    """Find the names bound as loop or comprehension variables.

    Args:
        tree: Parsed module.

    Returns:
        Set of ``id()`` values of those Name nodes.

    Side Effects:
        None.
    """
    targets = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.For, ast.AsyncFor, ast.comprehension)):
            targets.update(
                id(child) for child in ast.walk(node.target) if isinstance(child, ast.Name)
            )
    return targets


def _bound_names(node):
    """List the names one AST node binds.

    Args:
        node: Any AST node.

    Returns:
        Names bound by this node, which may be empty.

    Side Effects:
        None.
    """
    match node:
        case ast.FunctionDef() | ast.AsyncFunctionDef() | ast.ClassDef():
            return [node.name]
        case ast.arg():
            return [node.arg]
        case ast.Name(ctx=ast.Store()):
            return [node.id]
        case ast.Attribute(ctx=ast.Store()):
            return [node.attr]
        case ast.ExceptHandler(name=str()):
            return [node.name]
        case ast.alias():
            return [node.asname or node.name.partition(".")[0]]
    return []


def _identifiers(node):
    """List every identifier one AST node mentions, whether binding or using it.

    Args:
        node: Any AST node.

    Returns:
        Identifiers at this node, which may be empty.

    Side Effects:
        None.
    """
    match node:
        case ast.Name():
            return [node.id]
        case ast.Attribute():
            return [node.attr]
        case ast.keyword(arg=str()):
            return [node.arg]
        case ast.alias():
            return [node.name.rpartition(".")[2], node.asname]
    return _bound_names(node)


if __name__ == "__main__":
    sys.exit(main())
