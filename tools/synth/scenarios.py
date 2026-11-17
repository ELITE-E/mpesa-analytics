"""The frontend's contract scenarios, as data (CP8b, owner decision A, 2026-11-17).

Ported as data, never as code, from the old repo's synthetic contract fixtures: F1 a worked
example (linked, orphan and ambiguous fees, reversals both ways, an unclassified row each way, a
row whose direction is unexpected for its type); F2 tied completion times; F3 unreadable
completion times; F4 2,345 rows; F5 the IA prototype's own sample statement; and five edge-case
statements (stress, no spending, people, savings, cash). Every value is invented.

Receipts are kept as short codes and masked phones as numbered ``{n}`` markers, so this file holds
no receipt-like or phone-like text: ``scenario_ledger.py`` builds the receipts, and the phones in
the fake range ADR 0003 declares, when it runs. Amounts are in cents.
"""

from dataclasses import dataclass

NO_ENTITY = "NO_ENTITY_IDENTIFIED"
# What each event type means, as the frontend's contract gives it.
ECONOMIC_MEANING = {
    "MERCHANT_PAYMENT": "CONSUMPTION",
    "BILL_PAYMENT": "CONSUMPTION",
    "AIRTIME_PURCHASE": "CONSUMPTION",
    "BUNDLE_PURCHASE": "CONSUMPTION",
    "DEPOSIT": "INFLOW",
    "WITHDRAWAL": "ASSET_TRANSFER",
    "INVESTMENT": "INVESTMENT",
    "FEE": "FEE",
    "TRANSFER_IN": "INFLOW",
    "REVERSAL": "REVERSAL",
    "TRANSFER_OUT": "NOT_DETERMINABLE",
    "UNCLASSIFIED": "UNKNOWN",
}
F3_INVALID_TIMES = ("04/07/2026 12:00", "", "2026-13-45 99:99:99", "not a timestamp")
FEE_LINES = ("Customer Transfer of Funds Charge", "Pay Bill Charge", "Withdrawal Charge")
TRANSFER_CHARGE, PAY_BILL_CHARGE, WITHDRAWAL_CHARGE = FEE_LINES
LONG_MERCHANT = (
    "Mama Njeri Wholesale and Retail General Merchandise Supplies Limited Kariakor Market Branch"
)
LONG_PERSON = "Wanjiru Akinyi Achieng Nyambura Chepkoech Muthoni Kamau-Odhiambo"
LONG_SENDER = "Nyambura Wairimu Chepkoech Akinyi Odhiambo-Kamau Mutua Wanjohi"
LONG_FUND = "Mali Safaricom Unit Trust Balanced Growth and Income Fund Class B Accumulation Units"
LONG_AGENT = "Kariakor Market Wholesale and Retail M-Pesa Agency Services Limited Branch Number Two"
KPLC = "Kenya Power and Lighting Company Prepaid Tokens"
KWALITY = "Kwality Stores Agent"
MALI = "Mali Safaricom Unit Trust"
JUJA = "Juja Rd Agencies"
MARY = "Mary Wanjiku"
EMPLOYER = "Synthetic Employer"
MINUTES_PER_DAY = 1440
MINUTES_PER_HOUR = 60
F4_ROW_COUNT = 2345
F4_TILLS = 37


@dataclass(frozen=True)
class ScenarioRow:
    """One transaction of a scenario, oldest first, as the scenario intends it."""

    code: str
    time: str
    event_type: str
    paid_in_cents: int
    paid_out_cents: int
    details: str
    entity: str
    # The prototype sample's own balance after this row and its charge: F5's conversion check.
    sample_balance_cents: int | None = None


@dataclass(frozen=True)
class Scenario:
    """A named statement: its rows, opening balance, import id and whether it can be printed."""

    name: str
    import_id: int
    opening_cents: int
    rows: tuple[ScenarioRow, ...]
    printable: bool = True


def _rows(table, time_of):
    """Turn a table of (code, event type, paid in, paid out, details, entity) into rows.

    Args:
        table: The tuples, oldest first; amounts in whole shillings.
        time_of: Gives a row's completion time from its position.

    Returns:
        The ``ScenarioRow`` tuple.

    Side Effects:
        None.
    """
    return tuple(
        ScenarioRow(code, time_of(position), kind, paid_in * 100, paid_out * 100, details, entity)
        for position, (code, kind, paid_in, paid_out, details, entity) in enumerate(table)
    )


def _timed_rows(table):
    """Turn a table of (code, time, event type, paid in, paid out, details, entity) into rows.

    Args:
        table: The tuples, oldest first; amounts in whole shillings.

    Returns:
        The ``ScenarioRow`` tuple.

    Side Effects:
        None.
    """
    return tuple(
        ScenarioRow(code, time, kind, paid_in * 100, paid_out * 100, details, entity)
        for code, time, kind, paid_in, paid_out, details, entity in table
    )


