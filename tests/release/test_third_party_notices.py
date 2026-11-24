"""CP10b item 3: THIRD_PARTY_NOTICES.md, from the lockfiles, names a licence per dependency.

The npm lockfiles carry each package's licence; uv.lock does not, so the generator reads it from
the installed metadata. The browser runtime's lockfile is Pyodide's pyodide-lock.json, and its
wheels carry their own metadata.
"""

import json
import re
import subprocess
import sys
import tomllib

import pytest

from conftest import REPO

SCRIPT = REPO / "tools" / "release" / "third_party_notices.py"
NOTICES = REPO / "THIRD_PARTY_NOTICES.md"
ROW = re.compile(r"^\| (?P<name>[^|]+?) \| (?P<version>[^|]+?) \| (?P<licence>[^|]+?) \|")


def sections():
    """The notices' table rows under each '### ' heading."""
    found, heading = {}, None
    for line in NOTICES.read_text(encoding="utf-8").splitlines():
        if line.startswith("### "):
            heading = line[4:].strip()
            found[heading] = []
        match = ROW.match(line)
        if heading and match and match["name"] not in ("Package", "Component", "---"):
            found[heading].append(match.groupdict())
    return found


def section(prefix):
    matching = [rows for heading, rows in sections().items() if heading.startswith(prefix)]
    assert len(matching) == 1, f"one section starting {prefix!r}: {list(sections())}"
    return matching[0]


def npm_packages(lockfile, *, dev):
    packages = json.loads((REPO / lockfile).read_text(encoding="utf-8"))["packages"]
    return {
        (path.rsplit("node_modules/", 1)[-1], entry["version"], entry["license"])
        for path, entry in packages.items()
        if path and bool(entry.get("dev")) == dev
    }


def test_the_notices_are_up_to_date_with_the_lockfiles():
    run = subprocess.run(
        [sys.executable, str(SCRIPT), "--check"], capture_output=True, text=True, cwd=REPO
    )
    assert run.returncode == 0, run.stdout + run.stderr


def test_a_stale_notices_file_fails_the_check(tmp_path):
    stale = tmp_path / "NOTICES.md"
    stale.write_text("# Third-party notices\n", encoding="utf-8")
    run = subprocess.run(
        [sys.executable, str(SCRIPT), "--check", "--path", str(stale)],
        capture_output=True,
        text=True,
        cwd=REPO,
    )
    assert run.returncode == 1
    assert "out of date" in run.stdout


@pytest.mark.parametrize(
    ("lockfile", "dev", "heading"),
    [
        ("web/package-lock.json", False, "The web app"),
        ("web/package-lock.json", True, "web/package-lock.json"),
        ("package-lock.json", True, "package-lock.json"),
    ],
)
def test_every_npm_package_is_listed_with_its_lockfile_licence(lockfile, dev, heading):
    listed = {(row["name"], row["version"], row["licence"]) for row in section(heading)}
    missing = npm_packages(lockfile, dev=dev) - listed
    assert not missing, sorted(missing)[:5]


def test_every_python_package_in_uv_lock_is_listed_with_a_licence():
    lock = tomllib.loads((REPO / "uv.lock").read_text(encoding="utf-8"))
    rows = {(row["name"], row["version"]): row["licence"] for row in section("uv.lock")}
    for package in lock["package"]:
        if package["name"] == "mpesa-core":
            continue
        key = (package["name"], package["version"])
        assert key in rows, key
        assert rows[key].strip() and "UNKNOWN" not in rows[key], key


def test_the_shipped_runtime_is_listed_with_licences():
    names = {row["name"]: row["licence"] for row in section("The statement engine")}
    for component in ("Pyodide", "CPython standard library", "pdf.js", "numpy", "pandas"):
        assert component in names, component
    for component in ("python-dateutil", "six"):
        assert component in names, component
    assert names["pdf.js"] == "Apache-2.0"
    assert all(licence.strip() and "UNKNOWN" not in licence for licence in names.values())


def test_the_web_apps_shipped_packages_include_the_framework():
    names = {row["name"] for row in section("The web app")}
    assert {"next", "react", "react-dom"} <= names
