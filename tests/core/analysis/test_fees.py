from datetime import datetime

from analysis_rows import PAY_BILL_CHARGE, PERIOD, TRANSFER_CHARGE, WITHDRAWAL_CHARGE, row

from mpesa_core.analysis.fees import (
    calculate_mpesa_fees,
    calculate_total_fees,
    calculate_transfer_charges,
)
from mpesa_core.analysis.frame import prepared_frame

START, END = PERIOD
MARCH = (datetime(2026, 3, 1), datetime(2026, 3, 31))


def fee(position, amount, details, when):
    return row(position, "FEE", amount, when=when, details=details, total_cost=0.0)


def fees(*, transfer_text=TRANSFER_CHARGE, pay_bill_text=PAY_BILL_CHARGE):
    return prepared_frame(
        [
            fee(0, 11.0, transfer_text, "2026-01-09 23:59:59"),
            fee(1, 13.0, transfer_text, "2026-01-10 00:00:00"),
            fee(2, 25.0, pay_bill_text, "2026-01-15 12:00:00"),
            fee(3, 29.0, WITHDRAWAL_CHARGE, "2026-01-20 23:59:59"),
            fee(4, 7.0, transfer_text, "2026-01-21 00:00:00"),
            row(5, "MERCHANT_PAYMENT", 500.0, when="2026-01-15 12:00:00", entity="Example Shop"),
        ]
    )


def test_calculate_total_fees_sums_qualifying_fee_transactions():
    total = calculate_total_fees(fees(), datetime(2026, 1, 1), datetime(2026, 1, 31))
    assert total["total_fees"] == 85.0
    assert total["period"] == {"start": datetime(2026, 1, 1), "end": datetime(2026, 1, 31)}


def test_calculate_total_fees_excludes_fees_outside_period():
    assert calculate_total_fees(fees(), START, END)["total_fees"] == 67.0


def test_calculate_total_fees_includes_period_boundaries():
    first, last = datetime(2026, 1, 10, 0, 0, 0), datetime(2026, 1, 20, 23, 59, 59)
    assert calculate_total_fees(fees(), first, first)["total_fees"] == 13.0
    assert calculate_total_fees(fees(), last, last)["total_fees"] == 29.0


def test_calculate_total_fees_returns_zero_when_no_fees_qualify():
    assert calculate_total_fees(fees(), *MARCH)["total_fees"] == 0


def test_calculate_mpesa_fees_sums_known_mpesa_fee_types():
    assert calculate_mpesa_fees(fees(), START, END)["fee_amount"] == 38.0


def test_calculate_mpesa_fees_excludes_non_mpesa_fees():
    last = datetime(2026, 1, 20, 23, 59, 59)
    assert calculate_mpesa_fees(fees(), last, last)["fee_amount"] == 0


def test_calculate_mpesa_fees_excludes_fees_outside_period():
    whole_month = calculate_mpesa_fees(fees(), datetime(2026, 1, 1), datetime(2026, 1, 31))
    assert whole_month["fee_amount"] == 56.0
    assert calculate_mpesa_fees(fees(), START, END)["fee_amount"] == 38.0


def test_calculate_mpesa_fees_includes_period_boundaries():
    first = datetime(2026, 1, 10, 0, 0, 0)
    assert calculate_mpesa_fees(fees(), first, first)["fee_amount"] == 13.0


def test_calculate_mpesa_fees_returns_zero_when_none_qualify():
    assert calculate_mpesa_fees(fees(), *MARCH)["fee_amount"] == 0


def test_calculate_transfer_charges_sums_qualifying_charges():
    whole_month = calculate_transfer_charges(fees(), datetime(2026, 1, 1), datetime(2026, 1, 31))
    assert whole_month["transfer_charge_amount"] == 31.0


def test_calculate_transfer_charges_excludes_other_fee_types():
    middle = datetime(2026, 1, 15, 12, 0, 0)
    assert calculate_transfer_charges(fees(), middle, middle)["transfer_charge_amount"] == 0


def test_calculate_transfer_charges_excludes_charges_outside_period():
    assert calculate_transfer_charges(fees(), START, END)["transfer_charge_amount"] == 13.0


def test_calculate_transfer_charges_returns_zero_when_none_qualify():
    assert calculate_transfer_charges(fees(), *MARCH)["transfer_charge_amount"] == 0


def test_mpesa_fees_and_transfer_charges_match_fee_types_ignoring_case():
    shouting = fees(transfer_text=TRANSFER_CHARGE.upper(), pay_bill_text=PAY_BILL_CHARGE.lower())
    assert calculate_mpesa_fees(shouting, START, END)["fee_amount"] == 38.0
    assert calculate_transfer_charges(shouting, START, END)["transfer_charge_amount"] == 13.0
