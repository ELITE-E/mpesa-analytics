"""tools/vendor.py runtime: the self-hosted runtime the browser loads, checksummed (CP8a item 2)."""

import hashlib
import json
import shutil
import subprocess
import tomllib

import pytest

from conftest import GUARDS, REPO
from vendor import (
    PDFJS_VERSION,
    PYODIDE_VERSION,
    RUNTIME_SOURCES,
    VENDOR,
    build_runtime,
    runtime_manifest,
    runtime_version,
    verify_runtime,
)

TEST_RUNNER_WHEELS = ("pytest", "pluggy", "iniconfig", "pygments", "setuptools", "attrs")
LOADED_PACKAGES = ("numpy", "pandas", "python_dateutil", "six")
# pandas 3 does not need pytz; Pyodide's lock still lists it, so the runtime's lock drops it (CP8b).
NOT_SHIPPED = ("pytz",)
LOCK = "pyodide/pyodide-lock.json"


@pytest.fixture(scope="module")
def built_runtime(tmp_path_factory, built_wheel):
    root = tmp_path_factory.mktemp("runtime")
    version = build_runtime(built_wheel, runtime_root=root)
    return root, version


def test_the_runtime_holds_pyodide_pdfjs_the_wheel_and_the_analysis_packages_only():
    published = set(RUNTIME_SOURCES)
    for name in ("pyodide.mjs", "pyodide.asm.mjs", "pyodide.asm.wasm", "python_stdlib.zip"):
        assert f"pyodide/{name}" in published
    assert "pyodide/pyodide-lock.json" in published
    assert {"pdfjs/pdf.min.mjs", "pdfjs/pdf.worker.min.mjs"} <= published
    for package in LOADED_PACKAGES:
        assert any(path.startswith(f"pyodide/{package}-") for path in published), package
    for package in TEST_RUNNER_WHEELS + NOT_SHIPPED:
        assert not any(f"/{package}-" in path for path in published), package


def test_the_runtime_lock_is_pyodides_with_pytz_dropped_from_pandas_only(built_runtime):
    root, version = built_runtime
    shipped = json.loads((root / version / LOCK).read_text(encoding="utf-8"))
    pinned = json.loads((VENDOR / LOCK).read_text(encoding="utf-8"))
    assert "pytz" not in shipped["packages"]["pandas"]["depends"]
    assert pinned["packages"]["pandas"]["depends"] == [
        *shipped["packages"]["pandas"]["depends"],
        "pytz",
    ]
    shipped["packages"]["pandas"]["depends"] = pinned["packages"]["pandas"]["depends"]
    assert shipped == pinned


def test_the_runtime_takes_the_browser_build_of_pdfjs_not_the_node_build():
    assert RUNTIME_SOURCES["pdfjs/pdf.min.mjs"] == "pdfjs/pdf.min.mjs"
    assert not any("pdfjs-node" in source for source in RUNTIME_SOURCES.values())


def test_the_manifest_names_the_versions_and_every_file_with_its_sha256_and_size():
    files = {"a.mjs": b"alpha", "core/x.whl": b"wheel"}
    manifest = json.loads(runtime_manifest(files, "core/x.whl"))
    assert manifest["pyodide_version"] == PYODIDE_VERSION == "314.0.7"
    assert manifest["pdfjs_version"] == PDFJS_VERSION == "6.4.299"
    assert manifest["wheel"] == "core/x.whl"
    assert manifest["files"]["a.mjs"] == {
        "sha256": hashlib.sha256(b"alpha").hexdigest(),
        "size": 5,
    }
    assert set(manifest["files"]) == set(files)


def test_the_version_is_the_start_of_the_manifest_digest_so_any_change_moves_it():
    first = runtime_manifest({"a.mjs": b"alpha"}, "core/x.whl")
    second = runtime_manifest({"a.mjs": b"alphb"}, "core/x.whl")
    assert runtime_version(first) == hashlib.sha256(first).hexdigest()[:16]
    assert runtime_version(first) != runtime_version(second)
    assert runtime_manifest({"a.mjs": b"alpha"}, "core/x.whl") == first


