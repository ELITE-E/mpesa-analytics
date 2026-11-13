from datetime import date

from analysis_rows import record

from mpesa_core.analysis.recurrence import find_recurring_bill_payments, find_recurring_purchases

START, END = date(2026, 1, 1), date(2026, 12, 31)


def monthly(name, amounts, *, start_month=1, day=5):
    return [
        record(day, amount, name, month=start_month + offset)
        for offset, amount in enumerate(amounts)
    ]


def test_identifies_monthly_recurring_purchase():
    (found,) = find_recurring_purchases(monthly("Example Shop", [10.0, 10.0, 10.0]))
    assert found["merchant"] == "Example Shop"
    assert found["occurrences"] == 3
    assert found["intervals"] == [31, 28]
    assert found["recurrence_interval"] == 29


def test_different_amounts_can_still_be_recurring():
    (found,) = find_recurring_purchases(monthly("Example Shop", [10.0, 25.0, 7.5]))
    assert found["amounts"] == [10.0, 25.0, 7.5]


def test_irregular_purchases_are_not_recurring():
    purchases = [
        record(1, 10.0, "Example Shop"),
        record(3, 10.0, "Example Shop"),
        record(30, 10.0, "Example Shop"),
    ]
    assert find_recurring_purchases(purchases) == []


def test_two_occurrences_are_not_enough_for_recurrence():
    assert find_recurring_purchases(monthly("Example Shop", [10.0, 10.0])) == []


def test_different_merchants_are_analysed_independently():
    purchases = monthly("Example Shop", [10.0, 10.0, 10.0]) + [record(2, 5.0, "Example Cafe")]
    assert [found["merchant"] for found in find_recurring_purchases(purchases)] == ["Example Shop"]


def test_unsorted_purchases_are_ordered_before_intervals_are_calculated():
    purchases = list(reversed(monthly("Example Shop", [10.0, 20.0, 30.0])))
    (found,) = find_recurring_purchases(purchases)
    assert found["dates"] == sorted(found["dates"])
    assert found["amounts"] == [10.0, 20.0, 30.0]


def test_identifies_recurring_bill_payments():
    (found,) = find_recurring_bill_payments(monthly("Example Power", [100.0] * 3), START, END)
    assert found["bill"] == "Example Power"
    assert found["occurrences"] == 3
    assert "recurrence_interval" not in found


def test_different_bill_amounts_can_still_be_recurring():
    bills = monthly("Example Power", [100.0, 130.0, 90.0])
    assert find_recurring_bill_payments(bills, START, END)[0]["amounts"] == [100.0, 130.0, 90.0]


def test_irregular_bill_payments_are_not_recurring():
    bills = [
        record(1, 1.0, "Example Power"),
        record(2, 1.0, "Example Power"),
        record(28, 1.0, "Example Power"),
    ]
    assert find_recurring_bill_payments(bills, START, END) == []


def test_two_bill_payments_are_not_enough_for_recurrence():
    assert find_recurring_bill_payments(monthly("Example Power", [1.0, 1.0]), START, END) == []


def test_bill_entities_are_evaluated_independently():
    bills = monthly("Example Power", [1.0] * 3) + monthly("Example Water", [1.0, 1.0])
    assert [found["bill"] for found in find_recurring_bill_payments(bills, START, END)] == [
        "Example Power"
    ]


def test_bill_recurrence_excludes_transactions_outside_period():
    bills = monthly("Example Power", [1.0] * 3)
    assert find_recurring_bill_payments(bills, date(2026, 2, 1), END) == []


def test_bill_recurrence_includes_period_boundaries():
    bills = monthly("Example Power", [1.0] * 3)
    found = find_recurring_bill_payments(bills, date(2026, 1, 5), date(2026, 3, 5))
    assert found[0]["occurrences"] == 3


def test_recurring_bill_payments_returns_empty_result_when_no_bills_exist():
    assert find_recurring_bill_payments([], START, END) == []
