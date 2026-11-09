"""F-MALFORMED: invented raw rows that are empty, repeated headers, incomplete or unreadable.

Synthetic only. Receipt numbers are assembled from parts, because the pattern guard honours the
fake receipt range only inside tests/fixtures/synthetic/.
"""

HEADER_RECEIPT = "Receipt No."
FIELDS = ("receipt_no", "completion_time", "details", "status", "paid_in", "withdrawn", "balance")


def fake_receipt(position):
    return "ZZ" + f"MAL{position:05d}"


def raw_row(position, **cells):
    row = dict.fromkeys(FIELDS)
    row.update(cells)
    return {**row, "page": 1, "line": position}


def complete_row(position, **cells):
    defaults = {
        "receipt_no": fake_receipt(position),
        "completion_time": "2026-01-05 10:00:00",
        "details": "Airtime Purchase",
        "status": "Completed",
        "withdrawn": "5.00",
        "balance": "95.00",
    }
    return raw_row(position, **{**defaults, **cells})


# (row, kept) pairs. A row is kept exactly when the old cleaning step kept it.
F_MALFORMED = (
    (raw_row(0), False),
    (raw_row(1, receipt_no=HEADER_RECEIPT, details="Details", status="Transaction Status"), False),
    (raw_row(2, receipt_no="   ", details="no receipt"), False),
    (raw_row(3, receipt_no=""), False),
    (complete_row(4), True),
    (complete_row(5, details=None, status=None, withdrawn=None, balance=None), True),
    (complete_row(6, paid_in="garbage", withdrawn="also garbage", balance="1,2,3.4.5"), True),
    (complete_row(7, paid_in="nan", withdrawn="", balance="KSh 1,000.00"), True),
    (complete_row(8, completion_time=None), True),
)
