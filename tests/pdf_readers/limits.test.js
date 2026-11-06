import assert from "node:assert/strict";
import { before, test } from "node:test";

import {
  DEFAULT_BYTE_LIMIT,
  DEFAULT_PAGE_LIMIT,
  configure_reader,
  extract_statement_pages,
} from "../../pdf_reader/pdfjs/adapter.js";
import { fake_pdfjs, fixture_bytes, pdf_header_bytes, use_real_pdfjs } from "./helpers.js";

const MIB = 1024 * 1024;

before(use_real_pdfjs);

/**
 * Build PDF-looking bytes of an exact size.
 *
 * @param {number} size Length in bytes.
 * @returns {Uint8Array} Bytes starting with the PDF header.
 */
function bytes_of_size(size) {
  const bytes = new Uint8Array(size);
  bytes.set(pdf_header_bytes());
  return bytes;
}

test("the default byte limit is 10 MiB", () => {
  assert.equal(DEFAULT_BYTE_LIMIT, 10 * MIB);
});

test("input over the default byte limit is too large, before pdf.js is touched", async () => {
  const { pdfjsLib, calls } = fake_pdfjs({});
  configure_reader({ pdfjsLib, workerSrc: "worker-source" });
  try {
    await assert.rejects(extract_statement_pages(bytes_of_size(10 * MIB + 1), undefined), {
      code: "TOO_LARGE",
    });
    assert.equal(calls.documentOptions, null);
  } finally {
    await use_real_pdfjs();
  }
});

test("input exactly at the byte limit is allowed through", async () => {
  const { pdfjsLib, calls } = fake_pdfjs({});
  configure_reader({ pdfjsLib, workerSrc: "worker-source" });
  try {
    await extract_statement_pages(bytes_of_size(1024), undefined, { byteLimit: 1024 });
    assert.notEqual(calls.documentOptions, null);
  } finally {
    await use_real_pdfjs();
  }
});

test("the byte limit is configurable", async () => {
  await assert.rejects(
    extract_statement_pages(fixture_bytes("F-GOLDEN"), undefined, { byteLimit: 100 }),
    { code: "TOO_LARGE" },
  );
});

test("magic bytes are checked before size, so a huge non-PDF is not a PDF", async () => {
  await assert.rejects(extract_statement_pages(new Uint8Array(10 * MIB + 1), undefined), {
    code: "NOT_A_PDF",
  });
});

test("the many-pages fixture exceeds the default page limit", async () => {
  await assert.rejects(extract_statement_pages(fixture_bytes("F-MANY-PAGES"), undefined), {
    code: "TOO_MANY_PAGES",
  });
});

test("the page limit is configurable in both directions", async () => {
  await assert.rejects(
    extract_statement_pages(fixture_bytes("F-GOLDEN"), undefined, { pageLimit: 1 }),
    { code: "TOO_MANY_PAGES" },
  );
  const statementPages = await extract_statement_pages(fixture_bytes("F-MANY-PAGES"), undefined, {
    pageLimit: DEFAULT_PAGE_LIMIT + 1,
  });
  assert.equal(statementPages.pages.length, DEFAULT_PAGE_LIMIT + 1);
});

test("a slow extraction times out", async () => {
  await assert.rejects(
    extract_statement_pages(fixture_bytes("F-DENSE"), undefined, { timeoutMs: 1 }),
    { code: "TIMEOUT" },
  );
});

test("the task is destroyed after a timeout", async () => {
  const { pdfjsLib, calls } = fake_pdfjs({});
  const original = pdfjsLib.getDocument;
  pdfjsLib.getDocument = (options) => ({
    ...original(options),
    promise: new Promise(() => {}),
  });
  configure_reader({ pdfjsLib, workerSrc: "worker-source" });
  try {
    await assert.rejects(extract_statement_pages(pdf_header_bytes(), undefined, { timeoutMs: 5 }), {
      code: "TIMEOUT",
    });
    assert.equal(calls.destroyed, 1);
  } finally {
    await use_real_pdfjs();
  }
});

test("the dense fixture still extracts within the default timeout", async () => {
  const statementPages = await extract_statement_pages(fixture_bytes("F-DENSE"), undefined);
  assert.ok(statementPages.pages[0].items.length > 0);
});

test("the reader can be reused after a timeout", async () => {
  await extract_statement_pages(fixture_bytes("F-DENSE"), undefined, { timeoutMs: 1 }).catch(
    () => undefined,
  );
  const statementPages = await extract_statement_pages(fixture_bytes("F-GOLDEN"), undefined);
  assert.ok(statementPages.pages.length > 0);
});
