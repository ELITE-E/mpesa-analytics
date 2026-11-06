#!/usr/bin/env node
// Re-records every fixture's items from real pdf.js and updates the manifest. Prints counts only.
//   node tools/pdf_readers/record_items.mjs
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  FIXTURES,
  FIXTURE_NAMES,
  MANIFEST_PATH,
  extract_fixture,
  serialize_statement_pages,
  use_node_reader,
} from "./fixture_reader.js";

const RECORDED_MARKER = "\n[[recorded]]";

await main();
process.exit(0);

/**
 * Record each fixture and rewrite the manifest's recorded section.
 *
 * Side effects: writes each fixture's items file and the manifest, and prints counts.
 *
 * @returns {Promise<void>} Resolves when everything is written.
 */
async function main() {
  await use_node_reader();
  const entries = [];
  for (const name of FIXTURE_NAMES) {
    entries.push(await record_fixture(name));
  }
  const [kept] = readFileSync(MANIFEST_PATH, "utf8").split(RECORDED_MARKER);
  writeFileSync(MANIFEST_PATH, `${kept.trimEnd()}\n${entries.join("")}`);
  console.log(`record_items: recorded ${entries.length} fixtures`);
}

/**
 * Record one fixture.
 *
 * Side effects: writes the items file and prints its size.
 *
 * @param {string} name Fixture name.
 * @returns {Promise<string>} Its manifest entry.
 */
async function record_fixture(name) {
  const statementPages = await extract_fixture(name);
  const serialized = serialize_statement_pages(statementPages);
  writeFileSync(join(FIXTURES, `${name}.items.json`), serialized);
  console.log(`${name}.items.json: ${serialized.length} bytes`);
  const source = readFileSync(join(FIXTURES, `${name}.pdf`));
  return [
    RECORDED_MARKER,
    `path = "${name}.items.json"`,
    `source = "${name}.pdf"`,
    `source_sha256 = "${sha256(source)}"`,
    `engine = "${statementPages.engine}"`,
    `sha256 = "${sha256(serialized)}"`,
    "",
  ].join("\n");
}

/**
 * Hash content.
 *
 * Side effects: none.
 *
 * @param {string|Uint8Array} content The content.
 * @returns {string} Lowercase hex digest.
 */
function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}