WORKED_EXAMPLE = (
    ("WEK000", "TRANSFER_IN", 10000, 0, "Funds received from Synthetic Sender", "Synthetic Sender"),
    ("WEL000", "DEPOSIT", 5000, 0, "Deposit of Funds at Synthetic Agent", "Synthetic Agent"),
    ("WEM000", "REVERSAL", 1000, 0, "Synthetic Reversal credit", NO_ENTITY),
    ("WEN000", "UNCLASSIFIED", 250, 0, "Unrecognised synthetic inflow", NO_ENTITY),
    ("WEP000", "MERCHANT_PAYMENT", 80, 0, "Synthetic refund (unexpected direction)", "Till"),
    ("WEA000", "MERCHANT_PAYMENT", 0, 1000, "Merchant Payment to Synthetic Till", "Till"),
    ("WEB000", "BILL_PAYMENT", 0, 2000, "Pay Bill to Synthetic Utility", "Utility"),
    ("WEB000", "FEE", 0, 30, PAY_BILL_CHARGE, NO_ENTITY),
    ("WEC000", "TRANSFER_OUT", 0, 1500, "Customer Transfer to Synthetic Person", "Person"),
    ("WEC000", "FEE", 0, 15, TRANSFER_CHARGE, NO_ENTITY),
    ("WED000", "WITHDRAWAL", 0, 3000, "Customer Withdrawal At Synthetic Agent", "Agent"),
    ("WED000", "FEE", 0, 29, WITHDRAWAL_CHARGE, NO_ENTITY),
    ("WEE000", "INVESTMENT", 0, 5000, "Unit Trust Invest to Synthetic Fund", "Fund"),
    ("WEF000", "AIRTIME_PURCHASE", 0, 100, "Airtime Purchase", "Safaricom Airtime"),
    ("WEG000", "UNCLASSIFIED", 0, 400, "Unrecognised synthetic outflow", NO_ENTITY),
    ("WEH000", "FEE", 0, 10, PAY_BILL_CHARGE, NO_ENTITY),
    ("WEI000", "REVERSAL", 0, 200, "Synthetic Reversal debit", NO_ENTITY),
    ("WEJ000", "TRANSFER_OUT", 0, 300, "Customer Transfer to Second Person", "Second Person"),
    ("WEJ000", "UNCLASSIFIED", 0, 50, "Unrecognised synthetic outflow on J", NO_ENTITY),
    ("WEJ000", "FEE", 0, 7, TRANSFER_CHARGE, NO_ENTITY),
)

TIED = (
    ("TIE0001", "2026-07-02 09:00:00", "TRANSFER_IN", 3000, 0, "Funds received", "Sender One"),
    ("TIE0002", "2026-07-02 09:00:00", "DEPOSIT", 2000, 0, "Deposit of Funds", "Agent One"),
    ("TIE0003", "2026-07-02 12:30:15", "TRANSFER_OUT", 0, 1000, "Customer Transfer", "Person One"),
    ("TIE0003", "2026-07-02 12:30:15", "FEE", 0, 13, TRANSFER_CHARGE, NO_ENTITY),
    ("TIE0005", "2026-07-03 18:00:00", "MERCHANT_PAYMENT", 0, 500, "Merchant Payment", "Till One"),
    (
        "TIE0006",
        "2026-07-03 18:00:00",
        "BUNDLE_PURCHASE",
        0,
        99,
        "Bundle Purchase",
        "Safaricom Data",
    ),
)

INVALID_TIMES = ("2026-07-04 10:00:00", "2026-07-04T11:00:00", *F3_INVALID_TIMES)
INVALID = (
    ("TS00001", INVALID_TIMES[0], "TRANSFER_IN", 1000, 0, "Funds received", "Sender"),
    *(
        (f"TS{position + 1:05d}", time, "MERCHANT_PAYMENT", 0, 10, "Merchant Payment", "Till")
        for position, time in enumerate(INVALID_TIMES)
        if position > 0
    ),
)


def _large_rows():
    """F4: one deposit, then one merchant payment a minute, to 2,345 rows.

    Returns:
        The ``ScenarioRow`` tuple.

    Side Effects:
        None.
    """
    rows = [
        ScenarioRow(
            "BIG00001", "2026-07-01 00:00:00", "DEPOSIT", 10_000_000, 0, "Deposit of Funds", "Agent"
        )
    ]
    for row_id in range(2, F4_ROW_COUNT + 1):
        day, minute_of_day = divmod(row_id, MINUTES_PER_DAY)
        hour, minute = divmod(minute_of_day, MINUTES_PER_HOUR)
        rows.append(
            ScenarioRow(
                f"BIG{row_id:05d}",
                f"2026-07-{1 + day:02d} {hour:02d}:{minute:02d}:00",
                "MERCHANT_PAYMENT",
                0,
                1000,
                "Merchant Payment",
                f"Till {row_id % F4_TILLS}",
            )
        )
    return tuple(rows)


# (day of August, code, event type, paid out, details, entity); a fee prints one minute after.
STRESS = (
    (
        1,
        "ST01",
        "MERCHANT_PAYMENT",
        24500,
        f"Merchant Payment to 552211 - {LONG_MERCHANT}",
        LONG_MERCHANT,
    ),
    (3, "ST02", "TRANSFER_OUT", 15000, f"Customer Transfer to {{0}} - {LONG_PERSON}", LONG_PERSON),
    (3, "ST02", "FEE", 105, TRANSFER_CHARGE, NO_ENTITY),
    (6, "ST03", "BILL_PAYMENT", 9800, f"Pay Bill to 888880 - {KPLC}", KPLC),
    (6, "ST03", "FEE", 77, PAY_BILL_CHARGE, NO_ENTITY),
    (
        9,
        "ST04",
        "INVESTMENT",
        12000,
        "Transfer to M-Shwari Lock Savings Account",
        "M-Shwari Lock Savings Account",
    ),
    (
        14,
        "ST05",
        "WITHDRAWAL",
        6000,
        f"Customer Withdrawal At Agent Till 198421 - {KWALITY}",
        KWALITY,
    ),
    (14, "ST05", "FEE", 87, WITHDRAWAL_CHARGE, NO_ENTITY),
    (20, "ST06", "AIRTIME_PURCHASE", 500, "Airtime Purchase", "Safaricom Airtime"),
    (
        27,
        "ST07",
        "MERCHANT_PAYMENT",
        3100,
        f"Merchant Payment to 552211 - {LONG_MERCHANT}",
        LONG_MERCHANT,
    ),
)


