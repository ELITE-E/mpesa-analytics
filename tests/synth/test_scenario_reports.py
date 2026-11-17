"""The core's report on the scenarios that need one (CP8b, owner decision A).

The old frontend tests used the backend's analytics on the prototype sample and the five
edge-case statements, so their screens render real lists and links. Here the core's analysis runs
on each scenario ledger's rows, and the result is a recorded fixture: the generator cannot make
it (it must not import the core), so this test proves it is what the core gives today.
"""

import json
import tomllib

import pytest

from conftest import REPO
from record_scenario_reports import (
    ENGINE,
    REPORTED_SCENARIOS,
    report_bytes,
    write_recorded_section,
)

FIXTURES = REPO / "tests" / "fixtures" / "synthetic"
EXPECTED_SCENARIOS = {
    "F5-prototype-converted",
    "S-stress-overview",
    "S-no-spending",
    "S-people-edge-cases",
    "S-savings-edge-cases",
    "S-cash-edge-cases",
}


def ledger(name):
    return json.loads((FIXTURES / f"{name}.api.json").read_text(encoding="utf-8"))


def recorded():
    manifest = tomllib.loads((FIXTURES / "MANIFEST.toml").read_text(encoding="utf-8"))
    return {entry["path"]: entry for entry in manifest.get("recorded", [])}


def test_the_reported_scenarios_are_the_prototype_sample_and_the_five_edge_cases():
    assert set(REPORTED_SCENARIOS) == EXPECTED_SCENARIOS


@pytest.mark.parametrize("name", sorted(EXPECTED_SCENARIOS))
def test_each_committed_report_is_what_the_core_gives_today(name):
    assert (FIXTURES / f"{name}.report.json").read_bytes() == report_bytes(name, FIXTURES)


@pytest.mark.parametrize("name", sorted(EXPECTED_SCENARIOS))
def test_each_report_is_recorded_in_the_manifest_with_its_source_and_engine(name):
    entry = recorded()[f"{name}.report.json"]
    assert entry["source"] == f"{name}.api.json"
    assert entry["engine"] == ENGINE


@pytest.mark.parametrize("name", sorted(EXPECTED_SCENARIOS))
def test_a_report_agrees_with_its_ledger_on_the_totals_and_closing_balance(name):
    report = json.loads((FIXTURES / f"{name}.report.json").read_text(encoding="utf-8"))["report"]
    totals = ledger(name)["snapshot"]["result"]["cash_flow"]
    assert round(report["cash_flow"]["total_inflow"] * 100) == round(totals["total_inflow"] * 100)
    assert round(report["cash_flow"]["total_outflow"] * 100) == round(totals["total_outflow"] * 100)
    assert report["cash_flow"]["closing_balance"] == totals["closing_balance"]


def test_rewriting_the_report_entries_keeps_every_pdfjs_recording(tmp_path):
    manifest = tmp_path / "MANIFEST.toml"
    manifest.write_text(
        '[[fixture]]\npath = "A.pdf"\n'
        '\n[[recorded]]\npath = "A.items.json"\nsource = "A.pdf"\nengine = "pdfjs 1"\n'
        '\n[[recorded]]\npath = "Old.report.json"\nsource = "Old.api.json"\n',
        encoding="utf-8",
    )
    write_recorded_section(manifest, ['\n[[recorded]]\npath = "New.report.json"\n'])
    paths = [entry["path"] for entry in tomllib.loads(manifest.read_text())["recorded"]]
    assert paths == ["A.items.json", "New.report.json"]
    assert tomllib.loads(manifest.read_text())["fixture"] == [{"path": "A.pdf"}]
