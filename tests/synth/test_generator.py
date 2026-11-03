import io
import json
import os
import re
import statistics
import subprocess
import sys
from typing import get_type_hints

import pdfplumber
import pytest

from _common import find_tokens
from conftest import REPO
from mpesa_core import contracts
from synth.generate import StatementOptions, build_outputs
from synth.layout import COLUMNS, HEADER_LABELS, PAGE_HEIGHT, PAGE_WIDTH

SEED = 11
OPTIONS = StatementOptions(name="T-BASIC", row_count=90)
PASSWORD = "synthetic-only"
FAKE_RECEIPT = re.compile(r"^ZZ[A-Z0-9]{8}$")
ANY_TIME = re.compile(r"^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$")


@pytest.fixture(scope="module")
def outputs():
    return build_outputs(SEED, OPTIONS)


@pytest.fixture(scope="module")
def pdf_pages(outputs):
    with pdfplumber.open(io.BytesIO(outputs[".pdf"])) as pdf:
        return [
            {
                "width": page.width,
                "height": page.height,
                "words": page.extract_words(keep_blank_chars=True, x_tolerance=1.5),
            }
            for page in pdf.pages
        ]


@pytest.fixture(scope="module")
def statement_pages(outputs):
    return json.loads(outputs[".items.json"])


@pytest.fixture(scope="module")
def expected(outputs):
    return json.loads(outputs[".expected.json"])


def items_on(statement_pages, page_index):
    return statement_pages["pages"][page_index]["items"]


def header_items(statement_pages, page_index):
    return [
        text_item
        for text_item in items_on(statement_pages, page_index)
        if text_item["text"] in HEADER_LABELS
    ]


def anchor_items(statement_pages, page_index):
    return [
        text_item
        for text_item in items_on(statement_pages, page_index)
        if FAKE_RECEIPT.match(text_item["text"])
    ]


def test_the_statement_spans_more_than_one_page(statement_pages):
    assert len(statement_pages["pages"]) >= 2


def test_every_page_is_the_declared_size(pdf_pages):
    assert (PAGE_WIDTH, PAGE_HEIGHT) == (595, 848)
    for page in pdf_pages:
        assert (page["width"], page["height"]) == (595, 848)


def test_every_page_repeats_the_seven_header_labels_on_one_row(statement_pages):
    assert len(HEADER_LABELS) == 7
    for page_index in range(len(statement_pages["pages"])):
        labels = header_items(statement_pages, page_index)
        assert sorted(label["text"] for label in labels) == sorted(HEADER_LABELS)
        assert len({label["top"] for label in labels}) == 1


def test_header_labels_are_centered_over_their_columns(statement_pages):
    for label in header_items(statement_pages, 0):
        column = COLUMNS[HEADER_LABELS.index(label["text"])]
        center = (column.x0 + column.x1) / 2
        assert abs((label["x0"] + label["x1"]) / 2 - center) <= 0.11


def data_items_in_column(statement_pages, column):
    labels = set(HEADER_LABELS)
    top_of_rows = header_items(statement_pages, 0)[0]["top"]
    return [
        text_item
        for text_item in items_on(statement_pages, 0)
        if text_item["top"] > top_of_rows
        and text_item["text"] not in labels
        and column.x0 <= text_item["x0"]
        and text_item["x1"] <= column.x1
    ]


@pytest.mark.parametrize("index", [0, 1, 2, 3], ids=["receipt", "time", "details", "status"])
def test_text_columns_are_left_aligned(statement_pages, index):
    column = COLUMNS[index]
    edges = [text_item["x0"] for text_item in data_items_in_column(statement_pages, column)]
    assert edges
    assert max(edges) - min(edges) <= 0.21


@pytest.mark.parametrize("index", [4, 5, 6], ids=["paid-in", "withdrawn", "balance"])
def test_amount_columns_are_right_aligned(statement_pages, index):
    column = COLUMNS[index]
    edges = [text_item["x1"] for text_item in data_items_in_column(statement_pages, column)]
    assert edges
    assert max(edges) - min(edges) <= 0.21


def test_header_to_data_offset_reaches_but_never_exceeds_38_points(statement_pages):
    offsets = []
    for label in header_items(statement_pages, 0):
        column = COLUMNS[HEADER_LABELS.index(label["text"])]
        for entry in data_items_in_column(statement_pages, column):
            offsets.append(abs(entry["x0"] - label["x0"]))
    assert max(offsets) <= 38.0
    assert max(offsets) >= 30.0


