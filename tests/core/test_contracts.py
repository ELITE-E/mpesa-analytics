import typing

import pytest
from fresh_imports import pandas_loaded_by_importing

from mpesa_core import contracts

CONTRACT_NAMES = [
    "TextItem",
    "Page",
    "StatementPages",
    "RawRow",
    "CanonicalRow",
    "ClassifiedRow",
    "Diagnostic",
    "DataQuality",
    "PipelineResult",
]
OPTIONAL_TEXT = str | None


def fields_of(name):
    return typing.get_type_hints(getattr(contracts, name))


def test_schema_version_is_one():
    assert contracts.SCHEMA_VERSION == 1


@pytest.mark.parametrize("name", CONTRACT_NAMES)
def test_contract_is_a_typed_dict(name):
    assert typing.is_typeddict(getattr(contracts, name))


def test_raw_row_has_the_seven_printed_fields_as_optional_text():
    hints = fields_of("RawRow")
    printed = ["receipt_no", "completion_time", "details", "status"]
    printed += ["paid_in", "withdrawn", "balance"]
    for field in printed:
        assert hints[field] == OPTIONAL_TEXT


def test_raw_row_has_a_position_and_nothing_else():
    hints = fields_of("RawRow")
    assert hints["page"] is int
    assert hints["line"] is int
    assert len(hints) == 9


def test_text_item_has_text_and_a_position():
    hints = fields_of("TextItem")
    assert hints["text"] is str
    for field in ("x0", "x1", "top", "bottom"):
        assert hints[field] is float


def test_page_holds_its_size_and_text_items():
    hints = fields_of("Page")
    assert hints["page_number"] is int
    assert hints["width"] is float
    assert hints["height"] is float
    assert hints["items"] == list[contracts.TextItem]


def test_statement_pages_names_its_engine_and_schema():
    hints = fields_of("StatementPages")
    assert hints["schema_version"] is int
    assert hints["engine"] is str
    assert hints["pages"] == list[contracts.Page]


def test_canonical_row_has_typed_amounts():
    hints = fields_of("CanonicalRow")
    for field in ("paid_in", "withdrawn", "paid_out", "balance"):
        assert hints[field] is float
    for field in ("receipt_no", "completion_time", "details", "status"):
        assert hints[field] is str


def test_classified_row_extends_canonical_row_with_its_classification():
    canonical = fields_of("CanonicalRow")
    classified = fields_of("ClassifiedRow")
    assert canonical.items() <= classified.items()
    for field in ("event_type", "cash_flow_direction", "economic_meaning"):
        assert classified[field] is str
    assert classified["entity"] == OPTIONAL_TEXT


def test_diagnostic_points_at_a_row_by_position():
    hints = fields_of("Diagnostic")
    assert hints["code"] is str
    assert hints["row_index"] is int


def test_data_quality_holds_counts():
    hints = fields_of("DataQuality")
    assert hints["row_count"] is int
    assert hints["chain_breaks"] is int
    assert hints["unparsed_amounts"] is int
    assert hints["status_counts"] == dict[str, int]


def test_pipeline_result_ties_the_contracts_together():
    hints = fields_of("PipelineResult")
    assert hints["schema_version"] is int
    assert hints["transactions"] == list[contracts.ClassifiedRow]
    assert hints["quality"] is contracts.DataQuality
    assert hints["diagnostics"] == list[contracts.Diagnostic]


def test_importing_the_contracts_does_not_load_pandas():
    assert not pandas_loaded_by_importing(["mpesa_core.contracts"])


def test_contracts_are_only_types_at_runtime():
    row = contracts.RawRow(
        receipt_no=None,
        completion_time=None,
        details=None,
        status=None,
        paid_in=None,
        withdrawn=None,
        balance=None,
        page=1,
        line=0,
    )
    assert type(row) is dict
