"""Generate synthetic statements: a PDF, its layout model and its expected totals."""

import argparse
import hashlib
import json
import random
import sys
from dataclasses import dataclass, field, replace
from functools import lru_cache
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from synth.fake_rows import (  # noqa: E402
    FEE_FIRST,
    PAIR_SHARE,
    PARENT_FIRST,
    SINGLE_LINE_SHARE,
    RowMix,
    build_fake_rows,
    plant_chain_breaks,
)
from synth.layout import (  # noqa: E402
    BALANCE,
    DETAILS,
    PAGE_HEIGHT,
    PAGE_WIDTH,
    PAID_IN,
    RECEIPT,
    STATUS,
    TIME,
    WITHDRAWN,
    LayoutVariant,
    lay_out_statement,
)
from synth.ledger import compute_expected  # noqa: E402
from synth.render import PDFJS_TOP_SHIFT, build_dense_lines, render_pdf  # noqa: E402
from synth.scenario_ledger import api_ledger, printed_rows  # noqa: E402
from synth.scenarios import SCENARIOS  # noqa: E402

VERSION = "1.6.0"
SCHEMA_VERSION = 1
ENGINE_NAME = "synthetic"
STATUS_COMPLETED = "Completed"
OUTPUT_SUFFIXES = (".pdf", ".model.json", ".expected.json")
FILLER_LINES = 8
FAKE_PASSWORD = "synthetic-only"
DEFAULT_SEED = 1
DEFAULT_ROW_COUNT = 60
CHAIN_BREAK_COUNT = 5
WRONG_SUMMARY_TOTALS = ("paid_in",)
WRONG_SUMMARY_SHIFT_CENTS = 10_000
CALIBRATION_JITTER_POINTS = 0.4
MANIFEST_NAME = "MANIFEST.toml"
# Invented, as a real statement prints them above the summary. The phone is in the fake range.
IDENTITY_LINES = (
    ("Customer Name:", "Example Person 00"),
    ("Mobile Number:", "07000000" + "00"),
    ("Email Address:", "example.person@example.invalid"),
)
SUMMARY_MARKER = "SUMMARY"
DETAIL_MARKER = "DETAILED STATEMENT"
OTHERS_LABEL = "OTHERS"
SUMMARY_TYPE_LABELS = (
    "SEND MONEY",
    "RECEIVED MONEY",
    "AGENT DEPOSIT",
    "AGENT WITHDRAWAL",
    "LIPA NA M-PESA (PAYBILL)",
    "LIPA NA M-PESA (BUY GOODS)",
    OTHERS_LABEL,
)
# Invented: which summary row each generated event type adds to. Fees and the rest go in OTHERS.
SUMMARY_TYPE_OF = {
    "TRANSFER_OUT": "SEND MONEY",
    "TRANSFER_IN": "RECEIVED MONEY",
    "DEPOSIT": "AGENT DEPOSIT",
    "BILL_PAYMENT": "LIPA NA M-PESA (PAYBILL)",
    "MERCHANT_PAYMENT": "LIPA NA M-PESA (BUY GOODS)",
}
COMMITTED_DIR = Path(__file__).resolve().parents[2] / "tests" / "fixtures" / "synthetic"
RECORDED_MARKER = "\n[[recorded]]"
MANIFEST_HEADER = (
    "# Every file in this directory must be listed here and regenerate byte-identically\n"
    "# from its seed (tools/guards/check_fixture_provenance.py).\n"
    "# Rewrite it with: python tools/synth/generate.py --write-fixtures tests/fixtures/synthetic\n"
    "# Then re-record from pdf.js with: node tools/pdf_readers/record_items.mjs\n"
)


