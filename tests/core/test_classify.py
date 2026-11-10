import copy
import json

import pytest
from synthetic_events import (
    EVENT_DETAILS,
    canonical_row,
    event_row,
    fake_receipt,
    fee_row,
    parent_row,
)

from mpesa_core.classification.classify import (
    classify_transactions,
    economic_meaning_of,
    event_type_of,
)
from mpesa_core.classification.taxonomy import CashFlowDirection, EconomicMeaning, FinancialEvent
from mpesa_core.errors import DomainRowError

CANONICAL_FIELDS = ("receipt_no", "completion_time", "details", "paid_in", "withdrawn", "balance")
ADDED_FIELDS = {"event_type", "cash_flow_direction", "economic_meaning", "total_cost", "entity"}


def classified(rows):
    return classify_transactions(rows)[0]


def one(event_type, amount=100.0):
    return classified([event_row(0, event_type, amount)])[0]


@pytest.mark.parametrize("missing", CANONICAL_FIELDS)
def test_engine_requires_canonical_dataframe_contract(missing):
    row = event_row(0, "AIRTIME_PURCHASE")
    del row[missing]
    with pytest.raises(ValueError, match=missing) as caught:
        classify_transactions([row])
    assert "Airtime" not in str(caught.value)


def test_engine_initializes_accounting_columns():
    row = one("AIRTIME_PURCHASE")
    assert ADDED_FIELDS <= set(row)
    assert row["paid_out"] == 100.0
    assert isinstance(row["total_cost"], float)


@pytest.mark.parametrize("event_type", sorted(EVENT_DETAILS))
def test_engine_classifies_financial_events(event_type):
    assert one(event_type)["event_type"] == FinancialEvent(event_type)


def test_engine_determines_cash_flow_direction():
    assert one("TRANSFER_IN")["cash_flow_direction"] == CashFlowDirection.INFLOW
    assert one("AIRTIME_PURCHASE")["cash_flow_direction"] == CashFlowDirection.OUTFLOW


@pytest.mark.parametrize(
    ("paid_in", "withdrawn"), [(10.0, -5.0), (0.0, 0.0)], ids=["both", "neither"]
)
def test_row_with_both_or_neither_amount_stops_the_run_naming_only_its_position(paid_in, withdrawn):
    rows = [event_row(0, "AIRTIME_PURCHASE")]
    rows.append(canonical_row(1, "Example PLANTED Details", paid_in=paid_in, withdrawn=withdrawn))
    with pytest.raises(DomainRowError) as caught:
        classify_transactions(rows)
    assert caught.value.row_index == 1
    assert "PLANTED" not in str(caught.value)


def test_purchase_is_consumption():
    assert one("MERCHANT_PAYMENT")["economic_meaning"] == EconomicMeaning.CONSUMPTION


def test_reversal_has_reversal_economic_meaning():
    assert one("REVERSAL")["economic_meaning"] == EconomicMeaning.REVERSAL


def test_bill_payment_is_consumption():
    assert one("BILL_PAYMENT")["economic_meaning"] == EconomicMeaning.CONSUMPTION


def test_transfer_out_is_not_determinable():
    assert one("TRANSFER_OUT")["economic_meaning"] == EconomicMeaning.NOT_DETERMINABLE


def test_money_received_is_inflow():
    assert one("TRANSFER_IN")["economic_meaning"] == EconomicMeaning.INFLOW
    assert one("DEPOSIT")["economic_meaning"] == EconomicMeaning.INFLOW


def test_investment_is_investment():
    assert one("INVESTMENT")["economic_meaning"] == EconomicMeaning.INVESTMENT


@pytest.mark.parametrize(
    "details",
    ["Customer Transfer of Funds Charge", "Withdrawal Charge", "Pay Bill Charge"],
)
def test_fee_is_fee(details):
    row = classified([canonical_row(0, details, withdrawn=-13.0)])[0]
    assert row["event_type"] == FinancialEvent.FEE
    assert row["economic_meaning"] == EconomicMeaning.FEE


