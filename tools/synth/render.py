"""Draw a laid-out statement as a PDF, byte-identical for the same input."""

import io

from reportlab.lib.pdfencrypt import StandardEncryption
from reportlab.pdfgen.canvas import Canvas

from synth.layout import PAGE_HEIGHT, PAGE_WIDTH

# Distance from the top of pdfminer's character box to the baseline, as a share of font size.
BASELINE_FROM_TOP = 0.793
ENCRYPTION_STRENGTH = 128


def render_pdf(pages, *, password=None):
    """Draw every page. Streams are uncompressed so guard 1 can read the text inside them.

    Args:
        pages: Pages, each a list of ``DrawnText``.
        password: Password to encrypt with, if any.

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
    for page in pages:
        for drawn in page:
            canvas.setFont(drawn.font, drawn.size)
            baseline = PAGE_HEIGHT - drawn.top - BASELINE_FROM_TOP * drawn.size
            canvas.drawString(drawn.x0, baseline, drawn.text)
        canvas.showPage()
    canvas.save()
    return buffer.getvalue()
