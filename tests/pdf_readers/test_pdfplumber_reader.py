import io
import json

import pytest
from reportlab.pdfgen.canvas import Canvas

from conftest import REPO
from mpesa_core.errors import ErrorCode, ExtractionError
from mpesa_core.extraction.rows import build_rows
from pdf_readers.pdfplumber_reader import extract_statement_pages
from synth.generate import FAKE_PASSWORD

FIXTURES = REPO / "tests" / "fixtures" / "synthetic"
ENCRYPTED = (FIXTURES / "F-ENCRYPTED.pdf").read_bytes()
GOLDEN = (FIXTURES / "F-GOLDEN.pdf").read_bytes()
PLANTED = "PLANTEDPDFTEXT"
LARGEST_POSITION_DIFFERENCE = 0.5


def recorded(name):
    return json.loads((FIXTURES / f"{name}.items.json").read_text(encoding="utf-8"))


def assert_failure(code, content, **options):
    with pytest.raises(ExtractionError) as caught:
        extract_statement_pages(content, **options)
    assert caught.value.code is code
    assert str(caught.value) == code.value


def blank_pdf():
    buffer = io.BytesIO()
    canvas = Canvas(buffer, invariant=1, pageCompression=0)
    canvas.showPage()
    canvas.save()
    return buffer.getvalue()


def test_pages_follow_the_statement_pages_contract():
    statement_pages = extract_statement_pages(GOLDEN)
    assert statement_pages["schema_version"] == 1
    assert statement_pages["engine"].startswith("pdfplumber ")
    assert [page["page_number"] for page in statement_pages["pages"]] == [1, 2]
    for page in statement_pages["pages"]:
        assert isinstance(page["width"], float)
        assert isinstance(page["height"], float)
        for text_item in page["items"]:
            assert set(text_item) == {"text", "x0", "x1", "top", "bottom"}
            assert text_item["text"].strip()


def test_positions_agree_with_pdfjs_for_the_same_text():
    plumbed = extract_statement_pages(GOLDEN)["pages"][0]["items"]
    recorded_items = [
        entry for entry in recorded("F-GOLDEN")["pages"][0]["items"] if entry["text"].strip()
    ]
    assert len(plumbed) == len(recorded_items)
    for text_item in plumbed:
        twin = min(
            (entry for entry in recorded_items if entry["text"] == text_item["text"]),
            key=lambda entry: abs(entry["top"] - text_item["top"]),
        )
        for axis in ("x0", "x1", "top"):
            assert abs(twin[axis] - text_item[axis]) <= LARGEST_POSITION_DIFFERENCE, axis


def test_no_tables_found_raises_layout_unrecognized_instead_of_returning_an_empty_result():
    content = (FIXTURES / "F-NOTABLE.pdf").read_bytes()
    with pytest.raises(ExtractionError) as caught:
        build_rows(extract_statement_pages(content))
    assert caught.value.code is ErrorCode.LAYOUT_UNRECOGNIZED


def test_a_pdf_with_no_text_at_all_raises_layout_unrecognized():
    with pytest.raises(ExtractionError) as caught:
        build_rows(extract_statement_pages(blank_pdf()))
    assert caught.value.code is ErrorCode.LAYOUT_UNRECOGNIZED


def test_bytes_that_are_not_a_pdf_raise_not_a_pdf():
    assert_failure(ErrorCode.NOT_A_PDF, f"{PLANTED} not a PDF".encode())


def test_truncated_pdf_raises_corrupt_pdf():
    assert_failure(ErrorCode.CORRUPT_PDF, b"%PDF-1.4\n" + PLANTED.encode())


def test_encrypted_pdf_without_a_password_raises_password_required():
    assert_failure(ErrorCode.PASSWORD_REQUIRED, ENCRYPTED)


def test_encrypted_pdf_with_the_wrong_password_raises_password_incorrect():
    assert_failure(ErrorCode.PASSWORD_INCORRECT, ENCRYPTED, password=PLANTED)


def test_encrypted_pdf_opens_with_its_password():
    statement_pages = extract_statement_pages(ENCRYPTED, password=FAKE_PASSWORD)
    assert statement_pages["pages"][0]["items"]


def test_pdf_reader_stays_outside_the_wheel():
    assert not list((REPO / "src").rglob("*pdfplumber*"))
    core_sources = (REPO / "src" / "mpesa_core").rglob("*.py")
    assert not any("pdfplumber" in path.read_text(encoding="utf-8") for path in core_sources)