def test_a_build_writes_the_version_directory_its_manifest_and_a_pointer(
    built_runtime, built_wheel
):
    root, version = built_runtime
    manifest_bytes = (root / version / "manifest.json").read_bytes()
    assert runtime_version(manifest_bytes) == version
    assert json.loads((root / "current.json").read_text()) == {"version": version}
    manifest = json.loads(manifest_bytes)
    assert manifest["wheel"] == f"core/{built_wheel.name}"
    for path, entry in manifest["files"].items():
        content = (root / version / path).read_bytes()
        assert hashlib.sha256(content).hexdigest() == entry["sha256"], path
        assert len(content) == entry["size"], path


def test_a_build_verifies_and_a_tampered_file_fails_verification(built_runtime, tmp_path):
    root, version = built_runtime
    assert verify_runtime(root) == 0
    copy = tmp_path / "copy"
    shutil.copytree(root, copy)
    target = copy / version / "pdfjs" / "pdf.min.mjs"
    target.write_bytes(target.read_bytes() + b"\n")
    assert verify_runtime(copy) == 1


def test_a_tampered_manifest_fails_verification(built_runtime, tmp_path):
    root, version = built_runtime
    copy = tmp_path / "copy"
    shutil.copytree(root, copy)
    manifest = copy / version / "manifest.json"
    manifest.write_bytes(manifest.read_bytes().replace(b"314.0.7", b"314.0.8"))
    assert verify_runtime(copy) == 1


def test_a_vendored_file_that_differs_from_its_pin_stops_the_build(tmp_path, built_wheel):
    vendor = tmp_path / "vendor"
    shutil.copytree(VENDOR, vendor)
    (vendor / "pyodide" / "pyodide.mjs").write_bytes(b"// not the pinned file\n")
    with pytest.raises(SystemExit):
        build_runtime(built_wheel, runtime_root=tmp_path / "runtime", vendor=vendor)


def test_a_wheel_that_is_not_pure_python_stops_the_build(tmp_path, built_wheel):
    wheel = tmp_path / "mpesa_core-0.0.0-cp314-cp314-linux_x86_64.whl"
    wheel.write_bytes(built_wheel.read_bytes())
    with pytest.raises(SystemExit):
        build_runtime(wheel, runtime_root=tmp_path / "runtime")


def test_a_rebuild_leaves_only_the_current_version(tmp_path, built_wheel):
    root = tmp_path / "runtime"
    (root / "0000000000000000").mkdir(parents=True)
    version = build_runtime(built_wheel, runtime_root=root)
    assert sorted(entry.name for entry in root.iterdir()) == sorted([version, "current.json"])


def test_the_runtime_directory_is_gitignored_and_pruned():
    config = tomllib.loads((GUARDS / "guards.toml").read_text())
    assert "web/public/runtime" in config["walk"]["prune_paths"]
    check = subprocess.run(
        ["git", "check-ignore", "-q", "web/public/runtime/x/file.txt"], cwd=REPO, check=False
    )
    assert check.returncode == 0


def test_ci_builds_the_runtime_after_the_wheel():
    ci = (REPO / ".github/workflows/ci.yml").read_text(encoding="utf-8")
    assert "tools/vendor.py runtime --wheel" in ci
    assert ci.index("uv build --wheel") < ci.index("tools/vendor.py runtime --wheel")


def test_ci_runs_the_engine_in_chrome_after_building_the_runtime():
    ci = (REPO / ".github/workflows/ci.yml").read_text(encoding="utf-8")
    assert "node --test --test-concurrency=1 tests/browser/*.test.js" in ci
    assert ci.index("tools/vendor.py runtime --wheel") < ci.index("tests/browser/*.test.js")
