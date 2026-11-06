import assert from "node:assert/strict";
import { test } from "node:test";

import { configure_reader, extract_statement_pages } from "../../pdf_reader/pdfjs/adapter.js";
import { fake_pdfjs, pdf_header_bytes } from "./helpers.js";

/**
 * Build one pdf.js text item.
 *
 * @param {string} str Text.
 * @param {number} x Left edge.
 * @param {number} y Baseline, from the bottom of the page.
 * @returns {object} The item.
 */
function text_item(str, x, y) {
  return { str, transform: [1, 0, 0, 1, x, y], width: 10.126, height: 6.004 };
}

/**
 * Run the adapter against a fake pdf.js.
 *
 * @param {object} options Options for the fake.
 * @returns {Promise<object>} The statement pages and the fake's call record.
 */
async function extract_with_fake(options) {
  const { pdfjsLib, calls } = fake_pdfjs(options);
  configure_reader({ pdfjsLib, workerSrc: "worker-source" });
  const statementPages = await extract_statement_pages(pdf_header_bytes(), undefined);
  return { statementPages, calls, pdfjsLib };
}

test("worker source is set explicitly", async () => {
  const { pdfjsLib } = await extract_with_fake({});
  assert.equal(pdfjsLib.GlobalWorkerOptions.workerSrc, "worker-source");
});

test("the document is opened with the required options", async () => {
  const { calls } = await extract_with_fake({});
  assert.equal(calls.documentOptions.useWorkerFetch, true);
  assert.equal(calls.documentOptions.isEvalSupported, false);
});

test("the password is passed to pdf.js", async () => {
  const { pdfjsLib, calls } = fake_pdfjs({});
  configure_reader({ pdfjsLib, workerSrc: "worker-source" });
  await extract_statement_pages(pdf_header_bytes(), "a-fake-password");
  assert.equal(calls.documentOptions.password, "a-fake-password");
});

test("the output carries the schema version and the engine with its version", async () => {
  const { statementPages } = await extract_with_fake({});
  assert.equal(statementPages.schema_version, 1);
  assert.equal(statementPages.engine, "pdfjs 0.0.0-fake");
});

test("pages carry their number and size", async () => {
  const { statementPages } = await extract_with_fake({ numPages: 2 });
  assert.deepEqual(
    statementPages.pages.map((page) => [page.page_number, page.width, page.height]),
    [
      [1, 595, 848],
      [2, 595, 848],
    ],
  );
});

test("coordinates follow the agreed formulas, rounded to two places", async () => {
  const { statementPages } = await extract_with_fake({
    textItems: [text_item("a", 70.126, 700.5)],
  });
  assert.deepEqual(statementPages.pages[0].items, [
    { text: "a", x0: 70.13, x1: 80.25, top: 141.5, bottom: 147.5 },
  ]);
});

test("empty strings are dropped", async () => {
  const { statementPages } = await extract_with_fake({
    textItems: [text_item("", 1, 1), text_item("kept", 1, 1)],
  });
  assert.deepEqual(
    statementPages.pages[0].items.map((entry) => entry.text),
    ["kept"],
  );
});

test("marked content entries without text are dropped", async () => {
  const { statementPages } = await extract_with_fake({
    textItems: [{ type: "beginMarkedContent" }, text_item("kept", 1, 1)],
  });
  assert.equal(statementPages.pages[0].items.length, 1);
});

test("every page is cleaned up and the task destroyed after success", async () => {
  const { calls } = await extract_with_fake({ numPages: 3 });
  assert.equal(calls.cleanedPages, 3);
  assert.equal(calls.destroyed, 1);
});

test("the adapter's bytes are not detached from the caller", async () => {
  const { pdfjsLib, calls } = fake_pdfjs({});
  configure_reader({ pdfjsLib, workerSrc: "worker-source" });
  const bytes = pdf_header_bytes();
  await extract_statement_pages(bytes, undefined);
  assert.notEqual(calls.documentOptions.data, bytes);
});

test("extracting before the reader is configured fails with a code", async () => {
  const fresh = await import(`../../pdf_reader/pdfjs/adapter.js?unconfigured=${Date.now()}`);
  await assert.rejects(fresh.extract_statement_pages(pdf_header_bytes(), undefined), {
    code: "CORRUPT_PDF",
  });
});