def test_unclassified_event_has_unknown_economic_meaning():
    row = one("UNCLASSIFIED")
    assert row["event_type"] == FinancialEvent.UNCLASSIFIED
    assert row["economic_meaning"] == EconomicMeaning.UNKNOWN


def test_sequential_fee_attribution():
    receipt = fake_receipt(1)
    rows = classified([parent_row(0, receipt), fee_row(1, receipt, amount=13.0)])
    assert rows[0]["total_cost"] == 113.0
    assert rows[1]["total_cost"] == 0.0


def test_fee_attribution_handles_fee_rows_before_the_parent():
    receipt = fake_receipt(1)
    rows = classified([fee_row(0, receipt, amount=13.0), parent_row(1, receipt)])
    assert rows[1]["total_cost"] == 113.0
    assert rows[0]["total_cost"] == 0.0


def test_transfer_in_total_cost_is_zero():
    assert one("TRANSFER_IN")["total_cost"] == 0.0


def test_engine_handles_first_row_orphan_fee():
    rows = classified([fee_row(0, fake_receipt(9)), event_row(1, "AIRTIME_PURCHASE")])
    assert rows[0]["total_cost"] == 0.0
    assert rows[1]["total_cost"] == 100.0


def test_engine_classification_ignores_case_and_preserves_details():
    details = "aIrTiMe PuRcHaSe"
    row = classified([canonical_row(0, details, withdrawn=-5.0)])[0]
    assert row["event_type"] == FinancialEvent.AIRTIME_PURCHASE
    assert row["details"] == details


def test_consumption_amount_is_the_base_total_cost():
    assert one("MERCHANT_PAYMENT", 250.0)["total_cost"] == 250.0


def test_consumption_includes_attributable_fee():
    receipt = fake_receipt(1)
    rows = classified(
        [
            parent_row(0, receipt, "BILL_PAYMENT", 400.0),
            fee_row(1, receipt, 25.0, "Pay Bill Charge"),
        ]
    )
    assert rows[0]["total_cost"] == 425.0


def test_attributable_fee_is_not_counted_as_separate_total_cost():
    receipt = fake_receipt(1)
    rows = classified([parent_row(0, receipt, "BILL_PAYMENT", 400.0), fee_row(1, receipt, 25.0)])
    assert sum(row["total_cost"] for row in rows) == 425.0


def test_transfer_out_amount_is_the_base_total_cost():
    assert one("TRANSFER_OUT", 300.0)["total_cost"] == 300.0


def test_investment_principal_is_not_total_cost():
    assert one("INVESTMENT", 1000.0)["total_cost"] == 0.0


def test_investment_transaction_cost_is_total_cost():
    receipt = fake_receipt(1)
    rows = classified([parent_row(0, receipt, "INVESTMENT", 1000.0), fee_row(1, receipt, 30.0)])
    assert rows[0]["total_cost"] == 30.0


def test_withdrawal_amount_is_not_total_cost():
    assert one("WITHDRAWAL", 500.0)["total_cost"] == 0.0


def test_withdrawal_charge_is_total_cost():
    receipt = fake_receipt(1)
    rows = classified(
        [
            parent_row(0, receipt, "WITHDRAWAL", 500.0),
            fee_row(1, receipt, 29.0, "Withdrawal Charge"),
        ]
    )
    assert rows[0]["total_cost"] == 29.0
    assert rows[1]["total_cost"] == 0.0


def test_inflow_has_zero_total_cost():
    assert one("DEPOSIT", 700.0)["total_cost"] == 0.0


def test_reversal_has_zero_total_cost():
    assert one("REVERSAL", 80.0)["total_cost"] == 0.0


def test_unknown_outflow_uses_consumed_amount_as_total_cost():
    assert one("UNCLASSIFIED", 60.0)["total_cost"] == 60.0


