#!/usr/bin/env node
// Says whether a PDF carries a digital signature: is there a signature form field (pdf.js), and
// does a /ByteRange token appear in the raw bytes. Prints yes or no for each and nothing else.
// If the PDF needs a password, it asks with a hidden prompt, as the equivalence tools do.
//   node tools/probes/pdf_signature_probe.mjs <pdf>
// A /ByteRange inside a compressed object stream is not visible in the raw bytes, so "no" for the
// token means "not seen", not "absent".
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { ask_for_password } from "../pdf_readers/password_prompt.js";

const REPO = join(import.meta.dirname, "../..");
const NODE_BUILD = join(REPO, "web/public/vendor/pdfjs-node");
const CANNOT_RUN = 2;
const PDF_MAGIC = "%PDF-";
const BYTE_RANGE = "/ByteRange";
const SIGNATURE_FIELD_TYPE = "Sig";

/**
 * A failure the probe reports by code.
 */
class ProbeError extends Error {
  /**
   * Record the code.
   *
   * Side effects: none.
   *
   * @param {string} code The code to print.
   */
  constructor(code) {
    super(code);
    this.code = code;
  }
}

process.exit(await main());

/**
 * Probe the PDF named on the command line.
 *
 * Side effects: reads the PDF, may prompt for a password, writes two lines to stdout.
 *
 * @returns {Promise<number>} Process exit code: 0 on success, 2 on any failure.
 */
async function main() {
  const pdfPath = parse_request();
  if (pdfPath === null) return refuse("expected <pdf> and nothing else");
  // pdf.js warns on load and can quote the file; nothing but the two answers may leave this tool.
  console.warn = () => undefined;
  console.log = () => undefined;
  try {
    const pdfBytes = new Uint8Array(readFileSync(pdfPath));
    if (new TextDecoder("latin1").decode(pdfBytes.subarray(0, PDF_MAGIC.length)) !== PDF_MAGIC) {
      return refuse("NOT_A_PDF");
    }
    const hasField = await has_signature_field(pdfBytes);
    print(`signature_field: ${hasField ? "yes" : "no"}`);
    print(`byterange_token: ${has_byte_range_token(pdfBytes) ? "yes" : "no"}`);
    return 0;
  } catch (error) {
    return refuse(error instanceof ProbeError ? error.code : "CANNOT_READ");
  }
}

/**
 * Write one line to stdout, which console.log no longer reaches once pdf.js is silenced.
 *
 * Side effects: writes to stdout.
 *
 * @param {string} line The line.
 */
function print(line) {
  process.stdout.write(`${line}\n`);
}

/**
 * Read the command line: exactly one path. Options are refused, so no password can be passed.
 *
 * Side effects: none.
 *
 * @returns {string|null} The PDF's path, or null if the command line is malformed.
 */
function parse_request() {
  try {
    const { positionals } = parseArgs({ options: {}, allowPositionals: true });
    return positionals.length === 1 ? positionals[0] : null;
  } catch {
    return null;
  }
}

/**
 * Print a failure line.
 *
 * Side effects: writes one line to stdout.
 *
 * @param {string} reason A code or fixed text, never from the file.
 * @returns {number} The failure exit code.
 */
function refuse(reason) {
  print(`pdf_signature_probe: ERROR (${reason})`);
  return CANNOT_RUN;
}

/**
 * Tell whether any page carries a signature widget, or the form has a signature field.
 *
 * Side effects: loads pdf.js, may prompt for a password once, and tears pdf.js down.
 *
 * @param {Uint8Array} pdfBytes The PDF.
 * @returns {Promise<boolean>} True if a signature field is present.
 * @throws {ProbeError} PASSWORD_INCORRECT or CORRUPT_PDF.
 */
