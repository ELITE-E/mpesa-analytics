#!/usr/bin/env python3
"""Check that every function states its contract (docs/CODING_STANDARDS.md, section 3)."""

import ast
import re
import sys

from _common import iter_files, parse_root, report

SOURCE_ROOTS = ("src/", "tools/", "pdf_reader/", "web/")
FUNCTIONS = (ast.FunctionDef, ast.AsyncFunctionDef)
SCOPES = (*FUNCTIONS, ast.Lambda, ast.ClassDef)
RECEIVERS = {"self", "cls"}
# Words that add nothing to a first line, so a line made only of these and the name is empty.
FILLER_WORDS = {
    "a",
    "an",
    "the",
    "this",
    "that",
    "function",
    "method",
    "helper",
    "todo",
    "fixme",
    "tbd",
    "stub",
    "docstring",
    "placeholder",
}
MIN_PLURAL_LENGTH = 4


def main():
    """Check every Python function in the source roots.

    Returns:
        Process exit code: 1 when a function falls short, otherwise 0.

    Side Effects:
        Reads the sources and writes the report to stdout.
    """
    args = parse_root(__doc__).parse_args()
    findings = {}
    for rel in iter_files(args.root):
        if rel.startswith(SOURCE_ROOTS) and rel.endswith(".py"):
            count = count_problems((args.root / rel).read_bytes())
            if count:
                findings[rel] = count
    return report("check_function_docstrings", findings, "function(s) short of the contract")


def count_problems(source):
    """Count the functions in one module that do not state their contract.

    Args:
        source: Module source as bytes.

    Returns:
        Number of failing functions; an unparsable module counts as one.

    Side Effects:
        None.
    """
    try:
        tree = ast.parse(source)
    except SyntaxError, ValueError:
        return 1  # Fail closed: an unparsable file cannot be shown to comply.
    functions = [node for node in ast.walk(tree) if isinstance(node, FUNCTIONS)]
    return sum(not states_contract(function) for function in functions)


def states_contract(function):
    """Decide whether one function's docstring meets the standard.

    Args:
        function: The function's AST node.

    Returns:
        True if it states a purpose and has every section that applies.

    Side Effects:
        None.
    """
    docstring = ast.get_docstring(function)
    if not docstring or restates_name(function.name, docstring.splitlines()[0]):
        return False
    return all(f"{section}:" in docstring for section in required_sections(function))


def restates_name(name, first_line):
    """Detect a first line that only repeats the function's name.

    Args:
        name: Function name.
        first_line: First line of its docstring.

    Returns:
        True if the line has no word beyond the name and filler.

    Side Effects:
        None.
    """
    name_words = {_stem(word) for word in _words(name)}
    line_words = {_stem(word) for word in _words(first_line)} - FILLER_WORDS
    return line_words <= name_words


def required_sections(function):
    """List the docstring sections that apply to a function.

    Args:
        function: The function's AST node.

    Returns:
        Section names; ``Side Effects`` always applies.

    Side Effects:
        None.
    """
    sections = ["Side Effects"]
    if _parameters(function) - RECEIVERS:
        sections.append("Args")
    body_nodes = _own_scope_nodes(function)
    if any(_returns_a_value(node) for node in body_nodes):
        sections.append("Returns")
    if any(isinstance(node, (ast.Yield, ast.YieldFrom)) for node in body_nodes):
        sections.append("Yields")
    if any(isinstance(node, ast.Raise) for node in body_nodes):
        sections.append("Raises")
    return sections


def _words(text):
    """Split text or an identifier into lowercase words.

    Args:
        text: Text, snake_case or camelCase.

    Returns:
        Lowercase alphanumeric words.

    Side Effects:
        None.
    """
    return re.findall(r"[a-z0-9]+", re.sub(r"(?<=[a-z0-9])(?=[A-Z])", " ", text).lower())


def _stem(word):
    """Remove a plural or third-person ending so ``counts`` matches ``count``.

    Args:
        word: Lowercase word.

    Returns:
        The word without a trailing ``s``.

    Side Effects:
        None.
    """
    return word[:-1] if word.endswith("s") and len(word) >= MIN_PLURAL_LENGTH else word


def _parameters(function):
    """Collect every parameter name of a function.

    Args:
        function: The function's AST node.

    Returns:
        Set of parameter names, including ``*args`` and ``**kwargs``.

    Side Effects:
        None.
    """
    spec = function.args
    named = [*spec.posonlyargs, *spec.args, *spec.kwonlyargs, spec.vararg, spec.kwarg]
    return {parameter.arg for parameter in named if parameter is not None}


def _own_scope_nodes(function):
    """Walk a function's body without entering nested functions or classes.

    Args:
        function: The function's AST node.

    Returns:
        Every AST node that belongs to this function's own scope.

    Side Effects:
        None.
    """
    nodes = []
    pending = list(function.body)
    while pending:
        node = pending.pop()
        nodes.append(node)
        if not isinstance(node, SCOPES):
            pending.extend(ast.iter_child_nodes(node))
    return nodes


def _returns_a_value(node):
    """Tell a value return from a bare ``return`` or ``return None``.

    Args:
        node: Any AST node.

    Returns:
        True if the node returns a value.

    Side Effects:
        None.
    """
    if not isinstance(node, ast.Return) or node.value is None:
        return False
    return not (isinstance(node.value, ast.Constant) and node.value.value is None)


if __name__ == "__main__":
    sys.exit(main())
