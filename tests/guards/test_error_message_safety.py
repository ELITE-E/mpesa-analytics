import pytest

from conftest import GUARDS
from error_message_safety import StatementValueInMessageError, assert_message_is_safe

PHONE = "254700000" + "123"
RECEIPT = "QGH" + "1234ABC"
ROW = {
    "receipt": RECEIPT,
    "counterparty": "Synthetic Person",
    "phone": PHONE,
    "paid_in": "1,234.50",
    "details": "Pay Bill to Example Store",
}


@pytest.mark.parametrize(
    "message",
    [
        f"row 5: bad receipt {ROW['receipt']}",
        f"row 5: unknown counterparty {ROW['counterparty']}",
        f"row 5: unknown COUNTERPARTY {ROW['counterparty'].upper()}",
        f"row 5: bad phone {ROW['phone']}",
        f"row 5: bad amount {ROW['paid_in']}",
        "row 5: bad amount 1234.50",
        f"row 5: cannot parse {ROW['details']!r}",
        f"row 5: spaced   {ROW['counterparty'].replace(' ', '  ')}",
    ],
    ids=[
        "receipt",
        "name",
        "name-upper",
        "phone",
        "amount",
        "amount-reformatted",
        "repr",
        "spacing",
    ],
)
def test_message_formatted_from_a_row_value_is_rejected(message):
    with pytest.raises(StatementValueInMessageError):
        assert_message_is_safe(message, ROW)


def test_rejected_message_formatted_by_a_real_exception():
    with pytest.raises(StatementValueInMessageError):
        try:
            raise ValueError(f"page 2, row 5: amount {ROW['paid_in']} is not numeric")
        except ValueError as error:
            assert_message_is_safe(str(error), ROW)


@pytest.mark.parametrize(
    "message",
    [
        "page 2, row 5: expected 6 columns, found 4",
        "no receipt anchors found on 3 pages",
        "row 12: column paid_in is not numeric",
    ],
    ids=["counts", "anchors", "column-name"],
)
def test_position_and_count_messages_pass(message):
    assert_message_is_safe(message, ROW)


def test_rejection_reports_a_count_and_never_the_value():
    with pytest.raises(StatementValueInMessageError) as caught:
        assert_message_is_safe(f"bad {ROW['counterparty']} and {ROW['paid_in']}", ROW)
    assert "2" in str(caught.value)
    for value in ROW.values():
        assert value not in str(caught.value)


def test_short_values_do_not_collide_with_positions():
    assert_message_is_safe("row 5: expected 6 columns", {"count": "5", "other": "6"})


def test_token_shaped_value_is_rejected_even_if_absent_from_the_row():
    with pytest.raises(StatementValueInMessageError):
        assert_message_is_safe("bad value " + "2547" + "12345678", {})


def test_helper_is_a_guard_module_with_no_dependency_on_core():
    assert (GUARDS / "error_message_safety.py").is_file()