async function has_signature_field(pdfBytes) {
  const pdfjsLib = await import(pathToFileURL(join(NODE_BUILD, "pdf.min.mjs")));
  pdfjsLib.GlobalWorkerOptions.workerSrc = pathToFileURL(
    join(NODE_BUILD, "pdf.worker.min.mjs"),
  ).href;
  try {
    return await probe_document(pdfjsLib, pdfBytes, undefined);
  } catch (error) {
    if (!is_password_needed(pdfjsLib, error)) throw to_probe_error(pdfjsLib, error);
  }
  try {
    return await probe_document(pdfjsLib, pdfBytes, await ask_for_password());
  } catch (error) {
    throw to_probe_error(pdfjsLib, error);
  }
}

/**
 * Open the PDF with a password, if any, and look for a signature field.
 *
 * Side effects: runs pdf.js, which is always torn down before this returns.
 *
 * @param {object} pdfjsLib The pdf.js module.
 * @param {Uint8Array} pdfBytes The PDF.
 * @param {string|undefined} password The password, if one was asked for.
 * @returns {Promise<boolean>} True if a signature field is present.
 */
async function probe_document(pdfjsLib, pdfBytes, password) {
  const loadingTask = pdfjsLib.getDocument({
    // eslint-disable-next-line id-denylist -- pdf.js names this option; it is not ours to rename.
    data: pdfBytes.slice(),
    password,
    isEvalSupported: false,
    verbosity: 0,
  });
  try {
    const documentProxy = await loadingTask.promise;
    return (await form_has_signature(documentProxy)) || (await pages_have_signature(documentProxy));
  } finally {
    await loadingTask.destroy().catch(() => undefined);
  }
}

/**
 * Tell whether pdf.js failed only for want of a password.
 *
 * Side effects: none.
 *
 * @param {object} pdfjsLib The pdf.js module.
 * @param {unknown} error What pdf.js threw.
 * @returns {boolean} True if a password is needed.
 */
function is_password_needed(pdfjsLib, error) {
  return (
    error?.name === "PasswordException" && error.code === pdfjsLib.PasswordResponses.NEED_PASSWORD
  );
}

/**
 * Map a pdf.js failure to a code, dropping its message.
 *
 * Side effects: none.
 *
 * @param {object} pdfjsLib The pdf.js module.
 * @param {unknown} error What pdf.js threw.
 * @returns {ProbeError} PASSWORD_INCORRECT, PASSWORD_REQUIRED or CORRUPT_PDF.
 */
function to_probe_error(pdfjsLib, error) {
  if (error?.name !== "PasswordException") return new ProbeError("CORRUPT_PDF");
  const incorrect = error.code === pdfjsLib.PasswordResponses.INCORRECT_PASSWORD;
  return new ProbeError(incorrect ? "PASSWORD_INCORRECT" : "PASSWORD_REQUIRED");
}

/**
 * Tell whether the form's field list holds a signature field.
 *
 * Side effects: asks pdf.js for the form fields.
 *
 * @param {object} documentProxy The open document.
 * @returns {Promise<boolean>} True if a field is a signature.
 */
async function form_has_signature(documentProxy) {
  const fields = (await documentProxy.getFieldObjects()) ?? {};
  return Object.values(fields)
    .flat()
    .some((field) => field.type === "signature");
}

/**
 * Tell whether any page's annotations include a signature widget.
 *
 * Side effects: asks pdf.js for each page's annotations, and releases each page.
 *
 * @param {object} documentProxy The open document.
 * @returns {Promise<boolean>} True if a widget's field type is a signature.
 */
async function pages_have_signature(documentProxy) {
  for (let number = 1; number <= documentProxy.numPages; number++) {
    const page = await documentProxy.getPage(number);
    try {
      const annotations = await page.getAnnotations();
      if (annotations.some((annotation) => annotation.fieldType === SIGNATURE_FIELD_TYPE)) {
        return true;
      }
    } finally {
      page.cleanup();
    }
  }
  return false;
}

/**
 * Tell whether the raw bytes hold a /ByteRange token.
 *
 * Side effects: none.
 *
 * @param {Uint8Array} pdfBytes The PDF.
 * @returns {boolean} True if the token appears.
 */
function has_byte_range_token(pdfBytes) {
  return new TextDecoder("latin1").decode(pdfBytes).includes(BYTE_RANGE);
}
