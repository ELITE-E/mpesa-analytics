import hashlib
import importlib.util

import pytest

from conftest import REPO, assert_fails_quietly, plant, run_guard

GUARD = "check_fixture_provenance.py"
FIXTURES = "tests/fixtures/synthetic"


def stub():
    spec = importlib.util.spec_from_file_location(
        "synth_generate", REPO / "tools" / "synth" / "generate.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def manifest(entries, version):
    lines = [f'generator_version = "{version}"', 'fake_password = "synthetic-only"', ""]
    for path, seed, digest in entries:
        lines += ["[[fixture]]", f'path = "{path}"', f"seed = {seed}", f'sha256 = "{digest}"', ""]
    return "\n".join(lines)


@pytest.fixture
def tree(tmp_path):
    gen = stub()
    fixture_bytes = gen.generate(7, "dummy.txt")
    plant(tmp_path, f"{FIXTURES}/dummy.txt", fixture_bytes)
    plant(
        tmp_path,
        f"{FIXTURES}/MANIFEST.toml",
        manifest([("dummy.txt", 7, hashlib.sha256(fixture_bytes).hexdigest())], gen.VERSION),
    )
    return tmp_path


def test_generator_is_deterministic_and_seed_sensitive():
    gen = stub()
    assert gen.generate(7, "a.txt") == gen.generate(7, "a.txt")
    assert gen.generate(7, "a.txt") != gen.generate(8, "a.txt")


def test_matching_fixture_passes(tree):
    guard_run = run_guard(GUARD, "--root", tree)
    assert guard_run.returncode == 0, guard_run.stdout


def test_hand_edited_fixture_fails(tree):
    target = tree / FIXTURES / "dummy.txt"
    target.write_bytes(target.read_bytes() + b"edited")
    assert_fails_quietly(run_guard(GUARD, "--root", tree), "dummy.txt", "edited")


def test_hand_edit_with_matching_manifest_hash_still_fails(tree):
    target = tree / FIXTURES / "dummy.txt"
    old = hashlib.sha256(target.read_bytes()).hexdigest()
    target.write_bytes(b"edited")
    path = tree / FIXTURES / "MANIFEST.toml"
    path.write_text(path.read_text().replace(old, hashlib.sha256(b"edited").hexdigest()))
    assert_fails_quietly(run_guard(GUARD, "--root", tree), "dummy.txt")


def test_changed_seed_fails(tree):
    path = tree / FIXTURES / "MANIFEST.toml"
    path.write_text(path.read_text().replace("seed = 7", "seed = 8"))
    assert_fails_quietly(run_guard(GUARD, "--root", tree), "dummy.txt")


def test_generator_version_mismatch_fails(tree):
    path = tree / FIXTURES / "MANIFEST.toml"
    path.write_text(path.read_text().replace(stub().VERSION, "not-this-version"))
    assert_fails_quietly(run_guard(GUARD, "--root", tree), "MANIFEST.toml")


def test_missing_fixture_fails(tree):
    (tree / FIXTURES / "dummy.txt").unlink()
    assert_fails_quietly(run_guard(GUARD, "--root", tree), "dummy.txt")


def test_unmanifested_file_fails(tree):
    plant(tree, f"{FIXTURES}/sub/extra.txt", "hand made")
    assert_fails_quietly(run_guard(GUARD, "--root", tree), "sub/extra.txt", "hand made")


def test_path_escaping_fixtures_dir_fails(tree):
    plant(tree, "outside.txt", "x")
    path = tree / FIXTURES / "MANIFEST.toml"
    path.write_text(path.read_text().replace('path = "dummy.txt"', 'path = "../../outside.txt"'))
    assert run_guard(GUARD, "--root", tree).returncode == 1


def test_missing_manifest_fails(tree):
    (tree / FIXTURES / "MANIFEST.toml").unlink()
    assert_fails_quietly(run_guard(GUARD, "--root", tree), "MANIFEST.toml")


def test_real_repo_passes():
    guard_run = run_guard(GUARD)
    assert guard_run.returncode == 0, guard_run.stdout
