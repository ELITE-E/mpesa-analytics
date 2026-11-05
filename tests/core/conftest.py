from types import SimpleNamespace

import pytest

CHARACTER_POINTS = 2.5
ROW_POINTS = 10.0
WRAP_POINTS = 6.0
FIRST_ROW_TOP = 100.0
TEXT_SIZE = 5.5
RECEIPT_X0 = 70.0
TIME_X0 = 130.0
DETAILS_X0 = 205.0
STATUS_X0 = 310.0
PAID_IN_X1 = 415.0
WITHDRAWN_X1 = 467.0
BALANCE_X1 = 523.0
HEADER_LABELS = (
    "Receipt No",
    "Completion Time",
    "Details",
    "Transaction Status",
    "Paid In",
    "Withdrawn",
    "Balance",
)
HEADER_X0S = (70.0, 130.0, 205.0, 310.0, 390.0, 440.0, 495.0)
COMPLETED = "Completed"
EARLY_TIME = "2026-01-05 10:00:00"


def receipt_number(position):
    return f"ZZ{position:08d}"


def left_item(text, x0, top):
    return {
        "text": text,
        "x0": x0,
        "x1": x0 + CHARACTER_POINTS * len(text),
        "top": top,
        "bottom": top + TEXT_SIZE,
    }


def right_item(text, x1, top):
    return {
        "text": text,
        "x0": x1 - CHARACTER_POINTS * len(text),
        "x1": x1,
        "top": top,
        "bottom": top + TEXT_SIZE,
    }


def space_item(x0, top):
    return {"text": " ", "x0": x0, "x1": x0 + 20.0, "top": top, "bottom": top}


def header_items(top, *, labels=HEADER_LABELS, offset=0.0):
    return [
        left_item(label, x0 + offset, top) for label, x0 in zip(labels, HEADER_X0S, strict=True)
    ]


def row_items(position, top, *, cells=None, jitter=0.0):
    """Print one anchor line. `cells` overrides the defaults; None leaves a cell blank."""
    printed = {
        "receipt": receipt_number(position),
        "time": EARLY_TIME,
        "details": "Airtime Purchase",
        "status": COMPLETED,
        "paid_in": None,
        "withdrawn": "5.00",
        "balance": "100.00",
        **(cells or {}),
    }
    left = (
        (printed["receipt"], RECEIPT_X0),
        (printed["time"], TIME_X0),
        (printed["details"], DETAILS_X0),
        (printed["status"], STATUS_X0),
    )
    right = (
        (printed["paid_in"], PAID_IN_X1),
        (printed["withdrawn"], WITHDRAWN_X1),
        (printed["balance"], BALANCE_X1),
    )
    items = [left_item(text, x0 + jitter, top) for text, x0 in left if text is not None]
    items += [right_item(text, x1 + jitter, top) for text, x1 in right if text is not None]
    return items


def calibrating_rows(first_top=FIRST_ROW_TOP, *, count=4, first_position=0, jitter=()):
    """Rows that print all three amount columns, so a statement calibrates."""
    items = []
    for offset in range(count):
        cells = {"paid_in": "9.00", "withdrawn": None} if offset % 2 else {}
        shift = jitter[offset % len(jitter)] if jitter else 0.0
        top = first_top + offset * ROW_POINTS
        items += row_items(first_position + offset, top, cells=cells, jitter=shift)
    return items


def page_of(items, number=1):
    return {"page_number": number, "width": 595.0, "height": 848.0, "items": items}


def statement_of(*pages):
    return {"schema_version": 1, "engine": "test", "pages": list(pages)}


@pytest.fixture
def printed():
    return SimpleNamespace(
        BALANCE_X1=BALANCE_X1,
        DETAILS_X0=DETAILS_X0,
        COMPLETED=COMPLETED,
        EARLY_TIME=EARLY_TIME,
        FIRST_ROW_TOP=FIRST_ROW_TOP,
        PAID_IN_X1=PAID_IN_X1,
        RECEIPT_X0=RECEIPT_X0,
        ROW_POINTS=ROW_POINTS,
        STATUS_X0=STATUS_X0,
        TIME_X0=TIME_X0,
        WITHDRAWN_X1=WITHDRAWN_X1,
        WRAP_POINTS=WRAP_POINTS,
        HEADER_LABELS=HEADER_LABELS,
        calibrating_rows=calibrating_rows,
        header_items=header_items,
        left_item=left_item,
        page_of=page_of,
        receipt_number=receipt_number,
        right_item=right_item,
        row_items=row_items,
        space_item=space_item,
        statement_of=statement_of,
    )