@dataclass(frozen=True)
class StatementOptions:
    """What to generate. The same options and seed always give the same bytes."""

    name: str
    row_count: int
    split_datetime: bool = False
    password: str | None = None
    pair_orders: tuple[str, ...] | None = None
    # Hostile variant: a heavy vector drawing on page 1.
    dense_line_count: int = 0
    single_line_share: float = SINGLE_LINE_SHARE
    pair_share: float = PAIR_SHARE
    chain_break_count: int = 0
    # Which TOTAL columns, ``paid_in`` or ``paid_out``, to print deliberately wrong.
    wrong_summary_totals: tuple[str, ...] = ()
    # Every amount at the bottom of its range and most rows at one second, so value orderings
    # meet many ties (the tie-order tests, CP8a-3).
    tied_values: bool = False
    variant: LayoutVariant = field(default_factory=LayoutVariant)
    # Which invented account holder page 1 prints: 0 for every committed fixture, so their bytes
    # stay as they are; another number gives another account (CP9c, the different-account test).
    identity: int = 0
    # Exact money-in and money-out row counts for one-sided statements (CP10a, D-10); None for none.
    money_in_rows: int | None = None
    money_out_rows: int | None = None


# Cycled across the pairs, so the fixture holds both print orders.
TIES_PAIR_ORDERS = (PARENT_FIRST, FEE_FIRST)
# (seed, options). These are committed to tests/fixtures/synthetic/.
COMMITTED_FIXTURES = {
    "F-GOLDEN": (1001, StatementOptions(name="F-GOLDEN", row_count=DEFAULT_ROW_COUNT)),
    "F-ENCRYPTED": (
        1002,
        StatementOptions(name="F-ENCRYPTED", row_count=20, password=FAKE_PASSWORD),
    ),
    "F-TIES": (1003, StatementOptions(name="F-TIES", row_count=12, pair_orders=TIES_PAIR_ORDERS)),
    "F-SPLIT": (1004, StatementOptions(name="F-SPLIT", row_count=20, split_datetime=True)),
    "F-DENSE": (1006, StatementOptions(name="F-DENSE", row_count=14, dense_line_count=50_000)),
    "F-MANY-PAGES": (
        1007,
        StatementOptions(
            name="F-MANY-PAGES", row_count=10, variant=LayoutVariant(minimum_pages=501)
        ),
    ),
    "F-BASIC": (
        1008,
        StatementOptions(name="F-BASIC", row_count=30, single_line_share=1.0, pair_share=0.0),
    ),
    "F-MULTILINE": (
        1009,
        StatementOptions(name="F-MULTILINE", row_count=30, single_line_share=0.0),
    ),
    "F-MULTIPAGE": (1010, StatementOptions(name="F-MULTIPAGE", row_count=220)),
    "F-NOTABLE": (1011, StatementOptions(name="F-NOTABLE", row_count=0)),
    "F-JITTER": (
        1012,
        StatementOptions(
            name="F-JITTER",
            row_count=DEFAULT_ROW_COUNT,
            variant=LayoutVariant(jitter_points=CALIBRATION_JITTER_POINTS, jitter_tops=True),
        ),
    ),
    "F-CONT-ABOVE": (
        1013,
        StatementOptions(
            name="F-CONT-ABOVE", row_count=40, variant=LayoutVariant(continuation_above=True)
        ),
    ),
    "F-SUMMARY-MISMATCH": (
        1014,
        StatementOptions(
            name="F-SUMMARY-MISMATCH", row_count=30, wrong_summary_totals=WRONG_SUMMARY_TOTALS
        ),
    ),
    "F-CHAIN-BREAK": (
        1015,
        StatementOptions(
            name="F-CHAIN-BREAK", row_count=DEFAULT_ROW_COUNT, chain_break_count=CHAIN_BREAK_COUNT
        ),
    ),
}
# Generated on demand only: too large to commit.
ON_DEMAND_FIXTURES = {
    "F-LARGE": (1005, StatementOptions(name="F-LARGE", row_count=5700)),
    "F-TIED": (1012, StatementOptions(name="F-TIED", row_count=300, tied_values=True)),
    # Another invented account holder: the store must open it as a separate ledger (CP9c).
    "F-OTHER-ACCOUNT": (1013, StatementOptions(name="F-OTHER-ACCOUNT", row_count=20, identity=1)),
    # One-sided statements (CP10a, D-10): no money in, one money in, one money out.
    "F-NO-PAID-IN": (1014, StatementOptions(name="F-NO-PAID-IN", row_count=12, money_in_rows=0)),
    "F-ONE-PAID-IN": (1015, StatementOptions(name="F-ONE-PAID-IN", row_count=12, money_in_rows=1)),
    "F-ONE-WITHDRAWN": (
        1016,
        StatementOptions(name="F-ONE-WITHDRAWN", row_count=12, money_out_rows=1),
    ),
}


