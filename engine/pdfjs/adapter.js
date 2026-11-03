// PDF engine adapter: turns a statement PDF into positioned text, using pdf.js. No rendering.
// Errors carry a code only, because pdf.js messages can quote the file (ADR 0004).

/** Default largest input, in bytes. The real limit is open item OQ-07. */
export const DEFAULT_BYTE_LIMIT = 10 * 1024 * 1024;
/** Default most pages. The real limit is open item OQ-07. */
export const DEFAULT_PAGE_LIMIT = 500;
/** Default longest extraction, in milliseconds. The real limit is open item OQ-07. */
export const DEFAULT_TIMEOUT_MS = 120_000;

const SCHEMA_VERSION = 1;
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d];
const ROUNDING_FACTOR = 100;
const ERROR_CODES = new Set([
  "LAYOUT_UNRECOGNIZED",
  "NOT_A_PDF",
  "PASSWORD_REQUIRED",
  "PASSWORD_INCORRECT",
  "CORRUPT_PDF",
  "TOO_LARGE",
  "TOO_MANY_PAGES",
  "TIMEOUT",
]);

let engine = null;

/**
 * An extraction failure. Holds a code and nothing else.
 */
export class ExtractionError extends Error {
  /**
   * Record why extraction failed.
   *
   * Side effects: none.
   *
   * @param {string} code One of the known error codes.
   * @throws {TypeError} If the code is not known, without repeating it.
   */
  constructor(code) {
    if (!ERROR_CODES.has(code)) throw new TypeError("unknown extraction error code");
    super(code);
    this.name = "ExtractionError";
    this.code = code;
  }
}

/**
 * Choose the pdf.js build to use. The browser and Node load different builds.
 *
 * Side effects: stores the engine for later calls and sets pdf.js's worker source.
 *
 * @param {object} options The engine.
 * @param {object} options.pdfjsLib The loaded pdf.js module.
 * @param {string} options.workerSrc URL of the matching pdf.js worker.
 */
export function configure_engine({ pdfjsLib, workerSrc }) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;
  engine = pdfjsLib;
}

/**
 * Extract positioned text from every page of a statement PDF.
 *
 * Side effects: runs pdf.js and its worker, which are always torn down before this returns.
 *
 * @param {Uint8Array} pdfBytes The PDF's bytes. They are copied, so the caller keeps them.
 * @param {string} [password] The PDF's password, if it has one.
 * @param {object} [limits] Overrides for the default limits.
 * @param {number} [limits.byteLimit] Largest input, in bytes.
 * @param {number} [limits.pageLimit] Most pages.
 * @param {number} [limits.timeoutMs] Longest extraction, in milliseconds.
 * @returns {Promise<object>} The statement pages.
 * @throws {ExtractionError} With a code, whatever goes wrong.
 */
export async function extract_statement_pages(pdfBytes, password, limits = {}) {
  const byteLimit = limits.byteLimit ?? DEFAULT_BYTE_LIMIT;
  const pageLimit = limits.pageLimit ?? DEFAULT_PAGE_LIMIT;
  const timeoutMs = limits.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  check_input(pdfBytes, byteLimit);
  if (engine === null) throw new ExtractionError("CORRUPT_PDF");
  const loadingTask = engine.getDocument({
    // eslint-disable-next-line id-denylist -- pdf.js names this option; it is not ours to rename.
    data: pdfBytes.slice(),
    password,
    useWorkerFetch: true,
    isEvalSupported: false,
    verbosity: 0,
  });
  const deadline = Date.now() + timeoutMs;
  let timer;
  const timedOut = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new ExtractionError("TIMEOUT")), timeoutMs);
  });
  try {
    return await Promise.race([read_all_pages(loadingTask, pageLimit, deadline), timedOut]);
  } catch (error) {
    throw to_extraction_error(error);
  } finally {
    clearTimeout(timer);
    await destroy_quietly(loadingTask);
  }
}

/**
 * Reject input before pdf.js sees it.
 *
 * Side effects: none.
 *
 * @param {Uint8Array} pdfBytes The input.
 * @param {number} byteLimit Largest input, in bytes.
 * @throws {ExtractionError} NOT_A_PDF or TOO_LARGE.
 */
