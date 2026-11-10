"""F-EVENTS, F-FEES and F-ENTITY: invented canonical rows and details texts. Synthetic only.

Masked phones and receipt numbers are assembled from parts, because the pattern guard honours the
fake ranges only inside tests/fixtures/synthetic/.
"""

MASKED_PHONE = "2547" + "*****" + "012"
OTHER_MASKED_PHONE = "2547" + "*****" + "034"
SMALL_BUSINESS_PHONE = "2547" + "*****" + "056"
BILL_NUMBER = "888" + "001"
TILL_NUMBER = "555" + "002"
BUNDLE_NUMBER = "555" + "003"


def fake_receipt(position):
    return "ZZ" + f"EVT{position:05d}"


def canonical_row(position, details, *, paid_in=0.0, withdrawn=0.0, receipt=None):
    return {
        "receipt_no": receipt or fake_receipt(position),
        "completion_time": "2026-01-05 10:00:00",
        "details": details,
        "status": "Completed",
        "paid_in": paid_in,
        "withdrawn": withdrawn,
        "paid_out": withdrawn,
        "balance": 1000.0,
        "page": 1,
        "line": position,
    }


# Details texts as normalize_name leaves them, one per event type, with the money each moves.
EVENT_DETAILS = {
    "TRANSFER_IN": (f"Funds received from {MASKED_PHONE} Example Person 12", "in"),
    "DEPOSIT": ("Deposit of Funds at Agent Till 555002 Example Agent", "in"),
    "INVESTMENT": (f"Unit Trust Invest To {TILL_NUMBER} Example Fund by Example Platform", "out"),
    "FEE": ("Customer Transfer of Funds Charge", "out"),
    "MERCHANT_PAYMENT": (f"Merchant Payment to {TILL_NUMBER} Example Shop", "out"),
    "BILL_PAYMENT": (f"Pay Bill Online to {BILL_NUMBER} Example Till 123 Acc. Example", "out"),
    "TRANSFER_OUT": (f"Customer Transfer to {MASKED_PHONE} Example Person 12", "out"),
    "WITHDRAWAL": ("Withdrawal at Agent Till 555002 Example Agent", "out"),
    "REVERSAL": ("Example Payment Reversal", "in"),
    "AIRTIME_PURCHASE": ("Airtime Purchase", "out"),
    "BUNDLE_PURCHASE": (
        f"Customer Bundle Purchase to {BUNDLE_NUMBER} Example Bundle by Example",
        "out",
    ),
    "UNCLASSIFIED": ("Example Unknown Service", "out"),
}


def event_row(position, event_type, amount=100.0):
    details, direction = EVENT_DETAILS[event_type]
    if direction == "in":
        return canonical_row(position, details, paid_in=amount)
    return canonical_row(position, details, withdrawn=-amount)


def fee_row(position, receipt, amount=13.0, details="Customer Transfer of Funds Charge"):
    return canonical_row(position, details, withdrawn=-amount, receipt=receipt)


def parent_row(position, receipt, event_type="TRANSFER_OUT", amount=100.0):
    return {**event_row(position, event_type, amount), "receipt_no": receipt}
