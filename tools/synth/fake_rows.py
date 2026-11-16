"""Fake transactions for synthetic statements. Values stay inside the ranges in guards.toml."""

import random
import string
from dataclasses import dataclass
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
TIED_TIME_EVERY = 8
FEE_FIRST = "fee_first"
PARENT_FIRST = "parent_first"
SINGLE_LINE_SHARE = 0.6
PAIR_SHARE = 0.3
# In a pairs-only statement, one pair in this many is money in, so every amount column prints.
PAID_IN_PAIR_EVERY = 3
BREAK_SHIFT_CENTS = 77_700
# Single transactions: money in or out, the amount range in cents, and the event type printed.
SINGLE_ROW_KINDS = {
    "merchant": ("out", 5_000, 80_000),
    "airtime": ("out", 500, 5_000),
    "received": ("in", 20_000, 900_000),
    "bundle": ("out", 2_000, 20_000),
    "investment": ("out", 10_000, 100_000),
    "deposit": ("in", 50_000, 500_000),
    "reversal": ("in", 5_000, 50_000),
    "unclassified": ("out", 1_000, 50_000),
}
SINGLE_ROW_BUILDERS = tuple(SINGLE_ROW_KINDS)
PAIR_BUILDERS = ("transfer", "pay_bill")
UNCLASSIFIED = "UNCLASSIFIED"


@dataclass(frozen=True)
class RowMix:
    """How the rows are mixed: short details, parent and fee pairs, and tied values."""

    single_line_share: float = SINGLE_LINE_SHARE
    pair_share: float = PAIR_SHARE
    # Every amount at the bottom of its range and most transactions at the second before, so
    # amounts and times tie often.
    tied_values: bool = False


