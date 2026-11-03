import assert from "node:assert/strict";
import { test } from "node:test";

import { configure_engine, extract_statement_pages } from "../pdfjs/adapter.js";
import { fake_pdfjs, pdf_header_bytes } from "./helpers.js";

/**
 * Run the adapter against a fake pdf.js and report what happened.
 *
 * @param {object} fakeOptions Options for the fake.
 * @param {object} [limits] Limits for the extraction.
 * @returns {Promise<{calls: object, failure: Error}>} The fake's calls and any rejection.
 */
async function run_expecting_failure(fakeOptions, limits) {
  const { pdfjsLib, calls } = fake_pdfjs(fakeOptions);
  configure_engine({ pdfjsLib, workerSrc: "worker-source" });
  const failure = await extract_statement_pages(pdf_header_bytes(), undefined, limits).catch(
    (error) => error,
  );
  return { calls, failure };
}

test("destroy is called when getting a page throws", async () => {
  const { calls, failure } = await run_expecting_failure({ pageError: new Error("boom") });
  assert.equal(failure.code, "CORRUPT_PDF");
  assert.equal(calls.destroyed, 1);
});

test("destroy is called when opening the document throws", async () => {
  const { calls, failure } = await run_expecting_failure({ loadError: new Error("boom") });
  assert.equal(failure.code, "CORRUPT_PDF");
  assert.equal(calls.destroyed, 1);
});

test("destroy is called when reading a page's text throws", async () => {
  const { pdfjsLib, calls } = fake_pdfjs({ textItems: [] });
  const original = pdfjsLib.getDocument;
  pdfjsLib.getDocument = (options) => {
    const task = original(options);
    const opened = task.promise.then((documentProxy) => ({
      numPages: documentProxy.numPages,
      getPage: async () => ({
        getViewport: () => ({ width: 1, height: 1 }),
        getTextContent: async () => {
          throw new Error("boom");
        },
        cleanup: () => {
          calls.cleanedPages += 1;
        },
      }),
    }));
    return { promise: opened, destroy: task.destroy };
  };
  configure_engine({ pdfjsLib, workerSrc: "worker-source" });
  await assert.rejects(extract_statement_pages(pdf_header_bytes(), undefined));
  assert.equal(calls.destroyed, 1);
  assert.equal(calls.cleanedPages, 1);
});

test("destroy is called when the page limit is exceeded", async () => {
  const { calls, failure } = await run_expecting_failure({ numPages: 3 }, { pageLimit: 2 });
  assert.equal(failure.code, "TOO_MANY_PAGES");
  assert.equal(calls.destroyed, 1);
});

test("a failing destroy does not hide the original error", async () => {
  const { pdfjsLib } = fake_pdfjs({ pageError: new Error("boom") });
  const original = pdfjsLib.getDocument;
  pdfjsLib.getDocument = (options) => ({
    ...original(options),
    destroy: async () => {
      throw new Error("destroy failed");
    },
  });
  configure_engine({ pdfjsLib, workerSrc: "worker-source" });
  await assert.rejects(extract_statement_pages(pdf_header_bytes(), undefined), {
    code: "CORRUPT_PDF",
  });
});

test("destroy is never reached for input rejected before pdf.js is touched", async () => {
  const { pdfjsLib, calls } = fake_pdfjs({});
  configure_engine({ pdfjsLib, workerSrc: "worker-source" });
  await assert.rejects(extract_statement_pages(new Uint8Array(8), undefined), {
    code: "NOT_A_PDF",
  });
  assert.equal(calls.documentOptions, null);
  assert.equal(calls.destroyed, 0);
});
