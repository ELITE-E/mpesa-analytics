"""Draw a laid-out statement as a PDF, byte-identical for the same input."""

import io
import random

from reportlab.lib.pdfencrypt import StandardEncryption
from reportlab.pdfgen.canvas import Canvas

from synth.layout import PAGE_HEIGHT, PAGE_WIDTH

# Distance from the top of pdfminer's character box to the baseline, as a share of font size.
BASELINE_FROM_TOP = 0.793
# pdf.js measures its box from the baseline up by the font size, so its top sits this much higher.
PDFJS_TOP_SHIFT = BASELINE_FROM_TOP - 1
ENCRYPTION_STRENGTH = 128


def build_dense_lines(seed_text, line_count):
    """Build a seeded vector drawing that is heavy to parse, for hostile fixtures.

    Args:
        seed_text: Text that seeds the positions.
        line_count: Number of line segments.

    Returns:
        Tuples of two points, rounded to keep the file small.

    Side Effects:
        None.
    """
    rng = random.Random(seed_text)
    return [
        (
            round(rng.random() * PAGE_WIDTH, 1),
            round(rng.random() * PAGE_HEIGHT, 1),
            round(rng.random() * PAGE_WIDTH, 1),
            round(rng.random() * PAGE_HEIGHT, 1),
        )
        for _ in range(line_count)
    ]


def render_pdf(pages, *, password=None, dense_lines=()):
    """Draw every page. Streams are uncompressed so guard 1 can read the text inside them.

    Args:
        pages: Pages, each a list of ``DrawnText``.
        password: Password to encrypt with, if any.
        dense_lines: Line segments to draw on the first page, under its text.

    Returns:
        The PDF's bytes.

    Side Effects:
        None.
    """
    buffer = io.BytesIO()
    encryption = StandardEncryption(password, strength=ENCRYPTION_STRENGTH) if password else None
    canvas = Canvas(
        buffer,
        pagesize=(PAGE_WIDTH, PAGE_HEIGHT),
        invariant=1,
        pageCompression=0,
        encrypt=encryption,
    )
    for segment in dense_lines:
        canvas.line(*segment)
    for page in pages:
        for drawn in page:
            canvas.setFont(drawn.font, drawn.size)
            baseline = PAGE_HEIGHT - drawn.top - BASELINE_FROM_TOP * drawn.size
            canvas.drawString(drawn.x0, baseline, drawn.text)
        canvas.showPage()
    canvas.save()
    return buffer.getvalue()
