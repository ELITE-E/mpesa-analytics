import hashlib
import io
import json
import re
import subprocess
import sys
import tomllib

import pdfplumber
import pytest

from conftest import REPO, run_guard
from synth.generate import generate
from vendor import PDFJS_VERSION

FIXTURES = REPO / "tests" / "fixtures" / "synthetic"
GENERATOR = REPO / "tools" / "synth" / "generate.py"
COMMITTED = [
    "F-GOLDEN",
    "F-ENCRYPTED",
    "F-TIES",
    "F-SPLIT",
    "F-DENSE",
    "F-MANY-PAGES",
    "F-BASIC",
    "F-MULTILINE",
    "F-MULTIPAGE",
    "F-NOTABLE",
    "F-JITTER",
    "F-CONT-ABOVE",
    "F-SUMMARY-MISMATCH",
    "F-CHAIN-BREAK",
]
SUFFIXES = [".pdf", ".model.json", ".expected.json"]
ALL_FILES = [f"{name}{suffix}" for name in COMMITTED for suffix in SUFFIXES]
ONE_STRING_TIME = re.compile(r"^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$")


def manifest():
    return tomllib.loads((FIXTURES / "MANIFEST.toml").read_text(encoding="utf-8"))


def expected(name):
    return json.loads((FIXTURES / f"{name}.expected.json").read_text(encoding="utf-8"))


def statement_pages(name):
    return json.loads((FIXTURES / f"{name}.items.json").read_text(encoding="utf-8"))


def run_generator(*args):
    return subprocess.run(
        [sys.executable, str(GENERATOR), *map(str, args)], capture_output=True, text=True
    )


@pytest.mark.parametrize("rel", ALL_FILES)
def test_every_committed_output_exists(rel):
    assert (FIXTURES / rel).is_file()


def test_manifest_lists_exactly_the_committed_outputs():
    assert sorted(entry["path"] for entry in manifest()["fixture"]) == sorted(ALL_FILES)


def test_manifest_records_seed_version_hash_and_fake_password():
    content = manifest()
    assert content["generator_version"]
    assert content["fake_password"]
    for entry in content["fixture"]:
        assert isinstance(entry["seed"], int)
        digest = hashlib.sha256((FIXTURES / entry["path"]).read_bytes()).hexdigest()
        assert entry["sha256"] == digest


def test_all_outputs_of_a_fixture_share_a_seed():
    seeds = {}
    for entry in manifest()["fixture"]:
        seeds.setdefault(entry["path"].split(".")[0], set()).add(entry["seed"])
    assert all(len(values) == 1 for values in seeds.values())


@pytest.mark.parametrize(
    "entry",
    tomllib.loads((FIXTURES / "MANIFEST.toml").read_text())["fixture"],
    ids=lambda entry: entry["path"],
)
def test_regenerating_from_the_seed_is_byte_identical(entry):
    assert generate(entry["seed"], entry["path"]) == (FIXTURES / entry["path"]).read_bytes()


def test_fixture_provenance_guard_passes():
    guard_run = run_guard("check_fixture_provenance.py")
    assert guard_run.returncode == 0, guard_run.stdout


def test_pattern_guard_passes_on_the_fixtures():
    guard_run = run_guard("scan_patterns.py")
    assert guard_run.returncode == 0, guard_run.stdout


def test_golden_has_about_sixty_rows():
    assert 55 <= expected("F-GOLDEN")["row_count"] <= 65


def test_golden_has_fees():
    golden = expected("F-GOLDEN")
    assert float(golden["total_fees"]) > 0
    assert golden["same_second_pairs"]


def test_golden_has_multi_line_details():
    tops = sorted(
        text_item["top"] for text_item in statement_pages("F-GOLDEN")["pages"][0]["items"]
    )
    gaps = {round(lower - upper, 3) for upper, lower in zip(tops, tops[1:], strict=False)}
    assert 6.0 in gaps


def test_golden_has_a_clean_chain():
    assert expected("F-GOLDEN")["chain_breaks"] == 0


def test_encrypted_fixture_opens_only_with_the_manifest_password():
    content = (FIXTURES / "F-ENCRYPTED.pdf").read_bytes()
    with pytest.raises(pdfplumber.utils.exceptions.PdfminerException):
        pdfplumber.open(io.BytesIO(content))
    with pdfplumber.open(io.BytesIO(content), password=manifest()["fake_password"]) as pdf:
        assert pdf.pages[0].extract_words()


def test_ties_fixture_has_both_print_orders():
    assert set(expected("F-TIES")["same_second_pairs"]) == {"fee_first", "parent_first"}


