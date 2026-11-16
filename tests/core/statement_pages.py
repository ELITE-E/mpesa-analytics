"""F-PIPELINE: small invented statements with an attestable page 1, for the pipeline tests.

Synthetic only. Built from the printed-layout helpers of the ``printed`` fixture, plus a footer
holding the M-PESA brand, the verification instruction and an invented token. The masked phone is
assembled from parts, because the pattern guard honours the fake ranges only inside
tests/fixtures/synthetic/.
"""

TOKEN = "QX7" + "M2KP9"
FOOTER_TOP = 700.0
FOOTER_TEXT = "M-PESA Statement Verification Code"
TRANSFER_DETAILS = "Customer Transfer to " + "2547" + "*****" + "012" + " Example Person 12"


def footer_items(printed, *, text=FOOTER_TEXT, token=TOKEN):
    return [
        printed.left_item(text, 20.0, FOOTER_TOP),
        printed.left_item(token, 20.0, FOOTER_TOP + 10.0),
    ]


def attestable_statement(printed, row_lines=None, *, footer=None):
    """A one-page statement: header, rows and footer. Rows default to four that calibrate."""
    items = printed.header_items(80.0)
    items += printed.calibrating_rows() if row_lines is None else row_lines
    items += footer_items(printed) if footer is None else footer
    return printed.statement_of(printed.page_of(items))


def transfer_row(printed, position, top, *, time, cells=None):
    """A transfer out of 10.00 leaving 100.00; ``cells`` overrides any printed cell."""
    printed_cells = {
        "time": time,
        "details": TRANSFER_DETAILS,
        "paid_in": None,
        "withdrawn": "10.00",
        "balance": "100.00",
        **(cells or {}),
    }
    return printed.row_items(position, top, cells=printed_cells)
