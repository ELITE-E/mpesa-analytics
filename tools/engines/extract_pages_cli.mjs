#!/usr/bin/env node
// Runs the pdf.js adapter on a PDF and writes its statement pages outside the repo, for the owner's
// equivalence check. Prints counts only. If the PDF needs a password, it asks with a hidden prompt.
//   node tools/engines/extract_pages_cli.mjs <pdf> --out <file outside the repo>
import {
  closeSync,
  fchmodSync,
  openSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  writeSync,
} from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { parseArgs } from "node:util";

import { ExtractionError, extract_statement_pages } from "../../engine/pdfjs/adapter.js";
import { REPO, serialize_statement_pages, use_node_engine } from "./fixture_engine.js";
import { ask_for_password } from "./password_prompt.js";

const CANNOT_RUN = 2;
const OWNER_ONLY = 0o600;
const NO_LIMIT = Number.MAX_SAFE_INTEGER;
// An equivalence check measures a whole statement, so the app's limits do not apply here.
const CHECK_LIMITS = { byteLimit: NO_LIMIT, pageLimit: NO_LIMIT, timeoutMs: 2 ** 31 - 1 };

process.exit(await main());

/**
 * Extract the PDF named on the command line.
 *
 * Side effects: reads the PDF, may prompt, writes the output file and writes counts to stdout.
 *
 * @returns {Promise<number>} Process exit code: 0 on success, 2 on any failure.
 */
async function main() {
  const request = parse_request();
  if (request === null) {
    console.log("extract_pages_cli: ERROR (expected <pdf> --out <file> and nothing else)");
    return CANNOT_RUN;
  }
  if (is_inside_repo(request.outPath)) {
    console.log("extract_pages_cli: ERROR (--out must be outside the repo)");
    return CANNOT_RUN;
  }
  // pdf.js warns on load and can quote the file; nothing but counts may leave this tool.
  console.warn = () => undefined;
  await use_node_engine();
  try {
    const statementPages = await extract_with_prompt(readFileSync(request.pdfPath));
    write_owner_only(request.outPath, serialize_statement_pages(statementPages));
    print_counts(statementPages);
    return 0;
  } catch (error) {
    // Only a code: other messages could quote the file or its path.
    const reason = error instanceof ExtractionError ? error.code : "CANNOT_READ";
    console.log(`extract_pages_cli: ERROR (${reason})`);
    return CANNOT_RUN;
  }
}

/**
 * Read the command line. Unknown options are rejected, so a password cannot be passed by mistake.
 *
 * Side effects: none.
 *
 * @returns {{pdfPath: string, outPath: string}|null} The request, or null if it is malformed.
 */
function parse_request() {
  try {
    const { values, positionals } = parseArgs({
      options: { out: { type: "string" } },
      allowPositionals: true,
    });
    if (positionals.length !== 1 || !values.out) return null;
    return { pdfPath: positionals[0], outPath: values.out };
  } catch {
    return null;
  }
}

/**
 * Tell whether a path lands inside this repo, following links.
 *
 * Side effects: reads the filesystem.
 *
 * @param {string} outPath The output path.
 * @returns {boolean} True if the file would be written inside the repo.
 */
function is_inside_repo(outPath) {
  const repo = realpathSync(REPO);
  const landing = landing_path(resolve(outPath));
  return landing === repo || landing.startsWith(repo + sep);
}

/**
 * Work out where a path really writes, including through a link whose target does not exist yet.
 *
 * Side effects: reads the filesystem.
 *
 * @param {string} absolutePath An absolute path.
 * @returns {string} The path with every link resolved.
 */
function landing_path(absolutePath) {
  try {
    return realpathSync(absolutePath);
  } catch {
    return resolve_dangling_link(absolutePath);
  }
}

/**
 * Resolve a path that does not exist yet: its directory, or a link's own target.
 *
 * Side effects: reads the filesystem.
 *
 * @param {string} absolutePath An absolute path that cannot be resolved directly.
 * @returns {string} The path it would write to.
 */
function resolve_dangling_link(absolutePath) {
  const link = read_link_target(absolutePath);
  if (link !== null) return landing_path(resolve(dirname(absolutePath), link));
  const parent = dirname(absolutePath);
  if (parent === absolutePath) return absolutePath;
  return join(landing_path(parent), basename(absolutePath));
}

/**
 * Read where a link points.
 *
 * Side effects: reads the filesystem.
 *
 * @param {string} path The path.
 * @returns {string|null} The link's target, or null if the path is not a link.
 */
function read_link_target(path) {
  try {
    return readlinkSync(path);
  } catch {
    return null;
  }
}

/**
 * Extract the statement, asking for a password only if the PDF needs one.
 *
 * Side effects: runs pdf.js, and may prompt and read a password.
 *
 * @param {Uint8Array} fileBytes The PDF's bytes.
 * @returns {Promise<object>} The statement pages.
 */
async function extract_with_prompt(fileBytes) {
  const bytes = new Uint8Array(fileBytes);
  try {
    return await extract_statement_pages(bytes, undefined, CHECK_LIMITS);
  } catch (error) {
    if (error.code !== "PASSWORD_REQUIRED") throw error;
  }
  return extract_statement_pages(bytes, await ask_for_password(), CHECK_LIMITS);
}

/**
 * Write a file only its owner can read. Permissions tighten before any text is written.
 *
 * Side effects: creates or replaces the file.
 *
 * @param {string} outPath The output path.
 * @param {string} text The file's text.
 */
function write_owner_only(outPath, text) {
  const descriptor = openSync(outPath, "w", OWNER_ONLY);
  try {
    fchmodSync(descriptor, OWNER_ONLY);
    writeSync(descriptor, text);
  } finally {
    closeSync(descriptor);
  }
}

/**
 * Print fixed labels and counts.
 *
 * Side effects: writes to stdout.
 *
 * @param {object} statementPages The statement pages.
 */
function print_counts(statementPages) {
  const items = statementPages.pages.reduce((total, page) => total + page.items.length, 0);
  console.log(`pages: ${statementPages.pages.length}`);
  console.log(`items: ${items}`);
}
