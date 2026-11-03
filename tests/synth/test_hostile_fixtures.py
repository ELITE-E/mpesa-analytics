import io
import json
import re

import pdfplumber
import pytest

from conftest import REPO
from synth.generate import COMMITTED_FIXTURES, build_outputs

FIXTURES = REPO / "fixtures" / "synthetic"
ADAPTER = REPO / "engine" / "pdfjs" / "adapter.js"
MAX_COMMITTED_BYTES = 2 * 1024 * 1024
MIN_DENSE_OPERATORS = 50_000


def adapter_page_limit():
    source = ADAPTER.read_text(encoding="utf-8")
    return int(re.search(r"DEFAULT_PAGE_LIMIT = (\d+);", source).group(1))


def expected(name):
    return json.loads((FIXTURES / f"{name}.expected.json").read_text(encoding="utf-8"))


def statement_pages(name):
    return json.loads((FIXTURES / f"{name}.items.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("name", ["F-DENSE", "F-MANY-PAGES"])
def test_hostile_fixture_is_committed_and_small_enough(name):
    assert name in COMMITTED_FIXTURES
    path = FIXTURES / f"{name}.pdf"
    assert path.is_file()
    assert path.stat().st_size <= MAX_COMMITTED_BYTES


def test_many_pages_fixture_exceeds_the_default_page_limit():
    assert len(statement_pages("F-MANY-PAGES")["pages"]) == adapter_page_limit() + 1


def test_many_pages_fixture_really_has_that_many_pages():
    content = (FIXTURES / "F-MANY-PAGES.pdf").read_bytes()
    with pdfplumber.open(io.BytesIO(content)) as pdf:
        assert len(pdf.pages) == adapter_page_limit() + 1


def test_many_pages_fixture_has_a_real_statement_on_page_one():
    assert expected("F-MANY-PAGES")["row_count"] > 0
    first_page = statement_pages("F-MANY-PAGES")["pages"][0]["items"]
    assert any(text_item["text"].startswith("ZZ") for text_item in first_page)


def test_dense_fixture_holds_a_dense_vector_drawing():
    seed, options = COMMITTED_FIXTURES["F-DENSE"]
    assert options.dense_line_count >= MIN_DENSE_OPERATORS
    assert build_outputs(seed, options)[".pdf"] == (FIXTURES / "F-DENSE.pdf").read_bytes()


def test_dense_drawing_makes_the_page_much_heavier():
    seed, options = COMMITTED_FIXTURES["F-DENSE"]
    with pdfplumber.open(io.BytesIO(build_outputs(seed, options)[".pdf"])) as pdf:
        assert len(pdf.pages[0].lines) >= MIN_DENSE_OPERATORS


def test_dense_fixture_still_has_its_text_and_totals():
    dense = expected("F-DENSE")
    assert dense["row_count"] > 0
    assert dense["chain_breaks"] == 0
    with pdfplumber.open(FIXTURES / "F-DENSE.pdf") as pdf:
        words = pdf.pages[0].extract_words()
    assert any(re.fullmatch(r"ZZ[A-Z0-9]{8}", word["text"]) for word in words)


@pytest.mark.parametrize("name", ["F-DENSE", "F-MANY-PAGES"])
def test_hostile_fixture_is_byte_identical_for_its_seed(name):
    seed, options = COMMITTED_FIXTURES[name]
    build_outputs.cache_clear()
    first = build_outputs(seed, options)
    build_outputs.cache_clear()
    assert build_outputs(seed, options) == first


def test_hostile_options_do_not_change_the_ordinary_fixtures():
    seed, options = COMMITTED_FIXTURES["F-GOLDEN"]
    assert build_outputs(seed, options)[".pdf"] == (FIXTURES / "F-GOLDEN.pdf").read_bytes()
