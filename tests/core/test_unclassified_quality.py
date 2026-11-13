import typing

from analysis_rows import F_RECORDS, row

from mpesa_core import contracts
from mpesa_core.analysis import analyze_transactions
from mpesa_core.classification.taxonomy import FinancialEvent
from mpesa_core.reconciliation.reconcile import measure_unclassified

QUALITY_FIELDS = {
    "unclassified_rows": int,
    "unclassified_share": float,
    "unclassified_paid_in": float,
    "unclassified_withdrawn": float,
}


def test_unclassified_rows_are_counted_with_their_share_and_totals():
    transactions = [
        row(0, "UNCLASSIFIED", 80.0),
        row(1, "UNCLASSIFIED", 20.0),
        {**row(2, "UNCLASSIFIED", 0.0), "paid_in": 300.0, "paid_out": 0.0},
        row(3, "MERCHANT_PAYMENT", 999.0),
    ]
    assert measure_unclassified(transactions) == {
        "unclassified_rows": 3,
        "unclassified_share": 0.75,
        "unclassified_paid_in": 300.0,
        "unclassified_withdrawn": 100.0,
    }


def test_no_unclassified_rows_gives_zeros():
    assert measure_unclassified([row(0, "MERCHANT_PAYMENT", 10.0)]) == {
        "unclassified_rows": 0,
        "unclassified_share": 0.0,
        "unclassified_paid_in": 0.0,
        "unclassified_withdrawn": 0.0,
    }


def test_no_rows_gives_zeros_and_does_not_divide_by_zero():
    assert measure_unclassified([])["unclassified_share"] == 0.0


def test_enum_members_and_plain_text_count_alike():
    member = {**row(0, "UNCLASSIFIED", 5.0), "event_type": FinancialEvent.UNCLASSIFIED}
    assert measure_unclassified([member])["unclassified_rows"] == 1


def test_withdrawn_total_is_a_size():
    assert measure_unclassified([row(0, "UNCLASSIFIED", 80.0)])["unclassified_withdrawn"] == 80.0


def test_quality_holds_only_numbers_never_row_text():
    planted = {
        **row(0, "UNCLASSIFIED", 5.0),
        "details": "PLANTEDDETAILS",
        "entity": "PLANTEDENTITY",
    }
    assert "PLANTED" not in repr(measure_unclassified([planted]))


def test_data_quality_contract_names_the_unclassified_fields():
    hints = typing.get_type_hints(contracts.DataQuality)
    for field, kind in QUALITY_FIELDS.items():
        assert hints[field] is kind


def test_the_report_keys_stay_as_they_were():
    report = analyze_transactions(F_RECORDS)
    keys = {key for section in report.values() for key in section}
    assert not keys & set(QUALITY_FIELDS)
    assert "quality" not in report
