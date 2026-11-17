"""tools/measure_bundle.py: the download budget, enforced on the runtime the browser loads (CP8a-2).

Budgets from ADR 0006: 15 MB gzip with pandas, 8 MB without. Measured over the built runtime's
files, gzip -9, so what is counted is exactly what ships. CP8b item 7: the frontend's static export
(pages, Next's chunks, the engine's files) counts towards both.
"""

import subprocess
import sys

import pytest

from conftest import REPO
from measure_bundle import (
    BUDGET_WITH_PANDAS,
    BUDGET_WITHOUT_PANDAS,
    is_analysis_file,
    measure_app,
    measure_runtime,
)
from vendor import build_runtime

TOOL = REPO / "tools" / "measure_bundle.py"


@pytest.fixture(scope="module")
def runtime_root(tmp_path_factory, built_wheel):
    root = tmp_path_factory.mktemp("runtime")
    build_runtime(built_wheel, runtime_root=root)
    return root


def run_tool(runtime_root, *options):
    return subprocess.run(
        [sys.executable, str(TOOL), "--runtime", str(runtime_root), *options],
        capture_output=True,
        text=True,
        check=False,
    )


def test_the_budgets_are_15_mb_with_pandas_and_8_mb_without():
    assert BUDGET_WITH_PANDAS == 15_000_000
    assert BUDGET_WITHOUT_PANDAS == 8_000_000


def test_the_analysis_files_are_numpy_pandas_and_its_dependencies():
    for path in (
        "pyodide/numpy-2.4.6-cp314-cp314-pyemscripten_2026_0_wasm32.whl",
        "pyodide/pandas-3.0.2-cp314-cp314-pyemscripten_2026_0_wasm32.whl",
        "pyodide/python_dateutil-2.9.0.post0-py2.py3-none-any.whl",
        "pyodide/six-1.17.0-py2.py3-none-any.whl",
    ):
        assert is_analysis_file(path), path
    for path in (
        "pyodide/pyodide.asm.wasm",
        "pdfjs/pdf.min.mjs",
        "core/mpesa_core-0.0.0-py3-none-any.whl",
    ):
        assert not is_analysis_file(path), path


def test_the_shipped_runtime_is_within_both_budgets(runtime_root):
    totals = measure_runtime(runtime_root)
    assert 0 < totals["without_pandas_gzip"] < totals["with_pandas_gzip"]
    assert totals["with_pandas_gzip"] <= BUDGET_WITH_PANDAS
    assert totals["without_pandas_gzip"] <= BUDGET_WITHOUT_PANDAS


def test_the_tool_passes_and_prints_counts_within_budget(runtime_root):
    completed = run_tool(runtime_root)
    assert completed.returncode == 0, completed.stdout
    assert "bundle_budget: PASS" in completed.stdout
    assert "NOT ENFORCED" not in completed.stdout


@pytest.mark.parametrize("option", ["--with-pandas-budget", "--without-pandas-budget"])
def test_the_tool_fails_when_a_budget_is_exceeded(runtime_root, option):
    completed = run_tool(runtime_root, option, "1")
    assert completed.returncode == 1
    assert "bundle_budget: FAIL" in completed.stdout


def fake_app(root):
    """A static export: two pages, a chunk, the engine, and a runtime folder never counted here."""
    files = {
        "index.html": b"<html>" + b"a" * 2000,
        "_next/static/chunks/app.js": b"x" * 5000,
        "pdf_reader/engine_client.js": b"y" * 300,
        "runtime/0000/pyodide.asm.wasm": b"z" * 9000,
        "runtime/current.json": b'{"version": "0000"}',
    }
    for path, content in files.items():
        (root / path).parent.mkdir(parents=True, exist_ok=True)
        (root / path).write_bytes(content)
    return files


def test_the_app_is_every_exported_file_outside_the_runtime(tmp_path):
    files = fake_app(tmp_path)
    totals = measure_app(tmp_path)
    counted = [path for path in files if not path.startswith("runtime/")]
    assert totals["app_raw"] == sum(len(files[path]) for path in counted)
    assert 0 < totals["app_gzip"] < totals["app_raw"]
    assert totals["app_files"] == len(counted)


def test_the_tool_adds_the_app_to_both_totals(runtime_root, tmp_path):
    fake_app(tmp_path)
    alone = run_tool(runtime_root)
    together = run_tool(runtime_root, "--app", str(tmp_path))
    app = measure_app(tmp_path)

    def gzip_total(output, name):
        line = next(line for line in output.splitlines() if line.startswith(f"{name}:"))
        return int(line.split("gzip=")[1])

    for name in ("with_pandas", "without_pandas"):
        added = gzip_total(together.stdout, name) - gzip_total(alone.stdout, name)
        assert added == app["app_gzip"], name
    app_line = f"app: files={app['app_files']} raw={app['app_raw']} gzip={app['app_gzip']}"
    assert app_line in together.stdout
    assert together.returncode == 0


def test_the_tool_refuses_an_app_folder_that_was_not_built(runtime_root, tmp_path):
    completed = run_tool(runtime_root, "--app", str(tmp_path / "missing"))
    assert completed.returncode == 2
    assert "bundle_budget" not in completed.stdout


def test_with_a_fetched_list_only_the_files_a_visit_downloaded_count(tmp_path):
    files = fake_app(tmp_path)
    fetched = ["/", "/_next/static/chunks/app.js", "/runtime/0000/pyodide.asm.wasm", "/missing.js"]
    totals = measure_app(tmp_path, fetched=fetched)
    # Pages are fetched by their folder; the runtime is counted from its manifest; a path the
    # export does not hold (a 404) adds nothing.
    assert totals["app_files"] == 2
    assert totals["app_raw"] == len(files["index.html"]) + len(files["_next/static/chunks/app.js"])


def test_the_tool_reads_the_fetched_list_from_a_file(runtime_root, tmp_path):
    app = tmp_path / "app"
    app.mkdir()
    fake_app(app)
    fetched = tmp_path / "fetched.json"
    fetched.write_text('["/", "/pdf_reader/engine_client.js"]', encoding="utf-8")
    completed = run_tool(runtime_root, "--app", str(app), "--fetched", str(fetched))
    expected = measure_app(app, fetched=["/", "/pdf_reader/engine_client.js"])
    assert f"app: files={expected['app_files']} " in completed.stdout
    assert "app_measured: fetched by a visit" in completed.stdout
    assert completed.returncode == 0


def test_ci_enforces_the_budget_after_building_the_runtime_and_the_app():
    ci = (REPO / ".github/workflows/ci.yml").read_text(encoding="utf-8")
    assert "tools/measure_app_download.mjs" in ci
    assert "tools/measure_bundle.py --app web/out --fetched" in ci
    assert ci.index("tools/measure_app_download.mjs") < ci.index("tools/measure_bundle.py")
    assert ci.index("tools/vendor.py runtime --wheel") < ci.index("npm run build --prefix web")
    assert ci.index("npm run build --prefix web") < ci.index("tools/measure_bundle.py")
