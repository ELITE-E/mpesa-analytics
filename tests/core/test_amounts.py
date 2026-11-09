import logging
import math

import pytest

from mpesa_core.cleaning.amounts import parse_currency


@pytest.mark.parametrize(
    ("printed", "amount"),
    [
        ("1,234.50", 1234.5),
        ("12,345,678.00", 12345678.0),
        ("100", 100.0),
        ("-50.00", -50.0),
        ("-1,000.25", -1000.25),
        ("+7.00", 7.0),
        ("KSh 1,000.00", 1000.0),
        ("KSh1,000.00", 1000.0),
        ("  2,500.00  ", 2500.0),
        ("", 0.0),
        (None, 0.0),
        ("   ", 0.0),
        ("garbage", 0.0),
        ("12.34.56", 0.0),
        ("Ksh 5.00", 0.0),
        ("1e3", 1000.0),
        (12, 12.0),
        (3.5, 3.5),
    ],
    ids=[
        "thousands",
        "millions",
        "whole",
        "negative",
        "negative-thousands",
        "plus",
        "currency-prefix",
        "currency-prefix-touching",
        "padded",
        "blank",
        "none",
        "whitespace-only",
        "garbage",
        "two-points",
        "prefix-other-case",
        "exponent",
        "integer",
        "float",
    ],
)
def test_currency_string_to_float(printed, amount):
    parsed = parse_currency(printed)
    assert isinstance(parsed, float)
    assert parsed == amount


def test_text_reading_as_not_a_number_stays_not_a_number_here():
    assert math.isnan(parse_currency("nan"))


def test_missing_float_value_is_zero():
    assert parse_currency(float("nan")) == 0.0


def test_unparseable_amount_is_zero_and_logs_nothing(caplog):
    planted = "PLANTED-AMOUNT-TEXT"
    with caplog.at_level(logging.DEBUG):
        assert parse_currency(planted) == 0.0
    assert caplog.records == []
    assert planted not in caplog.text
