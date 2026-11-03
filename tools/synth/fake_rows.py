"""Fake transactions for synthetic statements. Values stay inside the ranges in guards.toml."""

import random
import string
from datetime import datetime, timedelta

ALPHANUMERIC = string.ascii_uppercase + string.digits
DIGITS = string.digits
RECEIPT_PREFIX = "ZZ"
MASKED_PHONE_PREFIX = "2547" + "*****"
RECEIPT_SUFFIX_LENGTH = 8
START_TIME = datetime(2026, 1, 1, 8, 0, 0)
OPENING_CENTS = 500_000
LOW_BALANCE_CENTS = 300_000
TRANSFER_FEE_CENTS = 1_300
PAY_BILL_FEE_CENTS = 2_500
MAX_GAP_MINUTES = 900
FEE_FIRST = "fee_first"
PARENT_FIRST = "parent_first"
SINGLE_LINE_SHARE = 0.6
SINGLE_ROW_BUILDERS = ("merchant", "airtime", "received")
PAIR_BUILDERS = ("transfer", "pay_bill")


def build_fake_rows(seed_text, row_count, *, pair_orders=None):
    """Build fake transactions with a running balance, newest first as a statement prints them.

    Args:
        seed_text: Text that seeds the random choices.
        row_count: Exact number of rows to build.
        pair_orders: Print orders to cycle through, making every transaction a parent and fee
            pair at the same second. By default pairs print fee first and singles are mixed in.

    Returns:
        Row maps with ``time``, ``receipt_no``, ``details``, ``paid_in_cents``,
        ``withdrawn_cents`` and ``balance_cents``, in print order.

    Side Effects:
        None.
    """
    rng = random.Random(seed_text)
    builder = _RowBuilder(rng)
    print_groups = []
    built = 0
    while built < row_count:
        remaining = row_count - built
        order = pair_orders[len(print_groups) % len(pair_orders)] if pair_orders else FEE_FIRST
        group = builder.next_group(remaining, pair_only=bool(pair_orders), order=order)
        print_groups.append(group)
        built += len(group)
    return [row for group in reversed(print_groups) for row in reversed(group)]


