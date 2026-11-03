import hashlib

import pytest

from conftest import assert_fails_quietly, plant, run_guard
from synth.generate import VERSION

GUARD = "check_fixture_provenance.py"
FIXTURES = "fixtures/synthetic"
ENGINE = "pdfjs 1.2.3"


def digest(content):
    return hashlib.sha256(content).hexdigest()


@pytest.fixture
def tree(tmp_path):
    source = b"%PDF-1.4 planted"
    items = f'{{"engine": "{ENGINE}"}}\n'.encode()
    plant(tmp_path, f"{FIXTURES}/F-A.pdf.source", source)
    plant(tmp_path, f"{FIXTURES}/F-A.items.json", items)
    write_manifest(tmp_path, source=digest(source), items=digest(items))
    return tmp_path


def write_manifest(root, *, source, items, engine=ENGINE):
    from synth.generate import generate

    filler = generate(1, "F-A.pdf.source")
    plant(root, f"{FIXTURES}/F-A.pdf.source", filler)
    source = digest(filler) if source == "current" or source else source
    plant(
        root,
        f"{FIXTURES}/MANIFEST.toml",
        f'generator_version = "{VERSION}"\nfake_password = "synthetic-only"\n\n'
        f'[[fixture]]\npath = "F-A.pdf.source"\nseed = 1\nsha256 = "{digest(filler)}"\n\n'
        f'[[recorded]]\npath = "F-A.items.json"\nsource = "F-A.pdf.source"\n'
        f'source_sha256 = "{source}"\nengine = "{engine}"\nsha256 = "{items}"\n',
    )


def test_recorded_file_matching_its_manifest_entry_passes(tree):
    guard_run = run_guard(GUARD, "--root", tree)
    assert guard_run.returncode == 0, guard_run.stdout


def test_hand_edited_recorded_file_fails(tree):
    target = tree / FIXTURES / "F-A.items.json"
    target.write_bytes(target.read_bytes() + b" ")
    assert_fails_quietly(run_guard(GUARD, "--root", tree), "F-A.items.json")


def test_recording_from_a_different_engine_fails(tree):
    items = (tree / FIXTURES / "F-A.items.json").read_bytes()
    write_manifest(tree, source="current", items=digest(items), engine="pdfjs 9.9.9")
    assert_fails_quietly(run_guard(GUARD, "--root", tree), "F-A.items.json")


def test_recording_from_a_changed_source_fails(tree):
    manifest = tree / FIXTURES / "MANIFEST.toml"
    text = manifest.read_text()
    filler_digest = text.split('source_sha256 = "')[1].split('"')[0]
    manifest.write_text(
        text.replace(f'source_sha256 = "{filler_digest}"', f'source_sha256 = "{"0" * 64}"')
    )
    assert_fails_quietly(run_guard(GUARD, "--root", tree), "F-A.items.json")


def test_missing_recorded_file_fails(tree):
    (tree / FIXTURES / "F-A.items.json").unlink()
    assert_fails_quietly(run_guard(GUARD, "--root", tree), "F-A.items.json")


def test_recorded_path_escaping_the_directory_fails(tree):
    manifest = tree / FIXTURES / "MANIFEST.toml"
    manifest.write_text(
        manifest.read_text().replace('path = "F-A.items.json"', 'path = "../x.json"')
    )
    assert run_guard(GUARD, "--root", tree).returncode == 1


def test_real_repo_recorded_items_pass():
    guard_run = run_guard(GUARD)
    assert guard_run.returncode == 0, guard_run.stdout
