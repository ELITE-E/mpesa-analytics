// A hostile PDF for the timeout test: a small deflated content stream that expands to millions of
// drawing operators, so pdf.js spends seconds on one page. Built at test time, never committed.
import { deflateSync } from "node:zlib";

const PDF_OBJECTS = [
  "<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>",
];
const DRAWING_OPERATORS = "1 1 m 2 2 l S\n";

/**
 * Build the hostile PDF.
 *
 * @param {number} lineCount How many drawing operators the content stream expands to.
 * @returns {Uint8Array} The PDF, a few tens of kilobytes for millions of operators.
 */
export function deflate_bomb_pdf(lineCount) {
  const stream = deflateSync(Buffer.from(DRAWING_OPERATORS.repeat(lineCount)), { level: 9 });
  const parts = [Buffer.from("%PDF-1.7\n", "latin1")];
  const offsets = [];
  let written = parts[0].length;
  for (const [index, object] of PDF_OBJECTS.entries()) {
    offsets.push(written);
    parts.push(Buffer.from(`${index + 1} 0 obj\n${object}\nendobj\n`, "latin1"));
    written += parts.at(-1).length;
  }
  offsets.push(written);
  parts.push(
    Buffer.from(`4 0 obj\n<< /Length ${stream.length} /Filter /FlateDecode >>\nstream\n`),
    stream,
    Buffer.from("\nendstream\nendobj\n"),
  );
  const xrefAt = written + parts.slice(-3).reduce((total, part) => total + part.length, 0);
  const entries = offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`);
  parts.push(
    Buffer.from(
      `xref\n0 5\n${"0".repeat(10)} 65535 f \n${entries.join("")}` +
        `trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`,
    ),
  );
  return new Uint8Array(Buffer.concat(parts));
}