def test_jitter_is_at_most_a_tenth_of_a_point_and_depends_on_the_seed(statement_pages):
    edges = [text_item["x0"] for text_item in anchor_items(statement_pages, 0)]
    center = COLUMNS[0].text_x0
    assert all(abs(edge - center) <= 0.1 for edge in edges)
    assert len(set(edges)) > 1
    other = json.loads(build_outputs(SEED + 1, OPTIONS)[".items.json"])
    assert [text_item["x0"] for text_item in anchor_items(other, 0)] != edges


def test_date_and_time_are_one_string_by_default(statement_pages):
    texts = [text_item["text"] for text_item in items_on(statement_pages, 0)]
    assert any(ANY_TIME.match(text) for text in texts)


def test_split_datetime_variant_prints_two_strings_on_one_line():
    options = StatementOptions(name="T-SPLIT", row_count=20, split_datetime=True)
    outputs = build_outputs(SEED, options)
    statement_pages = json.loads(outputs[".items.json"])
    items = statement_pages["pages"][0]["items"]
    assert not any(ANY_TIME.match(text_item["text"]) for text_item in items)
    dates = [
        text_item for text_item in items if re.fullmatch(r"\d{4}-\d{2}-\d{2}", text_item["text"])
    ]
    clocks = [
        text_item for text_item in items if re.fullmatch(r"\d{2}:\d{2}:\d{2}", text_item["text"])
    ]
    assert dates
    assert len(dates) == len(clocks)
    assert {text_item["top"] for text_item in dates} == {text_item["top"] for text_item in clocks}
    assert all(
        ANY_TIME.match(row["completion_time"])
        for row in json.loads(outputs[".expected.json"])["rows"]
    )


def tops_of_details(statement_pages):
    column = COLUMNS[2]
    return sorted(text_item["top"] for text_item in data_items_in_column(statement_pages, column))


def test_wrapped_details_use_a_six_point_pitch(statement_pages):
    gaps = [
        round(lower - upper, 3)
        for upper, lower in zip(
            tops_of_details(statement_pages), tops_of_details(statement_pages)[1:], strict=False
        )
    ]
    assert 6.0 in gaps


def test_single_line_rows_sit_about_ten_points_apart(statement_pages):
    tops = sorted(text_item["top"] for text_item in anchor_items(statement_pages, 0))
    gaps = [lower - upper for upper, lower in zip(tops, tops[1:], strict=False)]
    assert statistics.mode(gaps) == pytest.approx(10.0, abs=0.5)


def test_some_rows_wrap_and_some_do_not(statement_pages):
    tops = sorted(text_item["top"] for text_item in anchor_items(statement_pages, 0))
    gaps = {round(lower - upper, 1) for upper, lower in zip(tops, tops[1:], strict=False)}
    assert len(gaps) >= 2


def summary_value(statement_pages, label):
    items = items_on(statement_pages, 0)
    label_item = next(text_item for text_item in items if text_item["text"] == label)
    return next(
        text_item["text"]
        for text_item in items
        if text_item["top"] == label_item["top"] and text_item["x0"] > label_item["x1"]
    )


@pytest.mark.parametrize(
    ("label", "key"),
    [
        ("Total Paid In", "total_paid_in"),
        ("Total Withdrawn", "total_withdrawn"),
        ("Opening Balance", "opening_balance"),
        ("Closing Balance", "closing_balance"),
    ],
)
def test_page_one_summary_agrees_with_the_independent_ledger(statement_pages, expected, label, key):
    printed = summary_value(statement_pages, label).replace(",", "")
    assert printed == expected[key]


def test_summary_row_count_agrees_with_the_ledger(statement_pages, expected):
    assert summary_value(statement_pages, "Transaction Count") == str(expected["row_count"])


def test_summary_block_is_on_page_one_only(statement_pages):
    for page_index in range(1, len(statement_pages["pages"])):
        assert "Total Paid In" not in [
            text_item["text"] for text_item in items_on(statement_pages, page_index)
        ]


def test_every_page_has_a_footer_with_an_eight_character_token(statement_pages):
    for page_index in range(len(statement_pages["pages"])):
        lowest = max(items_on(statement_pages, page_index), key=lambda entry: entry["top"])
        assert re.fullmatch(r"[A-Z0-9]{8}", lowest["text"])


def test_requested_row_count_is_exact(expected):
    assert expected["row_count"] == 90
    assert len(expected["rows"]) == 90


