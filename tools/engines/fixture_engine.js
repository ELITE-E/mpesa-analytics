// Shared by the recorder, the comparison tool and the engine tests. Uses pdf.js's Node build.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { configure_engine, extract_statement_pages } from "../../engine/pdfjs/adapter.js";

export const REPO = join(dirname(fileURLToPath(import.meta.url)), "../..");
export const FIXTURES = join(REPO, "fixtures/synthetic");
export const MANIFEST_PATH = join(FIXTURES, "MANIFEST.toml");
export const FIXTURE_NAMES = [
  "F-GOLDEN",
  "F-ENCRYPTED",
  "F-TIES",
  "F-SPLIT",
  "F-DENSE",
  "F-MANY-PAGES",
];

const NODE_BUILD = join(REPO, "web/public/vendor/pdfjs-node");
const ENCRYPTED_FIXTURE = "F-ENCRYPTED";
const NO_LIMIT = Number.MAX_SAFE_INTEGER;
const JSON_INDENT = 1;

/**
 * Load the pinned Node build of pdf.js and hand it to the adapter.
 *
 * Side effects: sets the adapter's engine and pdf.js's worker source.
 *
 * @returns {Promise<void>} Resolves when the engine is ready.
 */
export async function use_node_engine() {
  const pdfjsLib = await import(pathToFileURL(join(NODE_BUILD, "pdf.min.mjs")));
  const workerSrc = pathToFileURL(join(NODE_BUILD, "pdf.worker.min.mjs")).href;
  configure_engine({ pdfjsLib, workerSrc });
}

/**
 * Extract a committed fixture with no limits, so the over-limit fixture records too.
 *
 * Side effects: reads the fixture and runs pdf.js.
 *
 * @param {string} name Fixture name.
 * @returns {Promise<object>} The statement pages.
 */
export async function extract_fixture(name) {
  const bytes = new Uint8Array(readFileSync(join(FIXTURES, `${name}.pdf`)));
  const password = name === ENCRYPTED_FIXTURE ? manifest_password() : undefined;
  return extract_statement_pages(bytes, password, { pageLimit: NO_LIMIT });
}

/**
 * Read the fake password from the fixture manifest.
 *
 * Side effects: reads the manifest.
 *
 * @returns {string} The fake password.
 */
export function manifest_password() {
  return readFileSync(MANIFEST_PATH, "utf8").match(/^fake_password = "(.*)"$/m)[1];
}

/**
 * Serialize statement pages with sorted keys, so a recording is byte-stable.
 *
 * Side effects: none.
 *
 * @param {object} statementPages The statement pages.
 * @returns {string} JSON text ending in a newline.
 */
export function serialize_statement_pages(statementPages) {
  return `${JSON.stringify(sort_keys(statementPages), null, JSON_INDENT)}\n`;
}

/**
 * Copy a JSON value with every object's keys in sorted order.
 *
 * Side effects: none.
 *
 * @param {unknown} value A JSON-compatible value.
 * @returns {unknown} The sorted copy.
 */
function sort_keys(value) {
  if (Array.isArray(value)) return value.map(sort_keys);
  if (value === null || typeof value !== "object") return value;
  const pairs = Object.keys(value)
    .sort()
    .map((key) => [key, sort_keys(value[key])]);
  return Object.fromEntries(pairs);
}
