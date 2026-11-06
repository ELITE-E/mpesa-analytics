import zipfile

import pytest

from conftest import run_guard

GUARD = "check_wheel.py"
GOOD = ["mpesa_core/__init__.py", "mpesa_core-0.0.0.dist-info/METADATA"]


def wheel(tmp_path, name="mpesa_core-0.0.0-py3-none-any.whl", entries=GOOD):
    path = tmp_path / name
    with zipfile.ZipFile(path, "w") as archive:
        for entry in entries:
            archive.writestr(entry, "")
    return path


def test_good_wheel_passes(tmp_path):
    guard_run = run_guard(GUARD, wheel(tmp_path))
    assert guard_run.returncode == 0, guard_run.stdout


@pytest.mark.parametrize(
    "name",
    [
        "mpesa_core-0.0.0-cp314-cp314-linux_x86_64.whl",
        "mpesa_core-0.0.0-py2.py3-none-any.whl",
        "other-0.0.0-py3-none-any.whl",
    ],
)
def test_wrong_name_or_tag_fails(tmp_path, name):
    guard_run = run_guard(GUARD, wheel(tmp_path, name=name))
    assert guard_run.returncode == 1
    assert name in guard_run.stdout


@pytest.mark.parametrize(
    "extra",
    [
        "tools/guards/x.py",
        "tests/fixtures/synthetic/a.pdf",
        "stray.py",
        "mpesa_core-0.0.0.data/scripts/x",
    ],
)
def test_extra_content_fails(tmp_path, extra):
    guard_run = run_guard(GUARD, wheel(tmp_path, entries=[*GOOD, extra]))
    assert guard_run.returncode == 1
    assert "1 " in guard_run.stdout


def test_wheel_without_package_fails(tmp_path):
    entries = ["mpesa_core-0.0.0.dist-info/METADATA"]
    assert run_guard(GUARD, wheel(tmp_path, entries=entries)).returncode == 1


def test_no_wheel_given_fails():
    assert run_guard(GUARD).returncode == 1