def _stress_rows():
    """The stress statement: one row a day at 09:00, each fee a minute after its parent.

    Returns:
        The ``ScenarioRow`` tuple.

    Side Effects:
        None.
    """
    seen = {}
    rows = []
    for day, code, kind, paid_out, details, entity in STRESS:
        minute = seen.get(code, 0)
        seen[code] = minute + 1
        time = f"2026-08-{day:02d} 09:{minute:02d}:00"
        rows.append(ScenarioRow(code, time, kind, 0, paid_out * 100, details, entity))
    return tuple(rows)


NO_SPENDING = (
    ("NS01", "TRANSFER_IN", 5000, 0, "Funds received from {0} - Achieng Otieno", "Achieng Otieno"),
    ("NS02", "TRANSFER_OUT", 0, 2000, "Customer Transfer to {1} - Kamau Njoroge", "Kamau Njoroge"),
    ("NS02", "FEE", 0, 33, TRANSFER_CHARGE, NO_ENTITY),
    ("NS03", "AIRTIME_PURCHASE", 0, 100, "Airtime Purchase", "Safaricom Airtime"),
    (
        "NS04",
        "WITHDRAWAL",
        0,
        1000,
        f"Customer Withdrawal At Agent Till 198421 - {KWALITY}",
        KWALITY,
    ),
    ("NS04", "FEE", 0, 29, WITHDRAWAL_CHARGE, NO_ENTITY),
)

PEOPLE = (
    ("PE01", "TRANSFER_IN", 5000, 0, f"Funds received from {{0}} - {MARY}", MARY),
    ("PE02", "TRANSFER_OUT", 0, 2000, f"Customer Transfer to {{0}} - {MARY}", MARY),
    ("PE02", "FEE", 0, 33, TRANSFER_CHARGE, NO_ENTITY),
    ("PE03", "TRANSFER_OUT", 0, 1500, "Customer Transfer to {1} - MARY WANJIKU", "MARY WANJIKU"),
    ("PE03", "FEE", 0, 33, TRANSFER_CHARGE, NO_ENTITY),
    ("PE04", "TRANSFER_IN", 12000, 0, f"Funds received from {{2}} - {LONG_SENDER}", LONG_SENDER),
    ("PE05", "TRANSFER_OUT", 0, 3000, f"Customer Transfer to {{2}} - {LONG_SENDER}", LONG_SENDER),
    ("PE05", "FEE", 0, 53, TRANSFER_CHARGE, NO_ENTITY),
    ("PE06", "TRANSFER_OUT", 0, 700, "Customer Transfer to {3}", NO_ENTITY),
    ("PE06", "FEE", 0, 13, TRANSFER_CHARGE, NO_ENTITY),
    ("PE07", "MERCHANT_PAYMENT", 0, 400, f"Merchant Payment to 552211 - {MARY}", MARY),
)

SAVINGS = (
    (
        "SA01",
        "2026-08-03 09:00:00",
        "TRANSFER_IN",
        20000,
        0,
        f"Funds received from {{0}} - {EMPLOYER}",
        EMPLOYER,
    ),
    (
        "SA02",
        "2026-08-05 10:00:00",
        "INVESTMENT",
        0,
        3000,
        "Unit Trust Invest to 4105050 - MALI SAFARICOM UNIT TRUST",
        MALI,
    ),
    (
        "SA03",
        "2026-08-20 10:00:00",
        "INVESTMENT",
        0,
        2500,
        f"Unit Trust Invest to 999001 - {LONG_FUND}",
        LONG_FUND,
    ),
    (
        "SA04",
        "2026-09-05 10:00:00",
        "INVESTMENT",
        0,
        3000,
        "Unit Trust Invest to 4105050 - MALI SAFARICOM UNIT TRUST",
        MALI,
    ),
    (
        "SA05",
        "2026-09-12 11:00:00",
        "INVESTMENT",
        0,
        1000,
        "Unit Trust Invest to 999002",
        NO_ENTITY,
    ),
    (
        "SA06",
        "2026-09-15 12:00:00",
        "BILL_PAYMENT",
        0,
        4000,
        "Pay Bill to 303030 - STANBIC MONEY MARKET FUND",
        "Stanbic Money Market Fund",
    ),
    (
        "SA07",
        "2026-09-20 13:00:00",
        "UNCLASSIFIED",
        0,
        1500,
        "M-Shwari Lock Savings Deposit",
        "M-Shwari Lock Savings",
    ),
)

