import json
import subprocess

import pytest

from conftest import REPO, plant

ESLINT = REPO / "node_modules" / ".bin" / "eslint"
PRETTIER = REPO / "node_modules" / ".bin" / "prettier"
DOCUMENTED = "/**\n * Check one row.\n */\n"

STUBS = {
    "jsdoc/require-jsdoc": ("pdf_reader/stub.js", "export function checkRow() {}\n"),
    "jsdoc/require-param": (
        "pdf_reader/stub.js",
        "/**\n * Check one row.\n */\nexport function checkRow(row) {\n  void row;\n}\n",
    ),
    "jsdoc/require-returns": (
        "pdf_reader/stub.js",
        f"{DOCUMENTED}export function checkRow() {{\n  return 1;\n}}\n",
    ),
    "jsdoc/require-throws": (
        "pdf_reader/stub.js",
        f'{DOCUMENTED}export function checkRow() {{\n  throw new Error("page 1");\n}}\n',
    ),
    "max-params": (
        "pdf_reader/stub.js",
        f"{DOCUMENTED}export function checkRow(a1, a2, a3, a4, a5, a6) {{\n"
        "  void [a1, a2, a3, a4, a5, a6];\n}\n",
    ),
    "complexity": (
        "pdf_reader/stub.js",
        f"{DOCUMENTED}export function checkRow(row) {{\n"
        + "".join(f"  if (row === {i}) void row;\n" for i in range(11))
        + "}\n",
    ),
    "max-depth": (
        "pdf_reader/stub.js",
        f"{DOCUMENTED}export function checkRow(row) {{\n"
        "  if (row) { if (row) { if (row) { if (row) { void row; } } } }\n}\n",
    ),
    "no-empty": ("pdf_reader/stub.js", "if (globalThis) {\n}\n"),
    "no-console": ("pdf_reader/stub.js", 'console.log("page 1");\n'),
    "id-denylist": ("pdf_reader/stub.js", "export const result = 1;\n"),
    "id-length": ("pdf_reader/stub.js", "export const q = 1;\n"),
    "@typescript-eslint/no-explicit-any": (
        "pdf_reader/stub.ts",
        "export const rowCount = 1 as any;\n",
    ),
}


def eslint(root, *targets):
    completed = subprocess.run(
        [str(ESLINT), "--config", str(REPO / "eslint.config.mjs"), "--format", "json", *targets],
        cwd=root,
        capture_output=True,
        text=True,
    )
    return completed, {
        message["ruleId"]
        for file_report in json.loads(completed.stdout or "[]")
        for message in file_report["messages"]
    }


@pytest.mark.parametrize("rule", STUBS.keys())
def test_pdf_reader_stub_violating_each_rule_fails(tmp_path, rule):
    rel, source = STUBS[rule]
    plant(tmp_path, rel, source)
    completed, rules = eslint(tmp_path, rel)
    assert completed.returncode == 1, completed.stderr
    assert rule in rules


def test_nested_function_needs_jsdoc(tmp_path):
    source = (
        f"{DOCUMENTED}export function checkRow() {{\n"
        "  const inner = () => undefined;\n  void inner;\n}\n"
    )
    plant(tmp_path, "pdf_reader/stub.js", source)
    assert "jsdoc/require-jsdoc" in eslint(tmp_path, "pdf_reader/stub.js")[1]


def test_compliant_pdf_reader_stub_passes(tmp_path):
    source = (
        "/**\n * Count the rows on one page.\n * @param {object[]} rows Page rows.\n"
        " * @returns {number} Row count.\n */\n"
        "export function countRows(rows) {\n  return rows.length;\n}\n"
    )
    plant(tmp_path, "pdf_reader/stub.js", source)
    completed, rules = eslint(tmp_path, "pdf_reader/stub.js")
    assert completed.returncode == 0, rules


def test_console_is_allowed_outside_pdf_reader(tmp_path):
    plant(tmp_path, "web/probe/stub.js", 'console.log("page 1");\n')
    assert "no-console" not in eslint(tmp_path, "web/probe/stub.js")[1]


def prettier_check(root, rel):
    return subprocess.run(
        [str(PRETTIER), "--config", str(REPO / "prettier.config.mjs"), "--check", rel],
        cwd=root,
        capture_output=True,
        text=True,
    )


def test_prettier_rejects_unformatted_code(tmp_path):
    plant(tmp_path, "pdf_reader/stub.js", "export const rowCount   =  1\n")
    assert prettier_check(tmp_path, "pdf_reader/stub.js").returncode == 1


def test_prettier_accepts_formatted_code(tmp_path):
    plant(tmp_path, "pdf_reader/stub.js", "export const rowCount = 1;\n")
    assert prettier_check(tmp_path, "pdf_reader/stub.js").returncode == 0


def test_real_repo_eslint_is_clean():
    completed = subprocess.run([str(ESLINT), "."], cwd=REPO, capture_output=True, text=True)
    assert completed.returncode == 0, completed.stdout[:2000]
