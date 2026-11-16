"""F-RECORDS: invented transactions for the identity and import plan tests.

Every receipt is in the fake range (``ZZ`` and eight more), every name starts ``Example`` and every
phone is masked. Nothing here comes from a real statement.
"""

BASE_RECORD = {
    "receipt_no": "ZZ" + "REC00001",
    "completion_time": "2026-01-05 10:00:00",
    "details": "Merchant Payment Online to 555123 Example Shop 1",
    "status": "Completed",
    "paid_in": 0.0,
    "withdrawn": 450.0,
    "paid_out": 450.0,
    "balance": 1550.0,
    "event_type": "MERCHANT_PAYMENT",
    "cash_flow_direction": "OUTFLOW",
    "economic_meaning": "CONSUMPTION",
    "total_cost": 450.0,
    "entity": "Example Shop 1",
}

# A different value for every field the material fingerprint reads, other than the candidate key.
NON_KEY_MATERIAL_CHANGES = {
    "completion_time": "2026-01-05 10:00:01",
    "details": "Merchant Payment Online to 555123 Example Shop changed",
    "status": "Failed",
    "paid_in": 1.0,
    "paid_out": 451.0,
    "balance": 1549.0,
}
CANDIDATE_KEY_CHANGES = {
    "receipt_no": "ZZ" + "REC00099",
    "event_type": "BILL_PAYMENT",
}


def record(number=1, **changes):
    """One invented transaction, numbered so receipts, times and balances differ."""
    numbered = {
        **BASE_RECORD,
        "receipt_no": f"ZZREC{number:05d}",
        "completion_time": f"2026-01-{number % 28 + 1:02d} 10:00:00",
        "details": f"Merchant Payment Online to 555123 Example Shop {number}",
        "balance": 1000.0 + number,
        "entity": f"Example Shop {number}",
    }
    return {**numbered, **changes}


def statement(first, last):
    """Records numbered first to last inclusive, as one invented statement prints them."""
    return [record(number) for number in range(first, last + 1)]