CASH = (
    (
        "CA01",
        "2026-07-01 08:00:00",
        "TRANSFER_IN",
        30000,
        0,
        f"Funds received from {{0}} - {EMPLOYER}",
        EMPLOYER,
    ),
    (
        "CA02",
        "2026-07-02 09:00:00",
        "WITHDRAWAL",
        0,
        5000,
        "Withdrawal at Agent Till 104552 - JUJA RD AGENCIES",
        JUJA,
    ),
    ("CA02", "2026-07-02 09:00:00", "FEE", 0, 67, WITHDRAWAL_CHARGE, NO_ENTITY),
    (
        "CA03",
        "2026-07-05 10:00:00",
        "WITHDRAWAL",
        0,
        2000,
        f"Withdrawal at Agent Till 555010 - {LONG_AGENT.upper()}",
        LONG_AGENT,
    ),
    ("CA03", "2026-07-05 10:00:00", "FEE", 0, 29, WITHDRAWAL_CHARGE, NO_ENTITY),
    (
        "CA04",
        "2026-07-09 11:00:00",
        "WITHDRAWAL",
        0,
        5000,
        "Withdrawal at Agent Till 104552 - JUJA RD AGENCIES",
        JUJA,
    ),
    ("CA04", "2026-07-09 11:00:00", "FEE", 0, 67, WITHDRAWAL_CHARGE, NO_ENTITY),
    (
        "CA05",
        "2026-07-12 12:00:00",
        "WITHDRAWAL",
        0,
        1000,
        "Withdrawal at Agent Till 777001",
        NO_ENTITY,
    ),
    (
        "CA06",
        "2026-07-15 13:00:00",
        "DEPOSIT",
        3000,
        0,
        "Deposit of Funds at Agent Till 104552 - JUJA RD AGENCIES",
        JUJA,
    ),
)

