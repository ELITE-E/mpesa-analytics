#!/usr/bin/env python3
"""Run a Node lint tool without relying on node being on PATH.

Editors often run Git hooks without nvm loaded, so the pinned node from tools/vendor.py comes first.
"""

import os
import shutil
import subprocess
import sys

from _common import REPO

PINNED_NODE = REPO / ".cache" / "bin" / "node"
TOOLS = {
    "eslint": REPO / "node_modules" / "eslint" / "bin" / "eslint.js",
    "prettier": REPO / "node_modules" / "prettier" / "bin" / "prettier.cjs",
}
USAGE_ERROR = 2


def main():
    """Run the named tool with the remaining arguments.

    Returns:
        The tool's exit code, or 2 if the tool is unknown or no node can be found.

    Side Effects:
        Runs the tool as a subprocess, which inherits stdout and stderr.
    """
    tool, *tool_args = sys.argv[1:] or [""]
    if tool not in TOOLS:
        print(f"run_node_tool: ERROR (unknown tool; expected one of {sorted(TOOLS)})")
        return USAGE_ERROR
    node = resolve_node(PINNED_NODE, os.environ.get("PATH", ""))
    if node is None:
        print("run_node_tool: ERROR (node not found; run tools/vendor.py fetch node)")
        return USAGE_ERROR
    return subprocess.run([node, str(TOOLS[tool]), *tool_args]).returncode


def resolve_node(pinned, search_path):
    """Choose the node binary, so hooks use one version wherever they are launched from.

    Args:
        pinned: Path of the pinned binary.
        search_path: PATH value to fall back on.

    Returns:
        Path of the binary to use, or None if there is none.

    Side Effects:
        Checks the filesystem.
    """
    return str(pinned) if pinned.is_file() else shutil.which("node", path=search_path)


if __name__ == "__main__":
    sys.exit(main())