def test_unknown_outflow_includes_attributable_fee():
    receipt = fake_receipt(1)
    rows = classified([parent_row(0, receipt, "UNCLASSIFIED", 60.0), fee_row(1, receipt, 7.0)])
    assert rows[0]["total_cost"] == 67.0


def test_rules_keep_their_order_so_specific_texts_win():
    assert event_type_of("Pay Bill Charge") == FinancialEvent.FEE
    assert event_type_of("Withdrawal Charge") == FinancialEvent.FEE
    assert event_type_of("Funds received from Example Reversal") == FinancialEvent.TRANSFER_IN
    assert event_type_of("Recharge for Customer Data Bundles") == FinancialEvent.BUNDLE_PURCHASE
    assert event_type_of("Recharge for Customer") == FinancialEvent.UNCLASSIFIED


def test_economic_meaning_resolution_never_raises_on_the_loan_repayment_branch():
    # D-02: the old code referred to a meaning that does not exist.
    assert economic_meaning_of(FinancialEvent.LOAN_REPAYMENT) == EconomicMeaning.UNKNOWN


def test_no_rule_produces_loan_repayment():
    assert all(
        event_type_of(details) != FinancialEvent.LOAN_REPAYMENT
        for details, _ in EVENT_DETAILS.values()
    )


def test_a_fee_between_two_equidistant_parents_goes_to_the_earlier_row():
    # D-07: same nearest-row rule, earlier row wins a tie.
    receipt = fake_receipt(1)
    rows = classified(
        [
            parent_row(0, receipt, amount=100.0),
            fee_row(1, receipt),
            parent_row(2, receipt, amount=200.0),
        ]
    )
    assert (rows[0]["total_cost"], rows[2]["total_cost"]) == (113.0, 200.0)


def test_a_fee_goes_to_the_nearest_parent_with_its_receipt():
    receipt = fake_receipt(1)
    rows = classified(
        [
            parent_row(0, receipt, amount=100.0),
            event_row(1, "AIRTIME_PURCHASE"),
            parent_row(2, receipt, amount=200.0),
            fee_row(3, receipt),
        ]
    )
    assert (rows[0]["total_cost"], rows[2]["total_cost"]) == (100.0, 213.0)


def test_several_fees_add_to_one_parent():
    receipt = fake_receipt(1)
    rows = classified([parent_row(0, receipt), fee_row(1, receipt, 13.0), fee_row(2, receipt, 7.0)])
    assert rows[0]["total_cost"] == 120.0


def test_a_fee_never_becomes_another_fees_parent():
    receipt = fake_receipt(1)
    rows = classified([fee_row(0, receipt, 13.0), fee_row(1, receipt, 7.0)])
    assert [row["total_cost"] for row in rows] == [0.0, 0.0]


def test_paid_out_is_withdrawn_without_its_sign():
    row = classified([canonical_row(0, "Airtime Purchase", withdrawn=-45.5)])[0]
    assert row["paid_out"] == 45.5
    assert row["withdrawn"] == -45.5


def test_classes_are_string_enums_equal_to_their_values():
    row = one("TRANSFER_OUT")
    assert row["event_type"] == "TRANSFER_OUT"
    assert row["cash_flow_direction"] == "OUTFLOW"
    assert row["economic_meaning"] == "NOT_DETERMINABLE"
    assert json.loads(json.dumps(row))["event_type"] == "TRANSFER_OUT"


def test_empty_input_gives_no_rows_and_no_diagnostics():
    assert classify_transactions([]) == ([], [])


def test_input_rows_are_not_changed():
    receipt = fake_receipt(1)
    rows = [parent_row(0, receipt), fee_row(1, receipt)]
    before = copy.deepcopy(rows)
    classify_transactions(rows)
    assert rows == before


def test_print_order_is_preserved():
    rows = [event_row(position, "AIRTIME_PURCHASE") for position in (4, 1, 3)]
    assert [row["receipt_no"] for row in classified(rows)] == [
        fake_receipt(position) for position in (4, 1, 3)
    ]