PROTOTYPE_OPENING_CENTS = 1_241_000
# F5: the IA prototype's sample statement, oldest first: (completion time, event type, money in,
# amount, charge, index of the charge's line in FEE_LINES or None, details, entity, the sample's
# balance after the row and its charge). Amounts in cents.
PROTOTYPE_SAMPLE = (
    (
        "2024-07-01 07:30:00",
        "AIRTIME_PURCHASE",
        False,
        10000,
        0,
        None,
        "Airtime Purchase",
        "Safaricom Airtime",
        1231000,
    ),
    (
        "2024-07-01 08:05:00",
        "BILL_PAYMENT",
        False,
        42000,
        700,
        1,
        "Pay Bill to 600500 - BOLT MOBILITY Acc. {0}",
        "Bolt Mobility",
        1188300,
    ),
    (
        "2024-07-01 09:00:00",
        "BILL_PAYMENT",
        False,
        400000,
        3300,
        1,
        "Pay Bill to 150500 - SAFARICOM HOME FIBRE Acc. FIBRE-8911",
        "Safaricom Home Fibre",
        785000,
    ),
    (
        "2024-07-01 10:00:00",
        "TRANSFER_IN",
        True,
        2000000,
        0,
        None,
        "Funds received from {1} - DANIEL OCHIENG",
        "Daniel Ochieng",
        2785000,
    ),
    (
        "2024-07-02 18:00:00",
        "MERCHANT_PAYMENT",
        False,
        210000,
        0,
        None,
        "Merchant Payment to 914022 - QUICKMART KILIMANI",
        "Quickmart Kilimani",
        2575000,
    ),
    (
        "2024-07-02 19:00:00",
        "WITHDRAWAL",
        False,
        115000,
        2900,
        2,
        "Withdrawal at Agent Till 198421 - KWALITY STORES AGENT",
        "Kwality Stores Agent",
        2457100,
    ),
    (
        "2024-07-02 21:00:00",
        "BUNDLE_PURCHASE",
        False,
        25000,
        0,
        None,
        "Customer Bundle Purchase",
        "Safaricom Data Bundles",
        2432100,
    ),
    (
        "2024-07-03 08:15:00",
        "BILL_PAYMENT",
        False,
        450000,
        3300,
        1,
        "Pay Bill to 888880 - KENYA POWER (KPLC PREPAID) Acc. 37190021",
        "Kenya Power (KPLC Prepaid)",
        1978800,
    ),
    (
        "2024-07-03 09:42:00",
        "BILL_PAYMENT",
        False,
        1000000,
        0,
        None,
        "Pay Bill to 303030 - STANBIC MMF Acc. 99824",
        "Stanbic Money Market Fund",
        978800,
    ),
    (
        "2024-07-03 17:40:00",
        "MERCHANT_PAYMENT",
        False,
        52000,
        0,
        None,
        "Merchant Payment to 778120 - MAMA PIMA GROCERIES",
        "Mama Pima Groceries",
        926800,
    ),
    (
        "2024-07-04 07:30:00",
        "AIRTIME_PURCHASE",
        False,
        10000,
        0,
        None,
        "Airtime Purchase",
        "Safaricom Airtime",
        916800,
    ),
    (
        "2024-07-04 07:55:00",
        "BILL_PAYMENT",
        False,
        51000,
        700,
        1,
        "Pay Bill to 600500 - BOLT MOBILITY Acc. {0}",
        "Bolt Mobility",
        865100,
    ),
    (
        "2024-07-04 17:00:00",
        "DEPOSIT",
        True,
        500000,
        0,
        None,
        "Deposit of Funds at Agent Till 104552 - JUJA RD AGENCIES",
        "Juja Rd Agencies",
        1365100,
    ),
    (
        "2024-07-05 10:30:00",
        "MERCHANT_PAYMENT",
        False,
        95000,
        0,
        None,
        "Merchant Payment to 301290 - ARTCAFFE COFFEE",
        "Artcaffe Coffee",
        1270100,
    ),
    (
        "2024-07-05 12:00:00",
        "TRANSFER_IN",
        True,
        1000000,
        0,
        None,
        "Funds received from {2} - MARY WANJIKU",
        "Mary Wanjiku",
        2270100,
    ),
    (
        "2024-07-05 20:10:00",
        "TRANSFER_OUT",
        False,
        250000,
        3300,
        0,
        "Customer Transfer to {2} - MARY WANJIKU",
        "Mary Wanjiku",
        2016800,
    ),
    (
        "2024-07-06 07:30:00",
        "AIRTIME_PURCHASE",
        False,
        10000,
        0,
        None,
        "Airtime Purchase",
        "Safaricom Airtime",
        2006800,
    ),
    (
        "2024-07-06 18:20:00",
        "MERCHANT_PAYMENT",
        False,
        150000,
        0,
        None,
        "Merchant Payment to 882190 - NAIVAS SUPERMARKET WESTLANDS",
        "Naivas Supermarket",
        1856800,
    ),
    (
        "2024-07-07 21:00:00",
        "BUNDLE_PURCHASE",
        False,
        25000,
        0,
        None,
        "Customer Bundle Purchase",
        "Safaricom Data Bundles",
        1831800,
    ),
    (
        "2024-07-07 22:10:00",
        "BILL_PAYMENT",
        False,
        39000,
        700,
        1,
        "Pay Bill to 600500 - BOLT MOBILITY Acc. {0}",
        "Bolt Mobility",
        1792100,
    ),
    (
        "2024-07-08 07:50:00",
        "MERCHANT_PAYMENT",
        False,
        240000,
        0,
        None,
        "Merchant Payment to 542011 - SHELL PETROL STATION LAVINGTON",
        "Shell Petrol Station",
        1552100,
    ),
    (
        "2024-07-08 13:00:00",
        "TRANSFER_OUT",
        False,
        150000,
        2300,
        0,
        "Customer Transfer to {3} - PETER OTIENO",
        "Peter Otieno",
        1399800,
    ),
    (
        "2024-07-08 18:50:00",
        "MERCHANT_PAYMENT",
        False,
        48000,
        0,
        None,
        "Merchant Payment to 556301 - JUJA RD BUTCHERY",
        "Juja Rd Butchery",
        1351800,
    ),
    (
        "2024-07-09 07:30:00",
        "AIRTIME_PURCHASE",
        False,
        10000,
        0,
        None,
        "Airtime Purchase",
        "Safaricom Airtime",
        1341800,
    ),
    (
        "2024-07-09 18:30:00",
        "WITHDRAWAL",
        False,
        115000,
        2900,
        2,
        "Withdrawal at Agent Till 104552 - JUJA RD AGENCIES",
        "Juja Rd Agencies",
        1223900,
    ),
    (
        "2024-07-09 19:20:00",
        "MERCHANT_PAYMENT",
        False,
        160000,
        0,
        None,
        "Merchant Payment to 914022 - QUICKMART KILIMANI",
        "Quickmart Kilimani",
        1063900,
    ),
    (
        "2024-07-10 08:00:00",
        "BILL_PAYMENT",
        False,
        46000,
        700,
        1,
        "Pay Bill to 600500 - BOLT MOBILITY Acc. {0}",
        "Bolt Mobility",
        1017200,
    ),
    (
        "2024-07-10 15:00:00",
        "TRANSFER_IN",
        True,
        600000,
        0,
        None,
        "Funds received from {1} - DANIEL OCHIENG",
        "Daniel Ochieng",
        1617200,
    ),
    (
        "2024-07-11 07:30:00",
        "AIRTIME_PURCHASE",
        False,
        10000,
        0,
        None,
        "Airtime Purchase",
        "Safaricom Airtime",
        1607200,
    ),
    (
        "2024-07-11 17:15:00",
        "DEPOSIT",
        True,
        500000,
        0,
        None,
        "Deposit of Funds at Agent Till 104552 - JUJA RD AGENCIES",
        "Juja Rd Agencies",
        2107200,
    ),
    (
        "2024-07-11 19:30:00",
        "TRANSFER_OUT",
        False,
        100000,
        1300,
        0,
        "Customer Transfer to {4} - GRACE AKINYI",
        "Grace Akinyi",
        2005900,
    ),
    (
        "2024-07-12 09:45:00",
        "MERCHANT_PAYMENT",
        False,
        80000,
        0,
        None,
        "Merchant Payment to 301290 - ARTCAFFE COFFEE",
        "Artcaffe Coffee",
        1925900,
    ),
    (
        "2024-07-12 10:20:00",
        "BILL_PAYMENT",
        False,
        185000,
        2300,
        1,
        "Pay Bill to 444400 - NAIROBI CITY WATER Acc. NCW-10492",
        "Nairobi City Water",
        1738600,
    ),
    (
        "2024-07-12 14:15:00",
        "UNCLASSIFIED",
        False,
        1000000,
        0,
        None,
        "M-Shwari Lock Savings Deposit",
        "M-Shwari Lock Savings",
        738600,
    ),
    (
        "2024-07-12 21:00:00",
        "BUNDLE_PURCHASE",
        False,
        25000,
        0,
        None,
        "Customer Bundle Purchase",
        "Safaricom Data Bundles",
        713600,
    ),
    (
        "2024-07-13 11:05:00",
        "MERCHANT_PAYMENT",
        False,
        120000,
        0,
        None,
        "Merchant Payment to 882190 - NAIVAS SUPERMARKET KILIMANI",
        "Naivas Supermarket",
        593600,
    ),
    (
        "2024-07-13 23:40:00",
        "BILL_PAYMENT",
        False,
        53000,
        700,
        1,
        "Pay Bill to 600500 - BOLT MOBILITY Acc. {0}",
        "Bolt Mobility",
        539900,
    ),
    (
        "2024-07-14 07:30:00",
        "AIRTIME_PURCHASE",
        False,
        10000,
        0,
        None,
        "Airtime Purchase",
        "Safaricom Airtime",
        529900,
    ),
    (
        "2024-07-14 09:15:00",
        "TRANSFER_OUT",
        False,
        80000,
        1300,
        0,
        "Customer Transfer to {2} - MARY WANJIKU",
        "Mary Wanjiku",
        448600,
    ),
    (
        "2024-07-14 16:30:00",
        "MERCHANT_PAYMENT",
        False,
        61000,
        0,
        None,
        "Merchant Payment to 661204 - GITHURAI FRESH MART",
        "Githurai Fresh Mart",
        387600,
    ),
    (
        "2024-07-14 17:30:00",
        "TRANSFER_IN",
        True,
        500000,
        0,
        None,
        "Funds received from {4} - GRACE AKINYI",
        "Grace Akinyi",
        887600,
    ),
    (
        "2024-07-15 07:58:00",
        "BILL_PAYMENT",
        False,
        44500,
        700,
        1,
        "Pay Bill to 600500 - BOLT MOBILITY Acc. {0}",
        "Bolt Mobility",
        842400,
    ),
    (
        "2024-07-15 10:00:00",
        "UNCLASSIFIED",
        False,
        125000,
        0,
        None,
        "M-PESA Global Pay to 512400 Acc. 99812",
        "Unrecognised payment 512400",
        717400,
    ),
    (
        "2024-07-15 12:40:00",
        "MERCHANT_PAYMENT",
        False,
        132000,
        0,
        None,
        "Merchant Payment to 914022 - QUICKMART KILIMANI",
        "Quickmart Kilimani",
        585400,
    ),
    (
        "2024-07-16 07:30:00",
        "AIRTIME_PURCHASE",
        False,
        10000,
        0,
        None,
        "Airtime Purchase",
        "Safaricom Airtime",
        575400,
    ),
    (
        "2024-07-16 12:45:00",
        "TRANSFER_OUT",
        False,
        50000,
        700,
        0,
        "Customer Transfer to {5} - KEVIN KIPROP",
        "Kevin Kiprop",
        524700,
    ),
    (
        "2024-07-16 19:10:00",
        "MERCHANT_PAYMENT",
        False,
        90000,
        0,
        None,
        "Merchant Payment to 882190 - NAIVAS SUPERMARKET WESTLANDS",
        "Naivas Supermarket",
        434700,
    ),
    (
        "2024-07-17 08:10:00",
        "MERCHANT_PAYMENT",
        False,
        200000,
        0,
        None,
        "Merchant Payment to 542011 - SHELL PETROL STATION LAVINGTON",
        "Shell Petrol Station",
        234700,
    ),
    (
        "2024-07-17 14:00:00",
        "TRANSFER_IN",
        True,
        350000,
        0,
        None,
        "Funds received from {3} - PETER OTIENO",
        "Peter Otieno",
        584700,
    ),
    (
        "2024-07-17 21:00:00",
        "BUNDLE_PURCHASE",
        False,
        25000,
        0,
        None,
        "Customer Bundle Purchase",
        "Safaricom Data Bundles",
        559700,
    ),
    (
        "2024-07-18 08:02:00",
        "BILL_PAYMENT",
        False,
        38000,
        700,
        1,
        "Pay Bill to 600500 - BOLT MOBILITY Acc. {0}",
        "Bolt Mobility",
        521000,
    ),
    (
        "2024-07-18 13:10:00",
        "MERCHANT_PAYMENT",
        False,
        45000,
        0,
        None,
        "Merchant Payment to 340977 - KIBANDASKI CORNER",
        "Kibandaski Corner",
        476000,
    ),
    (
        "2024-07-18 16:50:00",
        "DEPOSIT",
        True,
        500000,
        0,
        None,
        "Deposit of Funds at Agent Till 104552 - JUJA RD AGENCIES",
        "Juja Rd Agencies",
        976000,
    ),
    (
        "2024-07-19 07:30:00",
        "AIRTIME_PURCHASE",
        False,
        10000,
        0,
        None,
        "Airtime Purchase",
        "Safaricom Airtime",
        966000,
    ),
    (
        "2024-07-19 10:15:00",
        "MERCHANT_PAYMENT",
        False,
        75000,
        0,
        None,
        "Merchant Payment to 301290 - ARTCAFFE COFFEE",
        "Artcaffe Coffee",
        891000,
    ),
    (
        "2024-07-19 11:00:00",
        "TRANSFER_IN",
        True,
        300000,
        0,
        None,
        "Funds received from {6} - SUSAN WAMBUI",
        "Susan Wambui",
        1191000,
    ),
    (
        "2024-07-19 11:08:00",
        "UNCLASSIFIED",
        True,
        7500000,
        0,
        None,
        "Business Payment from 400200 - CONSOLIDATED ADVISORY LLC via API",
        "Consolidated Advisory LLC",
        8691000,
    ),
    (
        "2024-07-19 18:00:00",
        "TRANSFER_OUT",
        False,
        50000,
        700,
        0,
        "Customer Transfer to {4} - GRACE AKINYI",
        "Grace Akinyi",
        8640300,
    ),
    (
        "2024-07-20 10:30:00",
        "TRANSFER_OUT",
        False,
        40000,
        700,
        0,
        "Customer Transfer to {3} - PETER OTIENO",
        "Peter Otieno",
        8599600,
    ),
    (
        "2024-07-20 16:00:00",
        "UNCLASSIFIED",
        False,
        85000,
        0,
        None,
        "Customer Payment to Small Business to {7} - NAIVAS PARTNER",
        "Small business {7}",
        8514600,
    ),
    (
        "2024-07-20 18:35:00",
        "MERCHANT_PAYMENT",
        False,
        110000,
        0,
        None,
        "Merchant Payment to 914022 - QUICKMART KILIMANI",
        "Quickmart Kilimani",
        8404600,
    ),
    (
        "2024-07-21 07:30:00",
        "AIRTIME_PURCHASE",
        False,
        10000,
        0,
        None,
        "Airtime Purchase",
        "Safaricom Airtime",
        8394600,
    ),
    (
        "2024-07-21 11:30:00",
        "BILL_PAYMENT",
        False,
        1000000,
        0,
        None,
        "Pay Bill to 303030 - STANBIC MMF Acc. 99824",
        "Stanbic Money Market Fund",
        7394600,
    ),
    (
        "2024-07-21 18:40:00",
        "WITHDRAWAL",
        False,
        115000,
        2900,
        2,
        "Withdrawal at Agent Till 198421 - KWALITY STORES AGENT",
        "Kwality Stores Agent",
        7276700,
    ),
    (
        "2024-07-22 18:20:00",
        "BILL_PAYMENT",
        False,
        49500,
        700,
        1,
        "Pay Bill to 600500 - BOLT MOBILITY Acc. {0}",
        "Bolt Mobility",
        7226500,
    ),
    (
        "2024-07-22 19:45:00",
        "MERCHANT_PAYMENT",
        False,
        842000,
        0,
        None,
        "Merchant Payment to 882190 - NAIVAS SUPERMARKET WESTLANDS",
        "Naivas Supermarket",
        6384500,
    ),
    (
        "2024-07-22 21:00:00",
        "BUNDLE_PURCHASE",
        False,
        25000,
        0,
        None,
        "Customer Bundle Purchase",
        "Safaricom Data Bundles",
        6359500,
    ),
    (
        "2024-07-23 13:30:00",
        "TRANSFER_IN",
        True,
        200000,
        0,
        None,
        "Funds received from {2} - MARY WANJIKU",
        "Mary Wanjiku",
        6559500,
    ),
    (
        "2024-07-23 16:20:00",
        "TRANSFER_OUT",
        False,
        30000,
        700,
        0,
        "Customer Transfer to {8} - FAITH MUTHONI",
        "Faith Muthoni",
        6528800,
    ),
    (
        "2024-07-23 18:05:00",
        "MERCHANT_PAYMENT",
        False,
        39800,
        0,
        None,
        "Merchant Payment to 778120 - MAMA PIMA GROCERIES",
        "Mama Pima Groceries",
        6489000,
    ),
    (
        "2024-07-24 07:30:00",
        "AIRTIME_PURCHASE",
        False,
        10000,
        0,
        None,
        "Airtime Purchase",
        "Safaricom Airtime",
        6479000,
    ),
    (
        "2024-07-24 08:40:00",
        "TRANSFER_OUT",
        False,
        30000,
        700,
        0,
        "Customer Transfer to {5} - KEVIN KIPROP",
        "Kevin Kiprop",
        6448300,
    ),
    (
        "2024-07-24 17:05:00",
        "MERCHANT_PAYMENT",
        False,
        500000,
        0,
        None,
        "Merchant Payment to 542011 - SHELL PETROL STATION LAVINGTON",
        "Shell Petrol Station",
        5948300,
    ),
    (
        "2024-07-25 08:10:00",
        "BILL_PAYMENT",
        False,
        41000,
        700,
        1,
        "Pay Bill to 600500 - BOLT MOBILITY Acc. {0}",
        "Bolt Mobility",
        5906600,
    ),
    (
        "2024-07-26 07:30:00",
        "AIRTIME_PURCHASE",
        False,
        10000,
        0,
        None,
        "Airtime Purchase",
        "Safaricom Airtime",
        5896600,
    ),
    (
        "2024-07-26 11:00:00",
        "MERCHANT_PAYMENT",
        False,
        70000,
        0,
        None,
        "Merchant Payment to 301290 - ARTCAFFE COFFEE",
        "Artcaffe Coffee",
        5826600,
    ),
    (
        "2024-07-26 16:00:00",
        "TRANSFER_IN",
        True,
        150000,
        0,
        None,
        "Funds received from {1} - DANIEL OCHIENG",
        "Daniel Ochieng",
        5976600,
    ),
    (
        "2024-07-26 19:05:00",
        "TRANSFER_OUT",
        False,
        20000,
        700,
        0,
        "Customer Transfer to {8} - FAITH MUTHONI",
        "Faith Muthoni",
        5955900,
    ),
    (
        "2024-07-27 08:15:00",
        "BILL_PAYMENT",
        False,
        48000,
        700,
        1,
        "Pay Bill to 600500 - BOLT MOBILITY Acc. {0}",
        "Bolt Mobility",
        5907200,
    ),
    (
        "2024-07-27 13:15:00",
        "MERCHANT_PAYMENT",
        False,
        100000,
        0,
        None,
        "Merchant Payment to 914022 - QUICKMART KILIMANI",
        "Quickmart Kilimani",
        5807200,
    ),
    (
        "2024-07-27 21:00:00",
        "BUNDLE_PURCHASE",
        False,
        25000,
        0,
        None,
        "Customer Bundle Purchase",
        "Safaricom Data Bundles",
        5782200,
    ),
    (
        "2024-07-28 14:22:00",
        "TRANSFER_OUT",
        False,
        1000000,
        10500,
        0,
        "Customer Transfer to {9} - JOHN MWANGI",
        "John Mwangi",
        4771700,
    ),
    (
        "2024-07-28 18:05:00",
        "INVESTMENT",
        False,
        500000,
        0,
        None,
        "Unit Trust Invest to 4105050 - MALI SAFARICOM UNIT TRUST",
        "Mali Safaricom Unit Trust",
        4271700,
    ),
    (
        "2024-07-28 19:42:00",
        "MERCHANT_PAYMENT",
        False,
        412000,
        0,
        None,
        "Merchant Payment to 882190 - NAIVAS SUPERMARKET KILIMANI",
        "Naivas Supermarket",
        3859700,
    ),
    (
        "2024-07-29 07:30:00",
        "AIRTIME_PURCHASE",
        False,
        10000,
        0,
        None,
        "Airtime Purchase",
        "Safaricom Airtime",
        3849700,
    ),
    (
        "2024-07-29 11:10:00",
        "TRANSFER_OUT",
        False,
        20000,
        700,
        0,
        "Customer Transfer to {9} - JOHN MWANGI",
        "John Mwangi",
        3829000,
    ),
    (
        "2024-07-29 18:45:00",
        "TRANSFER_IN",
        True,
        100000,
        0,
        None,
        "Funds received from {5} - KEVIN KIPROP",
        "Kevin Kiprop",
        3929000,
    ),
    (
        "2024-07-29 19:00:00",
        "MERCHANT_PAYMENT",
        False,
        55000,
        0,
        None,
        "Merchant Payment to 556301 - JUJA RD BUTCHERY",
        "Juja Rd Butchery",
        3874000,
    ),
    (
        "2024-07-30 07:50:00",
        "BILL_PAYMENT",
        False,
        37000,
        700,
        1,
        "Pay Bill to 600500 - BOLT MOBILITY Acc. {0}",
        "Bolt Mobility",
        3836300,
    ),
    (
        "2024-07-30 09:00:00",
        "TRANSFER_OUT",
        False,
        15000,
        700,
        0,
        "Customer Transfer to {2} - MARY WANJIKU",
        "Mary Wanjiku",
        3820600,
    ),
    (
        "2024-07-30 17:30:00",
        "MERCHANT_PAYMENT",
        False,
        70000,
        0,
        None,
        "Merchant Payment to 882190 - NAIVAS SUPERMARKET KILIMANI",
        "Naivas Supermarket",
        3750600,
    ),
    (
        "2024-07-30 19:15:00",
        "WITHDRAWAL",
        False,
        115000,
        2900,
        2,
        "Withdrawal at Agent Till 198421 - KWALITY STORES AGENT",
        "Kwality Stores Agent",
        3632700,
    ),
    (
        "2024-07-30 20:00:00",
        "TRANSFER_IN",
        True,
        50000,
        0,
        None,
        "Funds received from {6} - SUSAN WAMBUI",
        "Susan Wambui",
        3682700,
    ),
    (
        "2024-07-31 18:30:00",
        "TRANSFER_OUT",
        False,
        15000,
        700,
        0,
        "Customer Transfer to {3} - PETER OTIENO",
        "Peter Otieno",
        3667000,
    ),
)