def test_ties_fixture_pairs_share_a_receipt_and_a_second():
    rows = expected("F-TIES")["rows"]
    for upper, lower in zip(rows[::2], rows[1::2], strict=True):
        assert upper["completion_time"] == lower["completion_time"]
        assert upper["receipt_no"] == lower["receipt_no"]


def test_ties_fixture_has_a_tie_at_the_latest_time():
    ties = expected("F-TIES")
    rows = ties["rows"]
    assert rows[0]["completion_time"] == rows[1]["completion_time"]
    assert ties["closing_balance"] == rows[0]["balance"].replace(",", "")
    assert rows[0]["balance"] != rows[1]["balance"]


def test_ties_fixture_chain_holds_in_print_order():
    assert expected("F-TIES")["chain_breaks"] == 0


def test_split_fixture_never_prints_date_and_time_as_one_string():
    for page in statement_pages("F-SPLIT")["pages"]:
        assert not any(ONE_STRING_TIME.match(text_item["text"]) for text_item in page["items"])


def test_split_fixture_rows_still_hold_the_whole_time():
    assert all(ONE_STRING_TIME.match(row["completion_time"]) for row in expected("F-SPLIT")["rows"])


def test_large_fixture_is_not_committed():
    assert not list(FIXTURES.glob("F-LARGE*"))


def test_large_fixture_is_generated_on_demand(tmp_path):
    completed = run_generator("--name", "F-LARGE", "--out-dir", tmp_path)
    assert completed.returncode == 0, completed.stderr
    large = json.loads((tmp_path / "F-LARGE.expected.json").read_text(encoding="utf-8"))
    assert large["row_count"] == 5700
    assert large["chain_breaks"] == 0
    assert (tmp_path / "F-LARGE.pdf").read_bytes().startswith(b"%PDF")


def test_writing_fixtures_reproduces_the_committed_directory(tmp_path):
    completed = run_generator("--write-fixtures", tmp_path)
    assert completed.returncode == 0, completed.stderr
    for rel in [*ALL_FILES, "MANIFEST.toml"]:
        assert (tmp_path / rel).read_bytes() == (FIXTURES / rel).read_bytes()


def test_command_line_builds_a_custom_statement(tmp_path):
    completed = run_generator(
        "--name",
        "T-CUSTOM",
        "--seed",
        5,
        "--rows",
        12,
        "--split-datetime",
        "--password",
        "synthetic-only",
        "--out-dir",
        tmp_path,
    )
    assert completed.returncode == 0, completed.stderr
    assert json.loads((tmp_path / "T-CUSTOM.expected.json").read_text())["row_count"] == 12
    with pytest.raises(pdfplumber.utils.exceptions.PdfminerException):
        pdfplumber.open(tmp_path / "T-CUSTOM.pdf")


def test_command_line_prints_only_file_names_and_counts(tmp_path):
    completed = run_generator("--name", "T-CUSTOM", "--rows", 12, "--out-dir", tmp_path)
    assert "ZZ" not in completed.stdout
    assert "Example" not in completed.stdout


@pytest.mark.parametrize("name", COMMITTED)
def test_every_fixture_has_items_recorded_from_pdfjs(name):
    assert statement_pages(name)["engine"] == f"pdfjs {PDFJS_VERSION}"


@pytest.mark.parametrize("name", COMMITTED)
def test_every_fixture_has_a_model_marked_synthetic(name):
    model = json.loads((FIXTURES / f"{name}.model.json").read_text(encoding="utf-8"))
    assert model["engine"] == "synthetic"


def test_manifest_records_each_recorded_file_with_its_source_and_engine():
    entries = manifest()["recorded"]
    assert sorted(entry["path"] for entry in entries) == sorted(
        f"{name}.items.json" for name in COMMITTED
    )
    for entry in entries:
        name = entry["path"].split(".")[0]
        assert entry["source"] == f"{name}.pdf"
        assert entry["engine"] == f"pdfjs {PDFJS_VERSION}"
        recorded = hashlib.sha256((FIXTURES / entry["path"]).read_bytes()).hexdigest()
        assert entry["sha256"] == recorded
        source = hashlib.sha256((FIXTURES / entry["source"]).read_bytes()).hexdigest()
        assert entry["source_sha256"] == source


def test_writing_fixtures_never_touches_the_recorded_items(tmp_path):
    completed = run_generator("--write-fixtures", tmp_path)
    assert completed.returncode == 0, completed.stderr
    assert not list(tmp_path.glob("*.items.json"))
