import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { before, test } from "node:test";

import {
  ExtractionError,
  configure_reader,
  extract_statement_pages,
} from "../../pdf_reader/pdfjs/adapter.js";
import {
  FAKE_PASSWORD,
  fake_pdfjs,
  fixture_bytes,
  pdf_header_bytes,
  use_real_pdfjs,
} from "./helpers.js";

const MARKER = "PLANTEDMARKERTEXT";

before(use_real_pdfjs);

/**
 * Check that a rejection carries a code and nothing else.
 *
 * @param {Promise<unknown>} extraction The extraction under test.
 * @param {string} code Expected error code.
 * @returns {Promise<void>} Resolves when the check has passed.
 */
async function rejects_with_code(extraction, code) {
  await assert.rejects(extraction, (error) => {
    assert.ok(error instanceof ExtractionError);
    assert.equal(error.code, code);
    assert.equal(error.message, code);
    assert.equal(error.cause, undefined);
    return true;
  });
}

test("random bytes are not a PDF", async () => {
  await rejects_with_code(extract_statement_pages(randomBytes(4096), undefined), "NOT_A_PDF");
});

test("empty input is not a PDF", async () => {
  await rejects_with_code(extract_statement_pages(new Uint8Array(0), undefined), "NOT_A_PDF");
});

test("input that is not bytes is not a PDF", async () => {
  await rejects_with_code(extract_statement_pages("%PDF-1.4", undefined), "NOT_A_PDF");
});

test("random bytes behind a PDF header are corrupt", async () => {
  const header = pdf_header_bytes();
  const bytes = new Uint8Array(4096);
  bytes.set(randomBytes(4096));
  bytes.set(header);
  await rejects_with_code(extract_statement_pages(bytes, undefined), "CORRUPT_PDF");
});

for (const share of [0.9, 0.5, 0.1]) {
  test(`a file truncated to ${share} of its size is corrupt`, async () => {
    const whole = fixture_bytes("F-GOLDEN");
    const truncated = whole.slice(0, Math.floor(whole.length * share));
    await rejects_with_code(extract_statement_pages(truncated, undefined), "CORRUPT_PDF");
  });
}

test("a missing password is reported", async () => {
  await rejects_with_code(
    extract_statement_pages(fixture_bytes("F-ENCRYPTED"), undefined),
    "PASSWORD_REQUIRED",
  );
});

test("a wrong password is reported, without repeating it", async () => {
  const wrong = `not-${FAKE_PASSWORD}`;
  await assert.rejects(extract_statement_pages(fixture_bytes("F-ENCRYPTED"), wrong), (error) => {
    assert.equal(error.code, "PASSWORD_INCORRECT");
    assert.ok(!JSON.stringify(error).includes(wrong));
    assert.ok(!String(error.stack).includes(wrong));
    return true;
  });
});

test("the right password opens the statement", async () => {
  const statementPages = await extract_statement_pages(fixture_bytes("F-ENCRYPTED"), FAKE_PASSWORD);
  assert.ok(statementPages.pages[0].items.length > 0);
});

test("a PDF with no password opens when given one anyway", async () => {
  const statementPages = await extract_statement_pages(fixture_bytes("F-GOLDEN"), FAKE_PASSWORD);
  assert.ok(statementPages.pages[0].items.length > 0);
});

test("the error from a reader failure never carries the reader's message", async () => {
  const { pdfjsLib } = fake_pdfjs({ loadError: new Error(`bad row ${MARKER}`) });
  configure_reader({ pdfjsLib, workerSrc: "worker-source" });
  try {
    await assert.rejects(extract_statement_pages(pdf_header_bytes(), undefined), (error) => {
      assert.equal(error.code, "CORRUPT_PDF");
      assert.ok(!String(error.message).includes(MARKER));
      assert.ok(!String(error.stack).includes(MARKER));
      assert.equal(error.cause, undefined);
      return true;
    });
  } finally {
    await use_real_pdfjs();
  }
});

test("an error can only be built from a known code", () => {
  assert.throws(() => new ExtractionError(`row ${MARKER}`), TypeError);
  assert.throws(
    () => new ExtractionError(`row ${MARKER}`),
    (error) => {
      assert.ok(!error.message.includes(MARKER));
      return true;
    },
  );
});

for (const code of [
  "LAYOUT_UNRECOGNIZED",
  "NOT_A_PDF",
  "PASSWORD_REQUIRED",
  "PASSWORD_INCORRECT",
  "CORRUPT_PDF",
  "TOO_LARGE",
  "TOO_MANY_PAGES",
  "TIMEOUT",
]) {
  test(`${code} is a known code, matching the core's errors`, () => {
    assert.equal(new ExtractionError(code).code, code);
  });
}