# The frontend's contract scenarios (scenarios.py): (seed, scenario name). A scenario's ledger is
# its ".api.json"; one a statement can print also gets its ".pdf" and ".model.json".
SCENARIO_SEED_BASE = 2001
SCENARIO_FIXTURES = {
    name: (SCENARIO_SEED_BASE + position, name) for position, name in enumerate(SCENARIOS)
}
SCENARIO_LEDGER_SUFFIX = ".api.json"
SCENARIO_PRINTED_SUFFIXES = (".pdf", ".model.json")


def main():
    """Write one statement, or rewrite the committed fixtures and their manifest.

    Returns:
        Process exit code, 0 on success.

    Side Effects:
        Writes files and prints their names and sizes.
    """
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write-fixtures", type=Path, metavar="DIR")
    parser.add_argument("--name", default="statement")
    parser.add_argument("--seed", type=int)
    parser.add_argument("--rows", type=int)
    parser.add_argument("--split-datetime", action="store_true")
    parser.add_argument("--password")
    parser.add_argument("--out-dir", type=Path, default=Path())
    args = parser.parse_args()
    if args.write_fixtures:
        write_fixtures(args.write_fixtures)
    else:
        seed, options = _options_from_arguments(args)
        _write_outputs(args.out_dir, seed, options)
    return 0


def write_fixtures(directory):
    """Rewrite every committed fixture and the manifest that records them.

    Args:
        directory: Directory to write into.

    Side Effects:
        Writes files and prints their names and sizes.
    """
    entries = []
    for name, (seed, options) in COMMITTED_FIXTURES.items():
        outputs = _write_outputs(directory, seed, options)
        entries += [(f"{name}{suffix}", seed, outputs[suffix]) for suffix in OUTPUT_SUFFIXES]
    for name, (seed, scenario_name) in SCENARIO_FIXTURES.items():
        for suffix, content in build_scenario_outputs(seed, scenario_name).items():
            (directory / f"{name}{suffix}").write_bytes(content)
            print(f"{name}{suffix}: {len(content)} bytes")
            entries.append((f"{name}{suffix}", seed, content))
    lines = [MANIFEST_HEADER, f'generator_version = "{VERSION}"\n']
    lines.append(f'fake_password = "{FAKE_PASSWORD}"\n')
    for path, seed, content in entries:
        digest = hashlib.sha256(content).hexdigest()
        lines.append(f'\n[[fixture]]\npath = "{path}"\nseed = {seed}\nsha256 = "{digest}"\n')
    lines.append(_recorded_entries(directory))
    (directory / MANIFEST_NAME).write_text("".join(lines), encoding="utf-8")


def generate(seed, name):
    """Produce the bytes of one fixture file, as the provenance guard expects.

    Args:
        seed: Manifest seed.
        name: Fixture path relative to the fixtures directory.

    Returns:
        The file's bytes. A name no fixture claims gets seeded filler, which the guard's own
        tests rely on.

    Side Effects:
        None.
    """
    fixture_name, _, suffix = name.partition(".")
    if fixture_name in SCENARIO_FIXTURES:
        _, scenario_name = SCENARIO_FIXTURES[fixture_name]
        return build_scenario_outputs(seed, scenario_name)[f".{suffix}"]
    if fixture_name in COMMITTED_FIXTURES:
        _, options = COMMITTED_FIXTURES[fixture_name]
        return build_outputs(seed, options)[f".{suffix}"]
    rng = random.Random(f"{seed}:{name}")
    lines = [f"synthetic stub {name}"]
    lines += [f"{rng.randrange(16**8):08x}" for _ in range(FILLER_LINES)]
    return ("\n".join(lines) + "\n").encode("ascii")


