"""One-sided statements, end to end (CP10a item 1, D-10): the generator prints statements with
no paid-in rows, one paid-in row and one withdrawn row; the core reads each, every row's amounts
in the right column, and the generator's own ledger agrees. Invented data only.
"""

import pytest

from mpesa_core import pipeline
from pdf_readers.pdfplumber_reader import extract_statement_pages
from synth.generate import ON_DEMAND_FIXTURES, build_outputs

VARIANTS = {"F-NO-PAID-IN": (0, None), "F-ONE-PAID-IN": (1, None), "F-ONE-WITHDRAWN": (None, 1)}


def amount_or_zero(text):
    return float(text.replace(",", "")) if text else 0.0


@pytest.mark.parametrize("name", sorted(VARIANTS))
def test_a_one_sided_statement_is_read_with_every_amount_in_its_column(name):
    import json

    seed, options = ON_DEMAND_FIXTURES[name]
    outputs = build_outputs(seed, options)
    expected = json.loads(outputs[".expected.json"])
    pipeline_result = pipeline.run(extract_statement_pages(outputs[".pdf"]))
    rows = pipeline_result["transactions"]
    assert len(rows) == expected["row_count"]
    assert [(row["paid_in"], row["withdrawn"], row["balance"]) for row in rows] == [
        (
            amount_or_zero(row["paid_in"]),
            amount_or_zero(row["withdrawn"]),
            amount_or_zero(row["balance"]),
        )
        for row in expected["rows"]
    ]
    assert pipeline_result["quality"]["chain_breaks"] == 0


@pytest.mark.parametrize("name", sorted(VARIANTS))
def test_the_variant_prints_exactly_the_money_rows_it_names(name):
    import json

    paid_in_rows, withdrawn_rows = VARIANTS[name]
    seed, options = ON_DEMAND_FIXTURES[name]
    rows = json.loads(build_outputs(seed, options)[".expected.json"])["rows"]
    if paid_in_rows is not None:
        assert sum(1 for row in rows if row["paid_in"]) == paid_in_rows
    if withdrawn_rows is not None:
        assert sum(1 for row in rows if row["withdrawn"]) == withdrawn_rows
