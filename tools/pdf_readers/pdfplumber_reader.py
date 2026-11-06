"""Dev-only PDF reader: the same ``StatementPages`` contract as pdf.js, by word extraction.

It exists to disagree with pdf.js if either is wrong, in the differential test and at CP3's
equivalence check. It never ships: it is outside the wheel, and the core may not import pdfplumber.
"""

import io
import logging

import pdfplumber
from pdfminer.pdfdocument import PDFPasswordIncorrect
from pdfplumber.utils.exceptions import PdfminerException

from mpesa_core.contracts import SCHEMA_VERSION
from mpesa_core.errors import ErrorCode, ExtractionError

PDF_MAGIC = b"%PDF-"
# Tighter than the default, which merges a split date and time into one word.
WORD_GAP_POINTS = 1.5
# pdf.js measures an item's box up from the baseline by the font size; pdfplumber's top sits lower.
PDFJS_TOP_SHIFT = 0.207
DIGITS_PER_ROUND = 2


def extract_statement_pages(pdf_bytes, password=None):
    """Extract positioned text from every page of a statement PDF.

    Args:
        pdf_bytes: The PDF's bytes.
        password: The PDF's password, if it has one.

    Returns:
        The statement pages. Words keep their spaces, so items read like pdf.js's strings. A PDF
        with no text gives pages with no items; ``build_rows`` is what rejects that.

    Raises:
        ExtractionError: With a code and nothing else: ``NOT_A_PDF``, ``PASSWORD_REQUIRED``,
            ``PASSWORD_INCORRECT`` or ``CORRUPT_PDF``.

    Side Effects:
        Silences pdfminer's logging, because it can quote fragments of the PDF.
    """
    if not pdf_bytes.startswith(PDF_MAGIC):
        raise ExtractionError(ErrorCode.NOT_A_PDF)
    logging.getLogger("pdfminer").setLevel(logging.CRITICAL)
    try:
        with pdfplumber.open(io.BytesIO(pdf_bytes), password=password or "") as pdf:
            pages = [_read_page(page) for page in pdf.pages]
    except PdfminerException as error:
        raise ExtractionError(_code_for(error, password)) from error
    except Exception as error:  # noqa: BLE001 - pdfminer raises many types on a damaged file.
        raise ExtractionError(ErrorCode.CORRUPT_PDF) from error
    return {
        "schema_version": SCHEMA_VERSION,
        "engine": f"pdfplumber {pdfplumber.__version__}",
        "pages": pages,
    }


def _read_page(page):
    """Read one page's size and text.

    Args:
        page: The pdfplumber page.

    Returns:
        The ``Page``.

    Side Effects:
        None.
    """
    words = page.extract_words(
        keep_blank_chars=True, x_tolerance=WORD_GAP_POINTS, extra_attrs=["size"]
    )
    return {
        "page_number": page.page_number,
        "width": float(page.width),
        "height": float(page.height),
        "items": [_to_text_item(word) for word in words if word["text"].strip()],
    }


def _to_text_item(word):
    """Convert one word to a text item, on pdf.js's vertical reference.

    Args:
        word: The pdfplumber word.

    Returns:
        The ``TextItem``, with coordinates rounded as the pdf.js adapter rounds them.

    Side Effects:
        None.
    """
    top = float(word["top"]) - PDFJS_TOP_SHIFT * float(word["size"])
    return {
        "text": word["text"],
        "x0": round(float(word["x0"]), DIGITS_PER_ROUND),
        "x1": round(float(word["x1"]), DIGITS_PER_ROUND),
        "top": round(top, DIGITS_PER_ROUND),
        "bottom": round(top + float(word["size"]), DIGITS_PER_ROUND),
    }


def _code_for(error, password):
    """Name a pdfplumber failure.

    Args:
        error: The exception pdfplumber raised.
        password: The password that was tried, if any.

    Returns:
        The ``ErrorCode``.

    Side Effects:
        None.
    """
    if not any(isinstance(cause, PDFPasswordIncorrect) for cause in error.args):
        return ErrorCode.CORRUPT_PDF
    return ErrorCode.PASSWORD_INCORRECT if password else ErrorCode.PASSWORD_REQUIRED