@lru_cache(maxsize=16)
def build_outputs(seed, options):
    """Build all three outputs of one statement.

    Args:
        seed: Seed for every random choice.
        options: The ``StatementOptions`` to generate.

    Returns:
        Map of file suffix to bytes: ``.pdf``, ``.model.json`` and ``.expected.json``.

    Side Effects:
        None.
    """
    seed_text = f"{seed}:{options.name}"
    fake_rows = build_fake_rows(
        f"{seed_text}:rows",
        options.row_count,
        pair_orders=options.pair_orders,
        mix=RowMix(
            single_line_share=options.single_line_share,
            pair_share=options.pair_share,
            tied_values=options.tied_values,
            money_in_rows=options.money_in_rows,
            money_out_rows=options.money_out_rows,
        ),
    )
    if options.chain_break_count:
        fake_rows = plant_chain_breaks(fake_rows, options.chain_break_count)
    summary_lines = _summary_lines(
        fake_rows, options.wrong_summary_totals, identity=options.identity
    )
    pages, placed = lay_out_statement(
        [_printed_columns(row) for row in fake_rows],
        summary_lines,
        seed_text=f"{seed_text}:layout",
        split_datetime=options.split_datetime,
        variant=options.variant,
    )
    drawing = build_dense_lines(f"{seed_text}:drawing", options.dense_line_count)
    return {
        ".pdf": render_pdf(pages, password=options.password, dense_lines=drawing),
        ".model.json": _to_json(_statement_pages(pages)),
        ".expected.json": _to_json(
            _expected(placed, summary_lines, options, _page_one_token(pages))
        ),
    }


def build_scenario_outputs(seed, scenario_name):
    """Build a scenario's outputs: its ledger, and its PDF and model when it can be printed.

    Args:
        seed: Seed for the layout's jitter and footer tokens.
        scenario_name: A name in ``SCENARIOS``.

    Returns:
        Map of file suffix to bytes.

    Side Effects:
        None.
    """
    scenario = SCENARIOS[scenario_name]
    outputs = {SCENARIO_LEDGER_SUFFIX: _to_json(api_ledger(scenario))}
    if not scenario.printable:
        return outputs
    rows = printed_rows(scenario)
    pages, _ = lay_out_statement(
        [_printed_columns(row) for row in rows],
        _summary_lines(rows),
        seed_text=f"{seed}:{scenario_name}:layout",
        split_datetime=False,
    )
    outputs[".pdf"] = render_pdf(pages)
    outputs[".model.json"] = _to_json(_statement_pages(pages))
    return outputs


def _recorded_entries(directory):
    """Keep the manifest's recorded section, which only the pdf.js recorder may change.

    Args:
        directory: Directory being written.

    Returns:
        The section's text, from that directory's manifest or else the committed one; may be empty.

    Side Effects:
        Reads a manifest.
    """
    for candidate in (directory / MANIFEST_NAME, COMMITTED_DIR / MANIFEST_NAME):
        if candidate.is_file():
            _, marker, entries = candidate.read_text(encoding="utf-8").partition(RECORDED_MARKER)
            if marker:
                return f"{marker}{entries}"
    return ""