def test_generated_chain_has_no_breaks(expected):
    assert expected["chain_breaks"] == 0


def test_every_receipt_is_in_the_fake_range(expected):
    assert all(FAKE_RECEIPT.match(row["receipt_no"]) for row in expected["rows"])


def test_every_merchant_is_an_example_till(expected):
    tills = [row["details"] for row in expected["rows"] if "Till" in row["details"]]
    assert tills
    assert all(re.search(r"Example Till \d{3}", details) for details in tills)


def test_generated_values_pass_guard_one_only_inside_fixtures(outputs):
    for suffix in (".items.json", ".expected.json"):
        text = outputs[suffix].decode("utf-8")
        assert not find_tokens(text, f"fixtures/synthetic/T{suffix}")
        assert find_tokens(text, f"docs/T{suffix}")


def test_pdf_passes_guard_one_inside_fixtures(outputs):
    text = outputs[".pdf"].decode("utf-8", errors="replace")
    assert not find_tokens(text, "fixtures/synthetic/T.pdf")


def test_items_are_marked_as_synthetic_and_carry_the_schema(statement_pages):
    assert statement_pages["engine"] == "synthetic"
    assert statement_pages["schema_version"] == contracts.SCHEMA_VERSION


def test_items_follow_the_core_contracts(statement_pages, expected):
    assert set(statement_pages) == set(get_type_hints(contracts.StatementPages))
    page = statement_pages["pages"][0]
    assert set(page) == set(get_type_hints(contracts.Page))
    assert set(page["items"][0]) == set(get_type_hints(contracts.TextItem))
    assert set(expected["rows"][0]) == set(get_type_hints(contracts.RawRow))


def test_layout_model_matches_what_the_pdf_really_draws(statement_pages, pdf_pages):
    for page_model, page_pdf in zip(statement_pages["pages"], pdf_pages, strict=True):
        for text_item in page_model["items"]:
            matches = [
                word
                for word in page_pdf["words"]
                if word["text"] == text_item["text"] and abs(word["x0"] - text_item["x0"]) <= 0.2
            ]
            assert matches, "a modelled text item is missing from the PDF"
            assert min(abs(word["top"] - text_item["top"]) for word in matches) <= 0.5


def test_same_seed_is_byte_identical_across_processes():
    code = (
        "import hashlib, sys;"
        "from synth.generate import StatementOptions, build_outputs;"
        "o = build_outputs(11, StatementOptions(name='T-BASIC', row_count=90));"
        "print(hashlib.sha256(b''.join(o[k] for k in sorted(o))).hexdigest())"
    )
    digests = set()
    for hash_seed in ("1", "2"):
        env = {**os.environ, "PYTHONHASHSEED": hash_seed, "PYTHONPATH": str(REPO / "tools")}
        digests.add(
            subprocess.run(
                [sys.executable, "-c", code], env=env, capture_output=True, text=True, check=True
            ).stdout
        )
    assert len(digests) == 1


def test_different_seed_changes_every_output(outputs):
    other = build_outputs(SEED + 1, OPTIONS)
    for suffix in (".pdf", ".items.json", ".expected.json"):
        assert other[suffix] != outputs[suffix]


def test_password_variant_needs_the_password():
    options = StatementOptions(name="T-LOCKED", row_count=10, password=PASSWORD)
    outputs = build_outputs(SEED, options)
    with pytest.raises(pdfplumber.utils.exceptions.PdfminerException):
        pdfplumber.open(io.BytesIO(outputs[".pdf"]))
    with pdfplumber.open(io.BytesIO(outputs[".pdf"]), password=PASSWORD) as pdf:
        assert pdf.pages[0].extract_words()


def test_password_variant_is_byte_identical():
    options = StatementOptions(name="T-LOCKED", row_count=10, password=PASSWORD)
    assert build_outputs(SEED, options)[".pdf"] == build_outputs(SEED, options)[".pdf"]


def test_rows_appear_in_print_order_with_positions(expected):
    positions = [(row["page"], row["line"]) for row in expected["rows"]]
    assert positions == sorted(positions)
    assert len(set(positions)) == len(positions)


def test_rows_are_printed_newest_first(expected):
    times = [row["completion_time"] for row in expected["rows"]]
    assert times == sorted(times, reverse=True)


def test_generator_keeps_the_guard_import_clean():
    assert "mpesa_core" not in (REPO / "tools/synth/generate.py").read_text(encoding="utf-8")
