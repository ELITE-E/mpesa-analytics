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
PAIR_SHARE = 0.3
# In a pairs-only statement, one pair in this many is money in, so every amount column prints.
PAID_IN_PAIR_EVERY = 3
BREAK_SHIFT_CENTS = 77_700
SINGLE_ROW_BUILDERS = ("merchant", "airtime", "received")
PAIR_BUILDERS = ("transfer", "pay_bill")


def build_fake_rows(
    seed_text,
    row_count,
    *,
    pair_orders=None,
    single_line_share=SINGLE_LINE_SHARE,
    pair_share=PAIR_SHARE,
):
    """Build fake transactions with a running balance, newest first as a statement prints them.

    Args:
        seed_text: Text that seeds the random choices.
        row_count: Exact number of rows to build.
        pair_orders: Print orders to cycle through, making every transaction a parent and fee
            pair at the same second. By default pairs print fee first and singles are mixed in.
        single_line_share: Share of single rows whose details are short enough for one line.
        pair_share: Share of transactions built as a parent and fee pair, when not pairs-only.

    Returns:
        Row maps with ``time``, ``receipt_no``, ``details``, ``paid_in_cents``,
        ``withdrawn_cents`` and ``balance_cents``, in print order.

    Side Effects:
        None.
    """
    rng = random.Random(seed_text)
    builder = _RowBuilder(rng, single_line_share=single_line_share, pair_share=pair_share)
    print_groups = []
    built = 0
    while built < row_count:
        remaining = row_count - built
        order = pair_orders[len(print_groups) % len(pair_orders)] if pair_orders else FEE_FIRST
        is_paid_in_pair = bool(pair_orders) and len(print_groups) % PAID_IN_PAIR_EVERY == (
            PAID_IN_PAIR_EVERY - 1
        )
        group = builder.next_group(
            remaining, pair_only=bool(pair_orders), order=order, paid_in_parent=is_paid_in_pair
        )
        print_groups.append(group)
        built += len(group)
    return [row for group in reversed(print_groups) for row in reversed(group)]


def plant_chain_breaks(fake_rows, count):
    """Break the balance chain at known places, as if transactions were missing from the statement.

    Shifting every row newer than a link breaks that link alone. Changing one balance would break
    two links, and the count would no longer be the number planted.

    Args:
        fake_rows: Rows in print order, newest first.
        count: How many links to break. The first same-receipt link is always one of them.

    Returns:
        New rows with shifted balances; the input is unchanged.

    Side Effects:
        None.
    """
    link_count = len(fake_rows) - 1
    same_receipt = [
        link
        for link in range(link_count)
        if fake_rows[link]["receipt_no"] == fake_rows[link + 1]["receipt_no"]
    ]
    spaced = range(0, link_count, max(1, link_count // count))
    links = list(dict.fromkeys([*same_receipt[:1], *spaced]))[:count]
    shifted = []
    for position, row in enumerate(fake_rows):
        planted_below = sum(position <= link for link in links)
        balance_cents = row["balance_cents"] + planted_below * BREAK_SHIFT_CENTS
        shifted.append({**row, "balance_cents": balance_cents})
    return shifted


class _RowBuilder:
    """Tracks the running balance, clock and used receipts while rows are built."""

    def __init__(self, rng, *, single_line_share, pair_share):
        """Start at the opening balance.

        Args:
            rng: Seeded random source.
            single_line_share: Share of single rows with short details.
            pair_share: Share of transactions built as a parent and fee pair.

        Side Effects:
            None.
        """
        self.rng = rng
        self.single_line_share = single_line_share
        self.pair_share = pair_share
        self.balance_cents = OPENING_CENTS
        self.time = START_TIME
        self.used_receipts = set()

    def next_group(self, remaining, *, pair_only, order, paid_in_parent):
        """Build the rows of the next transaction, oldest first.

        Args:
            remaining: How many rows are still wanted, so a pair never overshoots.
            pair_only: Whether to build only parent and fee pairs.
            order: Print order of a pair, ``fee_first`` or ``parent_first``.
            paid_in_parent: Whether a pair's parent is money in rather than money out.

        Returns:
            One row, or a parent and fee pair at the same second.

        Side Effects:
            Advances the clock and the running balance.
        """
        self.time += timedelta(minutes=1 + int(self.rng.random() * MAX_GAP_MINUTES))
        if remaining >= 2 and (pair_only or self.rng.random() < self.pair_share):
            return self._build_paid_in_pair(order) if paid_in_parent else self._build_pair(order)
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
        if self.rng.random() < self.single_line_share:
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
        if self.rng.random() < self.single_line_share:
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

    def _build_paid_in_pair(self, order):
        """Build money in and its fee, sharing a receipt and a second.

        Args:
            order: Print order, ``fee_first`` or ``parent_first``. See ``_build_pair``.

        Returns:
            The two rows, oldest first.

        Side Effects:
            Advances the running balance.
        """
        receipt = self._new_receipt()
        details = f"Business Payment from Example Till {self._digits(3)}"
        paid_in_cents = self._amount_cents(100_000, 400_000)
        fee_details = "Funds Receipt Charge"
        if order == FEE_FIRST:
            parent = self._row(receipt, details, paid_in_cents=paid_in_cents)
            return [parent, self._row(receipt, fee_details, withdrawn_cents=TRANSFER_FEE_CENTS)]
        fee = self._row(receipt, fee_details, withdrawn_cents=TRANSFER_FEE_CENTS)
        return [fee, self._row(receipt, details, paid_in_cents=paid_in_cents)]

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
