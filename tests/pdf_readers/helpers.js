// Shared by the PDF reader's Node tests. Uses the legacy build, the one that runs under Node.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { configure_reader } from "../../pdf_reader/pdfjs/adapter.js";

export const REPO = join(dirname(fileURLToPath(import.meta.url)), "../..");
export const FAKE_PASSWORD = "synthetic-only";
const NODE_BUILD = join(REPO, "web/public/vendor/pdfjs-node");

/**
 * Load the pinned pdf.js build and hand it to the adapter.
 *
 * Side effects: sets the adapter's reader and pdf.js's worker source.
 *
 * @returns {Promise<object>} The pdf.js module.
 */
export async function use_real_pdfjs() {
  const pdfjsLib = await import(pathToFileURL(join(NODE_BUILD, "pdf.min.mjs")));
  const workerSrc = pathToFileURL(join(NODE_BUILD, "pdf.worker.min.mjs")).href;
  configure_reader({ pdfjsLib, workerSrc });
  return pdfjsLib;
}

/**
 * Read a committed fixture PDF.
 *
 * Side effects: reads the file.
 *
 * @param {string} name Fixture name, without a suffix.
 * @returns {Uint8Array} The PDF's bytes.
 */
export function fixture_bytes(name) {
  return new Uint8Array(readFileSync(join(REPO, "tests/fixtures/synthetic", `${name}.pdf`)));
}

/**
 * Build a fake pdf.js with text items and spies, for tests that need exact inputs.
 *
 * Side effects: none.
 *
 * @param {object} [options] Behaviour of the fake.
 * @param {object[]} [options.textItems] Items each page returns from getTextContent.
 * @param {number} [options.numPages] Number of pages in the document.
 * @param {Error} [options.loadError] Rejects the document load with this.
 * @param {Error} [options.pageError] Rejects getPage with this.
 * @returns {{pdfjsLib: object, calls: object}} The fake module and what was called on it.
 */
export function fake_pdfjs({ textItems = [], numPages = 1, loadError, pageError } = {}) {
  const calls = { destroyed: 0, cleanedPages: 0, documentOptions: null };
  const page = {
    getViewport: () => ({ width: 595, height: 848 }),
    getTextContent: async () => ({ items: textItems }),
    cleanup: () => {
      calls.cleanedPages += 1;
    },
  };
  const documentProxy = {
    numPages,
    getPage: async () => {
      if (pageError) throw pageError;
      return page;
    },
  };
  const pdfjsLib = {
    version: "0.0.0-fake",
    GlobalWorkerOptions: {},
    getDocument: (options) => {
      calls.documentOptions = options;
      return {
        promise: loadError ? Promise.reject(loadError) : Promise.resolve(documentProxy),
        destroy: async () => {
          calls.destroyed += 1;
        },
      };
    },
  };
  return { pdfjsLib, calls };
}

/**
 * Make the smallest bytes that pass the magic-byte check.
 *
 * Side effects: none.
 *
 * @returns {Uint8Array} Bytes starting with the PDF header.
 */
export function pdf_header_bytes() {
  return new TextEncoder().encode("%PDF-1.4\n");
}
