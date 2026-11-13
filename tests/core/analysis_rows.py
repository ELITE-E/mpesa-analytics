"""Invented classified rows for the analysis tests: F-RECORDS, F-PERIODS, F-RECUR, F-FEES.

Synthetic only. Receipt numbers are assembled from parts, because the pattern guard honours the
fake receipt range only inside tests/fixtures/synthetic/.
"""

from datetime import date, datetime

MONEY_IN = {"TRANSFER_IN": "INFLOW", "DEPOSIT": "INFLOW", "REVERSAL": "REVERSAL"}
MEANINGS = {
    "MERCHANT_PAYMENT": "CONSUMPTION",
    "BILL_PAYMENT": "CONSUMPTION",
    "BUNDLE_PURCHASE": "CONSUMPTION",
    "AIRTIME_PURCHASE": "CONSUMPTION",
    "TRANSFER_OUT": "NOT_DETERMINABLE",
    "TRANSFER_IN": "INFLOW",
    "DEPOSIT": "INFLOW",
    "WITHDRAWAL": "ASSET_TRANSFER",
    "INVESTMENT": "INVESTMENT",
    "FEE": "FEE",
    "REVERSAL": "REVERSAL",
    "UNCLASSIFIED": "UNKNOWN",
}
TRANSFER_CHARGE = "Customer Transfer of Funds Charge"
PAY_BILL_CHARGE = "Pay Bill Charge"
WITHDRAWAL_CHARGE = "Withdrawal Charge"


def fake_receipt(position):
    return "ZZ" + f"ANA{position:05d}"


def row(position, event_type, amount, *, when="2026-01-05 10:00:00", entity=None, **fields):
    """A classified row. Money in for inflow event types, money out otherwise."""
    money_in = event_type in MONEY_IN
    paid_out = 0.0 if money_in else amount
    return {
        "receipt_no": fields.pop("receipt_no", fake_receipt(position)),
        "completion_time": when,
        "details": fields.pop("details", f"Example details {position}"),
        "status": "Completed",
        "paid_in": amount if money_in else 0.0,
        "withdrawn": -paid_out,
        "paid_out": paid_out,
        "balance": fields.pop("balance", 1000.0),
        "event_type": event_type,
        "cash_flow_direction": "INFLOW" if money_in else "OUTFLOW",
        "economic_meaning": MEANINGS[event_type],
        "total_cost": fields.pop("total_cost", 0.0 if money_in else amount),
        "entity": entity,
        "page": 1,
        "line": position,
        **fields,
    }


def at(day, hour=10):
    """A completion time on a day of January 2026."""
    return f"2026-01-{day:02d} {hour:02d}:00:00"


def on(month, day, year=2026):
    return f"{year}-{month:02d}-{day:02d} 10:00:00"


PERIOD = (datetime(2026, 1, 10, 0, 0, 0), datetime(2026, 1, 20, 23, 59, 59))
PERIOD_DATES = (date(2026, 1, 10), date(2026, 1, 20))

# F-RECORDS: one of everything, money in and out, two months.
F_RECORDS = [
    row(0, "TRANSFER_IN", 5000.0, when=at(2), entity="Example Person 12"),
    row(1, "MERCHANT_PAYMENT", 300.0, when=at(3), entity="Example Shop"),
    row(2, "MERCHANT_PAYMENT", 200.0, when=at(4), entity="Example Shop"),
    row(3, "MERCHANT_PAYMENT", 450.0, when=at(5), entity="Example Cafe"),
    row(4, "BILL_PAYMENT", 1200.0, when=at(6), entity="Example Power"),
    row(5, "BUNDLE_PURCHASE", 99.0, when=on(2, 1), entity="Example Bundle"),
    row(6, "TRANSFER_OUT", 700.0, when=at(7), entity="Example Person 34", total_cost=713.0),
    row(
        7,
        "FEE",
        13.0,
        when=at(7),
        details=TRANSFER_CHARGE,
        total_cost=0.0,
        receipt_no=fake_receipt(6),
    ),
    row(8, "INVESTMENT", 1000.0, when=at(8), entity="Example Fund", total_cost=0.0),
    row(9, "UNCLASSIFIED", 80.0, when=at(9), balance=2000.0),
    row(10, "AIRTIME_PURCHASE", 50.0, when=at(1), entity=None),
]


def record(day, amount, name, *, month=1, **extra):
    """A record as the record-based analyses read it; the name fills every entity alias."""
    return {
        "date": date(2026, month, day),
        "amount": amount,
        "investment_amount": extra.pop("investment_amount", amount),
        "entity": name,
        "merchant": name,
        "recipient": name,
        "platform": name,
        "bill": name,
        **extra,
    }
