import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { FAKE_PASSWORD, REPO } from "./helpers.js";

const PROBE = join(REPO, "tools/probes/pdf_signature_probe.mjs");
const FIXTURES = join(REPO, "tests/fixtures/synthetic");
// The cross-reference table's first entry, written so no ten-digit token sits in the source.
const FREE_ENTRY_OFFSET = "0".repeat(10);
const scratch = mkdtempSync(join(tmpdir(), "signature-probe-"));

after(() => rmSync(scratch, { recursive: true, force: true }));

/**
 * Run the probe on a PDF, with optional stdin for the password prompt.
 *
 * @param {string} pdfPath The PDF.
 * @param {string} [input] What stdin carries.
 * @returns {{status: number, stdout: string, stderr: string}} The process outcome.
 */
function probe(pdfPath, input = "") {
  return spawnSync(process.execPath, [PROBE, pdfPath], { input, encoding: "utf8" });
}

/**
 * Build a minimal one-page PDF, optionally with a signature field and a ByteRange in its value.
 *
 * @param {object} options What to include.
 * @param {boolean} options.signatureField Add an AcroForm signature field and its widget.
 * @param {boolean} options.byteRange Give the field a signature value holding a ByteRange.
 * @returns {Buffer} The PDF's bytes, with a correct cross-reference table.
 */
function minimal_pdf({ signatureField, byteRange }) {
  const signatureValue = byteRange
    ? "<< /Type /Sig /Filter /Adobe.PPKLite /ByteRange [0 10 20 30] /Contents <00> >>"
    : "<< /Type /Sig /Filter /Adobe.PPKLite /Contents <00> >>";
  const objects = [
    `<< /Type /Catalog /Pages 2 0 R${signatureField ? " /AcroForm << /Fields [4 0 R] /SigFlags 3 >>" : ""} >>`,
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200]${signatureField ? " /Annots [4 0 R]" : ""} >>`,
    "<< /Type /Annot /Subtype /Widget /FT /Sig /T (Signature1) /Rect [0 0 0 0] /F 132 /P 3 0 R /V 5 0 R >>",
    signatureValue,
  ];
  const used = signatureField ? objects : objects.slice(0, 3);
  let body = "%PDF-1.7\n";
  const offsets = [];
  for (const [index, object] of used.entries()) {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefAt = body.length;
  body += `xref\n0 ${used.length + 1}\n${FREE_ENTRY_OFFSET} 65535 f \n`;
  body += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  body += `trailer\n<< /Size ${used.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

/**
 * Write a PDF into the scratch directory.
 *
 * @param {string} name File name.
 * @param {Buffer} bytes The PDF.
 * @returns {string} Its path.
 */
function scratch_pdf(name, bytes) {
  const path = join(scratch, name);
  writeFileSync(path, bytes);
  return path;
}

test("an unsigned statement prints no and no, and nothing else", () => {
  const outcome = probe(join(FIXTURES, "F-GOLDEN.pdf"));
  assert.equal(outcome.status, 0);
  assert.equal(outcome.stdout, "signature_field: no\nbyterange_token: no\n");
  assert.equal(outcome.stderr, "");
});

test("a signed PDF prints yes and yes", () => {
  const path = scratch_pdf("signed.pdf", minimal_pdf({ signatureField: true, byteRange: true }));
  const outcome = probe(path);
  assert.equal(outcome.status, 0);
  assert.equal(outcome.stdout, "signature_field: yes\nbyterange_token: yes\n");
});

test("a signature field without a ByteRange prints yes and no", () => {
  const path = scratch_pdf("field.pdf", minimal_pdf({ signatureField: true, byteRange: false }));
  assert.equal(probe(path).stdout, "signature_field: yes\nbyterange_token: no\n");
});

test("a plain PDF prints no and no", () => {
  const path = scratch_pdf("plain.pdf", minimal_pdf({ signatureField: false, byteRange: false }));
  assert.equal(probe(path).stdout, "signature_field: no\nbyterange_token: no\n");
});

test("a password PDF is opened with the password from the prompt", () => {
  const outcome = probe(join(FIXTURES, "F-ENCRYPTED.pdf"), `${FAKE_PASSWORD}\n`);
  assert.equal(outcome.stdout, "signature_field: no\nbyterange_token: no\n");
  assert.equal(outcome.stdout.includes(FAKE_PASSWORD), false);
  assert.equal(outcome.stderr.includes(FAKE_PASSWORD), false);
});

test("a wrong password prints a code only", () => {
  const outcome = probe(join(FIXTURES, "F-ENCRYPTED.pdf"), "wrong\n");
  assert.equal(outcome.status, 2);
  assert.equal(outcome.stdout, "pdf_signature_probe: ERROR (PASSWORD_INCORRECT)\n");
});

test("a file that is not a PDF prints a code only", () => {
  const outcome = probe(scratch_pdf("note.pdf", Buffer.from("Example text")));
  assert.equal(outcome.status, 2);
  assert.equal(outcome.stdout, "pdf_signature_probe: ERROR (NOT_A_PDF)\n");
});

test("anything but exactly one path is refused without reading a file", () => {
  const outcome = spawnSync(process.execPath, [PROBE], { encoding: "utf8" });
  assert.equal(outcome.status, 2);
  assert.equal(outcome.stdout, "pdf_signature_probe: ERROR (expected <pdf> and nothing else)\n");
});