def build_fake_rows(
    seed_text,
    row_count,
    *,
    pair_orders=None,
    mix=None,
):
    """Build fake transactions with a running balance, newest first as a statement prints them.

    Args:
        seed_text: Text that seeds the random choices.
        row_count: Exact number of rows to build.
        pair_orders: Print orders to cycle through, making every transaction a parent and fee
            pair at the same second. By default pairs print fee first and singles are mixed in.
        mix: A ``RowMix``: shares of short details and of pairs, and whether values tie often.
            The default mix by default.

    Returns:
        Row maps with ``time``, ``receipt_no``, ``details``, ``paid_in_cents``,
        ``withdrawn_cents``, ``balance_cents``, and the ``event_type`` and ``entity`` the details
        were written to show (``entity`` is None when no entity grammar can read them), in print
        order.

    Side Effects:
        None.
    """
    rng = random.Random(seed_text)
    builder = _RowBuilder(rng, mix or RowMix())
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

    def __init__(self, rng, mix):
        """Start at the opening balance.

        Args:
            rng: Seeded random source.
            mix: The ``RowMix`` to build.

        Side Effects:
            None.
        """
        self.rng = rng
        self.single_line_share = mix.single_line_share
        self.pair_share = mix.pair_share
        self.tied_values = mix.tied_values
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
        gap = timedelta(minutes=1 + int(self.rng.random() * MAX_GAP_MINUTES))
        # With tied values the clock moves only every TIED_TIME_EVERY transactions.
        if not self.tied_values or self.rng.random() < 1 / TIED_TIME_EVERY:
            self.time += gap
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
        if SINGLE_ROW_KINDS[kind][0] == "out" and self.balance_cents < LOW_BALANCE_CENTS:
            kind = "received"
        money, low, high = SINGLE_ROW_KINDS[kind]
        is_short = self.rng.random() < self.single_line_share
        details, event_type, entity = getattr(self, f"_{kind}_details")(is_short=is_short)
        amount = {
            f"{'paid_in' if money == 'in' else 'withdrawn'}_cents": self._amount_cents(low, high)
        }
        row = self._row(self._new_receipt(), details, **amount)
        return {**row, "event_type": event_type, "entity": entity}

    def _merchant_details(self, *, is_short):
        """Write a merchant payment; the short form names a till no entity grammar reads.

        Args:
            is_short: Whether the details must fit one printed line.

        Returns:
            Tuple of details, event type and entity.

        Side Effects:
            None.
        """
        if is_short:
            return f"Merchant Payment Example Till {self._digits(3)}", "MERCHANT_PAYMENT", None
        entity = f"Example Shop {self._digits(1)}"
        return (
            f"Merchant Payment Online to 555{self._digits(3)} {entity}",
            "MERCHANT_PAYMENT",
            entity,
        )

    def _airtime_details(self, *, is_short):
        """Write an airtime purchase, which names no entity.

        Args:
            is_short: Whether the details must fit one printed line.

        Returns:
            Tuple of details, event type and entity.

        Side Effects:
            None.
        """
        if is_short:
            return "Airtime Purchase", "AIRTIME_PURCHASE", None
        details = f"Airtime Purchase for Example Person {self._digits(1)} Synthetic Number"
        return details, "AIRTIME_PURCHASE", None

    def _received_details(self, *, is_short):
        """Write money received; the short form has no phone, so no classifier rule reads it.

        Args:
            is_short: Whether the details must fit one printed line.

        Returns:
            Tuple of details, event type and entity.

        Side Effects:
            None.
        """
        if is_short:
            return f"Funds received Example Person {self._digits(2)}", UNCLASSIFIED, None
        entity = f"Example Person {self._digits(1)}"
        phone = f"{MASKED_PHONE_PREFIX}0{self._digits(2)}"
        return f"Funds received from {phone} {entity}", "TRANSFER_IN", entity

    def _bundle_details(self, *, is_short):
        """Write a data bundle purchase.

        Args:
            is_short: Whether the details must fit one printed line.

        Returns:
            Tuple of details, event type and entity.

        Side Effects:
            None.
        """
        if is_short:
            return "Customer Bundle Purchase", "BUNDLE_PURCHASE", None
        entity = f"Example Bundle {self._digits(1)}"
        details = f"Customer Bundle Purchase to 555{self._digits(3)} {entity} by Example Network"
        return details, "BUNDLE_PURCHASE", entity

    def _investment_details(self, *, is_short):
        """Write a unit trust investment.

        Args:
            is_short: Whether the details must fit one printed line.

        Returns:
            Tuple of details, event type and entity.

        Side Effects:
            None.
        """
        if is_short:
            return "Unit Trust Invest", "INVESTMENT", None
        entity = f"Example Fund {self._digits(1)}"
        details = f"Unit Trust Invest To 555{self._digits(3)} {entity} by Example Platform"
        return details, "INVESTMENT", entity

    def _deposit_details(self, *, is_short):
        """Write a cash deposit, which no entity grammar reads.

        Args:
            is_short: Whether the details must fit one printed line.

        Returns:
            Tuple of details, event type and entity.

        Side Effects:
            None.
        """
        if is_short:
            return "Deposit of Funds at Agent", "DEPOSIT", None
        details = f"Deposit of Funds at Agent 555{self._digits(3)} Example Agent {self._digits(1)}"
        return details, "DEPOSIT", None

    def _reversal_details(self, *, is_short):
        """Write a reversal, money coming back, which no entity grammar reads.

        Args:
            is_short: Whether the details must fit one printed line.

        Returns:
            Tuple of details, event type and entity.

        Side Effects:
            None.
        """
        if is_short:
            return "Example Payment Reversal", "REVERSAL", None
        details = f"Reversal of Example Payment to Example Shop {self._digits(1)} Synthetic Order"
        return details, "REVERSAL", None

    def _unclassified_details(self, *, is_short):
        """Write money out that no classifier rule recognizes.

        Args:
            is_short: Whether the details must fit one printed line.

        Returns:
            Tuple of details, event type and entity.

        Side Effects:
            None.
        """
        if is_short:
            return "Example Unknown Service", UNCLASSIFIED, None
        details = f"Example Savings Account Transfer to Example Bank {self._digits(1)}"
        return details, UNCLASSIFIED, None

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
        (parent_details, event_type, entity), fee_details, fee_cents = self._pair_details()
        amount_cents = self._amount_cents(10_000, 150_000)

        def parent():
            """Apply the parent row, tagged with what its details show.

            Returns:
                The row.

            Side Effects:
                Advances the running balance.
            """
            row = self._row(receipt, parent_details, withdrawn_cents=amount_cents)
            return {**row, "event_type": event_type, "entity": entity}

        def fee():
            """Apply the fee row, tagged with what its details show.

            Returns:
                The row.

            Side Effects:
                Advances the running balance.
            """
            row = self._row(receipt, fee_details, withdrawn_cents=fee_cents)
            return {**row, "event_type": "FEE", "entity": None}

        return [parent(), fee()] if order == FEE_FIRST else [fee(), parent()]

    def _build_paid_in_pair(self, order):
        """Build money in and its fee, sharing a receipt and a second. Neither has a rule.

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

        def parent():
            """Apply the parent row, tagged with what its details show.

            Returns:
                The row.

            Side Effects:
                Advances the running balance.
            """
            row = self._row(receipt, details, paid_in_cents=paid_in_cents)
            return {**row, "event_type": UNCLASSIFIED, "entity": None}

        def fee():
            """Apply the fee row, tagged with what its details show.

            Returns:
                The row.

            Side Effects:
                Advances the running balance.
            """
            row = self._row(receipt, "Funds Receipt Charge", withdrawn_cents=TRANSFER_FEE_CENTS)
            return {**row, "event_type": UNCLASSIFIED, "entity": None}

        return [parent(), fee()] if order == FEE_FIRST else [fee(), parent()]

    def _pair_details(self):
        """Choose what a parent and fee pair says.

        Returns:
            Tuple of the parent's details, event type and entity; the fee details; and the fee in
            cents.

        Side Effects:
            None.
        """
        if self._pick(PAIR_BUILDERS) == "transfer":
            entity = f"Example Person {self._digits(1)}"
            phone = f"{MASKED_PHONE_PREFIX}0{self._digits(2)}"
            return (
                (f"Customer Transfer to {phone} {entity}", "TRANSFER_OUT", entity),
                "Customer Transfer of Funds Charge",
                TRANSFER_FEE_CENTS,
            )
        entity = f"Example Power {self._digits(1)}"
        return (
            (
                f"Pay Bill Online to 888{self._digits(3)} {entity} Acc. Synthetic Account",
                "BILL_PAYMENT",
                entity,
            ),
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
        """Pick an amount in whole shillings; the lowest one when values are tied.

        Args:
            low: Smallest amount, in cents.
            high: Largest amount, in cents.

        Returns:
            The amount in cents.

        Side Effects:
            None.
        """
        drawn = (low + int(self.rng.random() * (high - low))) // 100 * 100
        return low // 100 * 100 if self.tied_values else drawn

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