def _prototype_rows():
    """F5: each sample row as its transaction, then its charge as a separate FEE row.

    The charge shares the row's receipt and time, as a statement prints it. The sample's balance
    goes on the pair's last row, for the conversion check.

    Returns:
        The ``ScenarioRow`` tuple.

    Side Effects:
        None.
    """
    rows = []
    for line, sample_row in enumerate(PROTOTYPE_SAMPLE, start=1):
        time, kind, money_in, amount, charge, fee_line, details, entity, balance = sample_row
        code = f"PS{line:06d}"
        paid_in, paid_out = (amount, 0) if money_in else (0, amount)
        parent_balance = None if charge else balance
        rows.append(
            ScenarioRow(code, time, kind, paid_in, paid_out, details, entity, parent_balance)
        )
        if charge:
            rows.append(
                ScenarioRow(code, time, "FEE", 0, charge, FEE_LINES[fee_line], NO_ENTITY, balance)
            )
    return tuple(rows)


def _hourly(day, first_hour):
    """Give a row's completion time: one row an hour from ``first_hour`` on ``day``.

    Args:
        day: The date, e.g. "2026-09-01".
        first_hour: The first row's hour.

    Returns:
        A function of the row's position.

    Side Effects:
        None.
    """
    return lambda position: f"{day} {first_hour + position:02d}:00:00"


SCENARIOS = {
    scenario.name: scenario
    for scenario in (
        Scenario(
            "F1-worked-example",
            1,
            50_000,
            _rows(WORKED_EXAMPLE, lambda position: f"2026-07-01 08:{position:02d}:00"),
        ),
        Scenario("F2-tied-timestamps", 2, 10_000, _timed_rows(TIED)),
        Scenario("F3-invalid-timestamps", 3, 0, _timed_rows(INVALID), printable=False),
        Scenario("F4-paginated-2345", 4, 0, _large_rows(), printable=False),
        Scenario("F5-prototype-converted", 5, PROTOTYPE_OPENING_CENTS, _prototype_rows()),
        Scenario("S-stress-overview", 1, 8_000_000, _stress_rows()),
        Scenario("S-no-spending", 1, 300_000, _rows(NO_SPENDING, _hourly("2026-09-01", 9))),
        Scenario("S-people-edge-cases", 1, 1_000_000, _rows(PEOPLE, _hourly("2026-10-01", 8))),
        Scenario("S-savings-edge-cases", 1, 200_000, _timed_rows(SAVINGS)),
        Scenario("S-cash-edge-cases", 1, 100_000, _timed_rows(CASH)),
    )
}
