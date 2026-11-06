from conftest import REPO
from vendor import GROUPS, PDFJS_VERSION, PINS

CI = (REPO / ".github/workflows/ci.yml").read_text(encoding="utf-8")
VERSIONS = (REPO / "docs/decisions/0001-versions.md").read_text(encoding="utf-8")


def test_ci_runs_the_pdf_reader_tests():
    assert "--test tests/pdf_readers/*.test.js" in CI


def test_the_node_build_is_pinned():
    for rel in GROUPS["pdfjs-node"]:
        assert rel in PINS


def test_the_node_build_is_recorded_with_its_reason():
    assert "legacy/build/pdf.min.mjs" in VERSIONS
    assert "toHex" in VERSIONS
    assert PDFJS_VERSION in VERSIONS


def test_the_node_build_stays_outside_the_download_budget():
    source = (REPO / "tools/measure_bundle.py").read_text(encoding="utf-8")
    assert "pdfjs-node" not in source


CP8_NOTES = REPO / "docs/decisions/cp8-notes.md"


def test_cp8_notes_hold_the_timeout_and_legacy_build_caveats():
    notes = CP8_NOTES.read_text(encoding="utf-8")
    assert "Timeout" in notes
    assert "legacy/build" in notes


def test_decision_index_lists_the_cp8_notes():
    assert "cp8-notes.md" in (REPO / "docs/decisions/README.md").read_text(encoding="utf-8")
