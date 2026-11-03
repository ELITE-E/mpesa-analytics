"""Generate synthetic statements: a PDF, its layout model and its expected totals."""

import argparse
import hashlib
import json
import random
import sys
from dataclasses import dataclass, replace
from functools import lru_cache
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from synth.fake_rows import FEE_FIRST, PARENT_FIRST, build_fake_rows  # noqa: E402
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
    lay_out_statement,
)
from synth.ledger import compute_expected  # noqa: E402
from synth.render import PDFJS_TOP_SHIFT, build_dense_lines, render_pdf  # noqa: E402

VERSION = "1.2.0"
SCHEMA_VERSION = 1
ENGINE_NAME = "synthetic"
STATUS_COMPLETED = "Completed"
OUTPUT_SUFFIXES = (".pdf", ".model.json", ".expected.json")
FILLER_LINES = 8
FAKE_PASSWORD = "synthetic-only"
DEFAULT_SEED = 1
DEFAULT_ROW_COUNT = 60
MANIFEST_NAME = "MANIFEST.toml"
COMMITTED_DIR = Path(__file__).resolve().parents[2] / "fixtures" / "synthetic"
RECORDED_MARKER = "\n[[recorded]]"
MANIFEST_HEADER = (
    "# Every file in this directory must be listed here and regenerate byte-identically\n"
    "# from its seed (tools/guards/check_fixture_provenance.py).\n"
    "# Rewrite it with: python tools/synth/generate.py --write-fixtures fixtures/synthetic\n"
    "# Then re-record from pdf.js with: node tools/engines/record_items.mjs\n"
)


@dataclass(frozen=True)
class StatementOptions:
    """What to generate. The same options and seed always give the same bytes."""

    name: str
    row_count: int
    split_datetime: bool = False
    password: str | None = None
    pair_orders: tuple[str, ...] | None = None
    # Hostile variants: a heavy vector drawing on page 1, and padding pages after the rows.
    dense_line_count: int = 0
    minimum_pages: int = 0


# Cycled across the pairs, so the fixture holds both print orders.
TIES_PAIR_ORDERS = (PARENT_FIRST, FEE_FIRST)
# (seed, options). These four are committed to fixtures/synthetic/.
COMMITTED_FIXTURES = {
    "F-GOLDEN": (1001, StatementOptions(name="F-GOLDEN", row_count=DEFAULT_ROW_COUNT)),
    "F-ENCRYPTED": (
        1002,
        StatementOptions(name="F-ENCRYPTED", row_count=20, password=FAKE_PASSWORD),
    ),
    "F-TIES": (1003, StatementOptions(name="F-TIES", row_count=12, pair_orders=TIES_PAIR_ORDERS)),
    "F-SPLIT": (1004, StatementOptions(name="F-SPLIT", row_count=20, split_datetime=True)),
    "F-DENSE": (1006, StatementOptions(name="F-DENSE", row_count=10, dense_line_count=50_000)),
    "F-MANY-PAGES": (1007, StatementOptions(name="F-MANY-PAGES", row_count=10, minimum_pages=501)),
}
# Generated on demand only: too large to commit.
ON_DEMAND_FIXTURES = {"F-LARGE": (1005, StatementOptions(name="F-LARGE", row_count=5700))}


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
    if fixture_name in COMMITTED_FIXTURES:
        _, options = COMMITTED_FIXTURES[fixture_name]
        return build_outputs(seed, options)[f".{suffix}"]
    rng = random.Random(f"{seed}:{name}")
    lines = [f"synthetic stub {name}"]
    lines += [f"{rng.randrange(16**8):08x}" for _ in range(FILLER_LINES)]
    return ("\n".join(lines) + "\n").encode("ascii")


@lru_cache(maxsize=8)
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
        f"{seed_text}:rows", options.row_count, pair_orders=options.pair_orders
    )
    pages, placed = lay_out_statement(
        [_printed_columns(row) for row in fake_rows],
        _summary_lines(fake_rows),
        seed_text=f"{seed_text}:layout",
        split_datetime=options.split_datetime,
        minimum_pages=options.minimum_pages,
    )
    drawing = build_dense_lines(f"{seed_text}:drawing", options.dense_line_count)
    return {
        ".pdf": render_pdf(pages, password=options.password, dense_lines=drawing),
        ".model.json": _to_json(_statement_pages(pages)),
        ".expected.json": _to_json(_expected(placed, options)),
    }


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
        Map of column label to text; an empty amount is None.

    Side Effects:
        None.
    """
    return {
        RECEIPT.label: fake_row["receipt_no"],
        TIME.label: fake_row["time"].strftime("%Y-%m-%d %H:%M:%S"),
        DETAILS.label: fake_row["details"],
        STATUS.label: STATUS_COMPLETED,
        PAID_IN.label: _optional_amount(fake_row["paid_in_cents"]),
        WITHDRAWN.label: _optional_amount(fake_row["withdrawn_cents"]),
        BALANCE.label: _amount_text(fake_row["balance_cents"]),
    }


def _summary_lines(fake_rows):
    """Compute the page 1 summary from the generated rows, separately from the ledger.

    Args:
        fake_rows: Rows in print order.

    Returns:
        Tuples of label and printed value.

    Side Effects:
        None.
    """
    oldest = fake_rows[-1]
    opening = oldest["balance_cents"] - oldest["paid_in_cents"] + oldest["withdrawn_cents"]
    return (
        ("Customer Name", "Example Person 00"),
        ("Mobile Number", "07000000" + "00"),
        ("Transaction Count", str(len(fake_rows))),
        ("Total Paid In", _amount_text(sum(row["paid_in_cents"] for row in fake_rows))),
        ("Total Withdrawn", _amount_text(sum(row["withdrawn_cents"] for row in fake_rows))),
        ("Opening Balance", _amount_text(opening)),
        ("Closing Balance", _amount_text(fake_rows[0]["balance_cents"])),
    )


def _statement_pages(pages):
    """Convert the layout model to the ``StatementPages`` shape the engine will return.

    Args:
        pages: Pages, each a list of ``DrawnText``.

    Returns:
        The statement pages, marked as coming from the synthetic engine.

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


def _expected(placed_rows, options):
    """Run the independent ledger over the rows as printed.

    Args:
        placed_rows: Rows from the layout, with text per column and a position.
        options: The options that generated them.

    Returns:
        The ledger's result, labelled with the fixture name and generator version.

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
        }
        for row in placed_rows
    ]
    return {"name": options.name, "generator_version": VERSION, **compute_expected(rows)}


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