def _options_from_arguments(args):
    """Turn command-line arguments into a seed and options, starting from any named fixture.

    Args:
        args: Parsed command-line arguments.

    Returns:
        Tuple of seed and ``StatementOptions``.

    Side Effects:
        None.
    """
    known = {**COMMITTED_FIXTURES, **ON_DEMAND_FIXTURES}
    default_options = StatementOptions(name=args.name, row_count=DEFAULT_ROW_COUNT)
    default_seed, base = known.get(args.name, (DEFAULT_SEED, default_options))
    options = replace(
        base,
        row_count=base.row_count if args.rows is None else args.rows,
        split_datetime=base.split_datetime or args.split_datetime,
        password=args.password or base.password,
    )
    return default_seed if args.seed is None else args.seed, options


def _write_outputs(directory, seed, options):
    """Write a statement's three outputs.

    Args:
        directory: Directory to write into.
        seed: Seed for every random choice.
        options: The ``StatementOptions`` to generate.

    Returns:
        Map of file suffix to the bytes written.

    Side Effects:
        Creates the directory if needed, writes files and prints their names and sizes.
    """
    directory.mkdir(parents=True, exist_ok=True)
    outputs = build_outputs(seed, options)
    for suffix, content in outputs.items():
        (directory / f"{options.name}{suffix}").write_bytes(content)
        print(f"{options.name}{suffix}: {len(content)} bytes")
    return outputs


def _printed_columns(fake_row):
    """Format a fake row as the text each column prints.

    Args:
        fake_row: Row from ``build_fake_rows``.

    Returns:
        Map of column label to text, where an empty amount is None, plus the ``event_type`` and
        ``entity`` the details were written to show, which the layout passes through.

    Side Effects:
        None.
    """
    return {
        "event_type": fake_row["event_type"],
        "entity": fake_row["entity"],
        RECEIPT.label: fake_row["receipt_no"],
        TIME.label: fake_row["time"].strftime("%Y-%m-%d %H:%M:%S"),
        DETAILS.label: fake_row["details"],
        STATUS.label: STATUS_COMPLETED,
        PAID_IN.label: _optional_amount(fake_row["paid_in_cents"]),
        WITHDRAWN.label: _optional_amount(fake_row["withdrawn_cents"]),
        BALANCE.label: _amount_text(fake_row["balance_cents"]),
    }


def _identity_lines(identity):
    """The invented account holder's lines for page 1.

    Args:
        identity: 0 for the committed fixtures' holder; another number for another holder.

    Returns:
        Name, mobile number (in the fake range) and email lines.

    Side Effects:
        None.
    """
    if identity == 0:
        return IDENTITY_LINES
    return (
        ("Customer Name:", f"Example Person {identity:02d}"),
        ("Mobile Number:", "07000000" + f"{identity:02d}"),
        ("Email Address:", f"example.person{identity:02d}@example.invalid"),
    )


def _summary_lines(fake_rows, wrong_totals=(), *, identity=0):
    """Compute the page 1 lines from the generated rows, separately from the ledger.

    An invented name, phone and email come first, as on a real statement, then the summary block:
    a ``SUMMARY`` line, seven transaction type rows and a TOTAL row, each a label then paid in
    and paid out, then a ``DETAILED STATEMENT`` line. TOTAL is the sum of the type rows.

    Args:
        fake_rows: Rows in print order.
        wrong_totals: TOTAL columns, ``paid_in`` or ``paid_out``, to print deliberately wrong.
        identity: Which invented account holder to print (``_identity_lines``).

    Returns:
        Tuples of the texts on each line, left to right. A statement with no rows prints no
        summary block.

    Side Effects:
        None.
    """
    if not fake_rows:
        return (*_identity_lines(identity), ("Notice", "No transactions in this period"))
    sums = {label: [0, 0] for label in SUMMARY_TYPE_LABELS}
    for row in fake_rows:
        label = SUMMARY_TYPE_OF.get(row["event_type"], OTHERS_LABEL)
        sums[label][0] += row["paid_in_cents"]
        sums[label][1] += row["withdrawn_cents"]
    total = [sum(paid_in for paid_in, _ in sums.values()), sum(out for _, out in sums.values())]
    for index, column in enumerate(("paid_in", "paid_out")):
        total[index] += WRONG_SUMMARY_SHIFT_CENTS if column in wrong_totals else 0
    type_rows = tuple(
        (f"{label}:", _amount_text(paid_in), _amount_text(paid_out))
        for label, (paid_in, paid_out) in sums.items()
    )
    return (
        *_identity_lines(identity),
        (SUMMARY_MARKER,),
        *type_rows,
        ("TOTAL:", _amount_text(total[0]), _amount_text(total[1])),
        (DETAIL_MARKER,),
    )