function check_input(pdfBytes, byteLimit) {
  const isBytes = pdfBytes instanceof Uint8Array;
  if (!isBytes || !PDF_MAGIC.every((byte, index) => pdfBytes[index] === byte)) {
    throw new ExtractionError("NOT_A_PDF");
  }
  if (pdfBytes.length > byteLimit) throw new ExtractionError("TOO_LARGE");
}

/**
 * Open the document and read every page in order.
 *
 * Side effects: asks pdf.js for each page, and releases each one.
 *
 * @param {object} loadingTask The pdf.js loading task.
 * @param {number} pageLimit Most pages.
 * @param {number} deadline Time to give up, in milliseconds since the epoch.
 * @returns {Promise<object>} The statement pages.
 * @throws {ExtractionError} TOO_MANY_PAGES or TIMEOUT.
 */
async function read_all_pages(loadingTask, pageLimit, deadline) {
  const documentProxy = await loadingTask.promise;
  check_deadline(deadline);
  if (documentProxy.numPages > pageLimit) throw new ExtractionError("TOO_MANY_PAGES");
  const pages = [];
  for (let number = 1; number <= documentProxy.numPages; number++) {
    pages.push(await read_page(documentProxy, number));
    check_deadline(deadline);
  }
  return { schema_version: SCHEMA_VERSION, engine: `pdfjs ${engine.version}`, pages };
}

/**
 * Give up once the deadline has passed. The timer alone is not enough: when pdf.js runs on this
 * thread, as its fake worker does under Node, the timer cannot fire until pdf.js yields.
 *
 * Side effects: none.
 *
 * @param {number} deadline Time to give up, in milliseconds since the epoch.
 * @throws {ExtractionError} TIMEOUT.
 */
function check_deadline(deadline) {
  if (Date.now() > deadline) throw new ExtractionError("TIMEOUT");
}

/**
 * Read one page's size and text.
 *
 * Side effects: releases the page's resources, even on failure.
 *
 * @param {object} documentProxy The open document.
 * @param {number} number One-based page number.
 * @returns {Promise<object>} The page.
 */
async function read_page(documentProxy, number) {
  const page = await documentProxy.getPage(number);
  try {
    const { width, height } = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items = content.items
      .filter((entry) => entry.str)
      .map((entry) => to_text_item(entry, height));
    return { page_number: number, width, height, items };
  } finally {
    page.cleanup();
  }
}

/**
 * Convert one pdf.js text entry to a text item.
 *
 * Side effects: none.
 *
 * @param {object} entry The pdf.js entry.
 * @param {number} pageHeight Height of the page, in points.
 * @returns {object} The text item, with coordinates rounded to two places.
 */
function to_text_item(entry, pageHeight) {
  const x0 = entry.transform[4];
  const top = pageHeight - entry.transform[5] - entry.height;
  return {
    text: entry.str,
    x0: round_position(x0),
    x1: round_position(x0 + entry.width),
    top: round_position(top),
    bottom: round_position(top + entry.height),
  };
}

/**
 * Round a coordinate.
 *
 * Side effects: none.
 *
 * @param {number} position The coordinate, in points.
 * @returns {number} The coordinate to two decimal places.
 */
function round_position(position) {
  return Math.round(position * ROUNDING_FACTOR) / ROUNDING_FACTOR;
}

/**
 * Map any failure to a code, dropping its message.
 *
 * Side effects: none.
 *
 * @param {Error} error The failure.
 * @returns {ExtractionError} An error holding only a code.
 */
function to_extraction_error(error) {
  if (error instanceof ExtractionError) return error;
  if (error?.name === "PasswordException") {
    const incorrect = error.code === engine.PasswordResponses?.INCORRECT_PASSWORD;
    return new ExtractionError(incorrect ? "PASSWORD_INCORRECT" : "PASSWORD_REQUIRED");
  }
  return new ExtractionError("CORRUPT_PDF");
}

/**
 * Tear down the loading task without letting a failure replace the original error.
 *
 * Side effects: destroys the task and its worker.
 *
 * @param {object} loadingTask The pdf.js loading task.
 * @returns {Promise<void>} Resolves once teardown has finished or failed.
 */
async function destroy_quietly(loadingTask) {
  // Nothing useful can be done if teardown fails, and it must not mask the caller's error.
  await loadingTask.destroy().catch(() => undefined);
}
