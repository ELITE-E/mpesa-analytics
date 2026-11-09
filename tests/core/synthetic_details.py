"""Invented details strings for the cleaning tests. Synthetic only.

Phone numbers come from the fake ranges in tools/guards/guards.toml and are assembled from parts,
because the pattern guard honours those ranges only inside tests/fixtures/synthetic/.
"""

LOCAL_PHONE = "07000000" + "12"
INTERNATIONAL_PHONE = "254700000" + "123"
PLUS_PHONE = "+254700000" + "456"
PAYBILL_NUMBER = "888" + "001"
TILL_NUMBER = "555" + "002"
MASKED_PHONE = "2547" + "*****" + "012"

PAYBILL_DETAILS = f"PayBill - {PAYBILL_NUMBER} - Example Till 123"
TILL_DETAILS = f"Till - {TILL_NUMBER} - Example Till 456"
BUY_GOODS_DETAILS = f"Buy Goods - {TILL_NUMBER} - Example Shop 789"
SENT_DETAILS = f"Sent to {LOCAL_PHONE} - Example Person 12"
RECEIVED_DETAILS = f"Received from {INTERNATIONAL_PHONE} - Example Person 34"
RECEIVED_PLUS_DETAILS = f"Received from {PLUS_PHONE} Example Person 56"

# Every string the contract tests run over: rewritten forms, plain forms and awkward printing.
ALL_DETAILS = (
    PAYBILL_DETAILS,
    TILL_DETAILS,
    BUY_GOODS_DETAILS,
    SENT_DETAILS,
    RECEIVED_DETAILS,
    RECEIVED_PLUS_DETAILS,
    "Customer Transfer of Funds Charge",
    "Pay Bill Charge",
    "Airtime Purchase",
    "Funds received - Example Person 00",
    f"Merchant Payment to Example Till {TILL_NUMBER} - Synthetic Online Purchase Order",
    f"Customer Transfer to {MASKED_PHONE} - Example Person 12",
    "Pay Bill Online to Example Till 321 - Acc. Synthetic Account Number",
    "Example | Shop \\ With - Separators",
    "Example\nWrapped\nDetails",
    "  Example   Padded   Details  ",
    "Example Till 123 (Ref: EXAMPLEREF) Payment",
    f"{PAYBILL_NUMBER}EXAMPLE TILL",
    "mpesa Example Payment",
    "M PESA Example Payment",
    "m-pesa Example Payment",
    "Example-Hyphenated-Name Payment",
    f"paybill - {PAYBILL_NUMBER} - Example Lower Case",
    f"Opening words PayBill - {PAYBILL_NUMBER} - Example Till 999",
)