def _statement_pages(pages):
    """Convert the layout model to the ``StatementPages`` shape the PDF reader will return.

    Args:
        pages: Pages, each a list of ``DrawnText``.

    Returns:
        The statement pages, marked as coming from the synthetic generator.

    Side Effects:
        None.
    """
    return {
        "schema_version": SCHEMA_VERSION,
        "engine": ENGINE_NAME,
        "pages": [
            {
                "page_number": number,
                "width": float(PAGE_WIDTH),
                "height": float(PAGE_HEIGHT),
                "items": [_model_item(drawn) for drawn in page],
            }
            for number, page in enumerate(pages, start=1)
        ],
    }


def _model_item(drawn):
    """Describe one piece of text the way pdf.js is expected to report it.

    Args:
        drawn: The ``DrawnText``.

    Returns:
        A text item, using pdf.js's vertical reference rather than the layout's.

    Side Effects:
        None.
    """
    top = round(drawn.top + PDFJS_TOP_SHIFT * drawn.size, 3)
    return {
        "text": drawn.text,
        "x0": drawn.x0,
        "x1": drawn.x1,
        "top": top,
        "bottom": round(top + drawn.size, 3),
    }


def _expected(placed_rows, summary_lines, options, verification_token):
    """Run the independent ledger over the rows as printed.

    Args:
        placed_rows: Rows from the layout, with text per column, a position, and the event type
            and entity the generator wrote.
        summary_lines: Tuples of the texts on each page 1 line above the table.
        options: The options that generated them.
        verification_token: The token printed in page 1's footer.

    Returns:
        The ledger's result, labelled with the fixture name, generator version and token.

    Side Effects:
        None.
    """
    rows = [
        {
            "receipt_no": row[RECEIPT.label],
            "completion_time": row[TIME.label],
            "details": row[DETAILS.label],
            "status": row[STATUS.label],
            "paid_in": row[PAID_IN.label],
            "withdrawn": row[WITHDRAWN.label],
            "balance": row[BALANCE.label],
            "page": row["page"],
            "line": row["line"],
            "event_type": row["event_type"],
            "entity": row["entity"],
        }
        for row in placed_rows
    ]
    return {
        "name": options.name,
        "generator_version": VERSION,
        "verification_token": verification_token,
        **compute_expected(rows, summary_lines),
    }


def _page_one_token(pages):
    """Read back the token the layout printed lowest on page 1.

    Args:
        pages: Pages, each a list of ``DrawnText``.

    Returns:
        The token's text.

    Side Effects:
        None.
    """
    return max(pages[0], key=lambda drawn: drawn.top).text


def _optional_amount(cents):
    """Format an amount that prints blank when zero.

    Args:
        cents: Amount in cents.

    Returns:
        The printed text, or None for zero.

    Side Effects:
        None.
    """
    return _amount_text(cents) if cents else None


def _amount_text(cents):
    """Format an amount as a statement prints it.

    Args:
        cents: Amount in cents.

    Returns:
        Text with thousands commas and two decimals.

    Side Effects:
        None.
    """
    return f"{cents // 100:,}.{cents % 100:02d}"


def _to_json(content):
    """Serialize with a stable key order, so output is byte-identical.

    Args:
        content: A JSON-compatible value.

    Returns:
        UTF-8 bytes ending in a newline.

    Side Effects:
        None.
    """
    return (json.dumps(content, indent=1, sort_keys=True, ensure_ascii=False) + "\n").encode()


if __name__ == "__main__":
    sys.exit(main())
