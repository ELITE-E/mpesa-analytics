"""The classes a transaction is sorted into.

String enums, so each member equals its own value; that avoids the D-01 family of bugs.
"""

from enum import StrEnum


class FinancialEvent(StrEnum):
    """What happened in a transaction, read from its details."""

    MERCHANT_PAYMENT = "MERCHANT_PAYMENT"
    BILL_PAYMENT = "BILL_PAYMENT"
    TRANSFER_IN = "TRANSFER_IN"
    TRANSFER_OUT = "TRANSFER_OUT"
    WITHDRAWAL = "WITHDRAWAL"
    DEPOSIT = "DEPOSIT"
    INVESTMENT = "INVESTMENT"
    # Named by the old code, but no rule produces it.
    LOAN_REPAYMENT = "LOAN_REPAYMENT"
    AIRTIME_PURCHASE = "AIRTIME_PURCHASE"
    BUNDLE_PURCHASE = "BUNDLE_PURCHASE"
    REVERSAL = "REVERSAL"
    FEE = "FEE"
    UNCLASSIFIED = "UNCLASSIFIED"


class CashFlowDirection(StrEnum):
    """Whether money came into the wallet or left it."""

    INFLOW = "INFLOW"
    OUTFLOW = "OUTFLOW"


class EconomicMeaning(StrEnum):
    """What a transaction means economically, derived from its event type."""

    CONSUMPTION = "CONSUMPTION"
    INVESTMENT = "INVESTMENT"
    INFLOW = "INFLOW"
    ASSET_TRANSFER = "ASSET_TRANSFER"
    FEE = "FEE"
    REVERSAL = "REVERSAL"
    UNKNOWN = "UNKNOWN"
    NOT_DETERMINABLE = "NOT_DETERMINABLE"