class _RowBuilder:
    """Tracks the running balance, clock and used receipts while rows are built."""

    def __init__(self, rng):
        """Start at the opening balance.

        Args:
            rng: Seeded random source.

        Side Effects:
            None.
        """
        self.rng = rng
        self.balance_cents = OPENING_CENTS
        self.time = START_TIME
        self.used_receipts = set()

    def next_group(self, remaining, *, pair_only, order):
        """Build the rows of the next transaction, oldest first.

        Args:
            remaining: How many rows are still wanted, so a pair never overshoots.
            pair_only: Whether to build only parent and fee pairs.
            order: Print order of a pair, ``fee_first`` or ``parent_first``.

        Returns:
            One row, or a parent and fee pair at the same second.

        Side Effects:
            Advances the clock and the running balance.
        """
        self.time += timedelta(minutes=1 + int(self.rng.random() * MAX_GAP_MINUTES))
        if remaining >= 2 and (pair_only or self.rng.random() < 0.3):
            return self._build_pair(order)
        return [self._build_single()]

    def _build_single(self):
        """Build one transaction with no fee, topping up when the balance runs low.

        Returns:
            The row.

        Side Effects:
            Advances the running balance.
        """
        kind = self._pick(SINGLE_ROW_BUILDERS)
        receipt = self._new_receipt()
        if kind == "received" or self.balance_cents < LOW_BALANCE_CENTS:
            details = self._received_details()
            return self._row(receipt, details, paid_in_cents=self._amount_cents(20_000, 900_000))
        if kind == "merchant":
            details = self._merchant_details()
            return self._row(receipt, details, withdrawn_cents=self._amount_cents(5_000, 80_000))
        withdrawn_cents = self._amount_cents(500, 5_000)
        return self._row(receipt, "Airtime Purchase", withdrawn_cents=withdrawn_cents)

    def _received_details(self):
        """Choose what a money-in row says, short enough for one line most of the time.

        Returns:
            The details text.

        Side Effects:
            None.
        """
        person = self._digits(2)
        if self.rng.random() < SINGLE_LINE_SHARE:
            return f"Funds received - Example Person {person}"
        return f"Funds received from 07000000{person} - Example Person {person}"

    def _merchant_details(self):
        """Choose what a merchant row says, short enough for one line most of the time.

        Returns:
            The details text.

        Side Effects:
            None.
        """
        till = self._digits(3)
        if self.rng.random() < SINGLE_LINE_SHARE:
            return f"Merchant Payment Example Till {till}"
        return f"Merchant Payment to Example Till {till} - Synthetic Online Purchase Order"

    def _build_pair(self, order):
        """Build a parent and its fee, sharing a receipt and a second.

        Args:
            order: Print order, ``fee_first`` or ``parent_first``. The row printed lower is the
                one applied first, so the balance chain holds in print order either way.

        Returns:
            The two rows, oldest first.

        Side Effects:
            Advances the running balance.
        """
        receipt = self._new_receipt()
        parent_details, fee_details, fee_cents = self._pair_details()
        amount_cents = self._amount_cents(10_000, 150_000)
        if order == FEE_FIRST:
            parent = self._row(receipt, parent_details, withdrawn_cents=amount_cents)
            return [parent, self._row(receipt, fee_details, withdrawn_cents=fee_cents)]
        fee = self._row(receipt, fee_details, withdrawn_cents=fee_cents)
        return [fee, self._row(receipt, parent_details, withdrawn_cents=amount_cents)]

    def _pair_details(self):
        """Choose what a parent and fee pair says.

        Returns:
            Tuple of parent details, fee details and the fee in cents.

        Side Effects:
            None.
        """
        if self._pick(PAIR_BUILDERS) == "transfer":
            tail = self._digits(2)
            return (
                f"Customer Transfer to {MASKED_PHONE_PREFIX}0{tail} - Example Person {tail}",
                "Customer Transfer of Funds Charge",
                TRANSFER_FEE_CENTS,
            )
        till = self._digits(3)
        return (
            f"Pay Bill Online to Example Till {till} - Acc. Synthetic Account Number",
            "Pay Bill Charge",
            PAY_BILL_FEE_CENTS,
        )

    def _row(self, receipt, details, *, paid_in_cents=0, withdrawn_cents=0):
        """Apply one row to the running balance.

        Args:
            receipt: Receipt number.
            details: Details text.
            paid_in_cents: Amount paid in, in cents.
            withdrawn_cents: Amount withdrawn, in cents.

        Returns:
            The row.

        Side Effects:
            Advances the running balance.
        """
        self.balance_cents += paid_in_cents - withdrawn_cents
        return {
            "time": self.time,
            "receipt_no": receipt,
            "details": details,
            "paid_in_cents": paid_in_cents,
            "withdrawn_cents": withdrawn_cents,
            "balance_cents": self.balance_cents,
        }

    def _new_receipt(self):
        """Make an unused fake receipt number.

        Returns:
            ``ZZ`` plus 8 characters, including at least one digit.

        Side Effects:
            Records the receipt as used.
        """
        while True:
            suffix = "".join(self._pick(ALPHANUMERIC) for _ in range(RECEIPT_SUFFIX_LENGTH - 1))
            receipt = f"{RECEIPT_PREFIX}{suffix}{self._pick(DIGITS)}"
            if receipt not in self.used_receipts:
                self.used_receipts.add(receipt)
                return receipt

    def _amount_cents(self, low, high):
        """Pick an amount in whole shillings.

        Args:
            low: Smallest amount, in cents.
            high: Largest amount, in cents.

        Returns:
            The amount in cents.

        Side Effects:
            None.
        """
        return (low + int(self.rng.random() * (high - low))) // 100 * 100

    def _digits(self, count):
        """Pick a run of digits.

        Args:
            count: How many digits.

        Returns:
            The digits as text.

        Side Effects:
            None.
        """
        return "".join(self._pick(DIGITS) for _ in range(count))

    def _pick(self, choices):
        """Pick one choice using only ``random()``, whose sequence is stable across Python versions.

        Args:
            choices: A sequence.

        Returns:
            One element.

        Side Effects:
            None.
        """
        return choices[int(self.rng.random() * len(choices))]
