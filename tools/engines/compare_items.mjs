#!/usr/bin/env node
// Compares pdf.js output with the generator's model for committed fixtures. Prints numbers only.
//   node tools/engines/compare_items.mjs [--fixture F-GOLDEN] [--limit 0.5]
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { FIXTURES, FIXTURE_NAMES, extract_fixture, use_node_engine } from "./fixture_engine.js";
import { MAX_DEVIATION_POINTS, measure_deviation } from "./item_deviation.js";

const OVER_LIMIT = 1;

process.exit(await main());

/**
 * Compare each requested fixture and print the worst deviation.
 *
 * Side effects: reads fixtures and writes numbers to stdout.
 *
 * @returns {Promise<number>} Process exit code: 1 if the model does not match pdf.js.
 */
async function main() {
  await use_node_engine();
  const requested = argument_value("--fixture");
  const limit = Number(argument_value("--limit") ?? MAX_DEVIATION_POINTS);
  let worst = 0;
  let unpaired = 0;
  for (const name of requested ? [requested] : FIXTURE_NAMES) {
    const deviation = await compare_fixture(name);
    worst = Math.max(worst, deviation.maximum);
    unpaired += deviation.unmatched + deviation.extra_text;
  }
  console.log(`max_deviation_points: ${worst}`);
  console.log(`unpaired_text_items: ${unpaired}`);
  if (worst > limit || unpaired > 0) {
    console.log(`STOP: the model does not match pdf.js (limit ${limit} pt)`);
    return OVER_LIMIT;
  }
  return 0;
}

/**
 * Compare one fixture and print its counts.
 *
 * Side effects: reads the fixture and writes numbers to stdout.
 *
 * @param {string} name Fixture name.
 * @returns {Promise<object>} The fixture's deviation.
 */
async function compare_fixture(name) {
  const model = JSON.parse(readFileSync(join(FIXTURES, `${name}.model.json`), "utf8"));
  const recorded = await extract_fixture(name);
  const deviation = measure_deviation(model, recorded);
  const axes = Object.entries(deviation.by_axis)
    .map(([axis, value]) => `${axis}=${value.toFixed(3)}`)
    .join(" ");
  console.log(
    `${name}: pages=${recorded.pages.length} model_items=${count_items(model)} ` +
      `pdfjs_items=${count_items(recorded)} unmatched=${deviation.unmatched} ` +
      `extra_whitespace=${deviation.extra_whitespace} extra_text=${deviation.extra_text} ${axes}`,
  );
  return deviation;
}

/**
 * Count a statement's text items.
 *
 * Side effects: none.
 *
 * @param {object} statementPages The statement pages.
 * @returns {number} Total items.
 */
function count_items(statementPages) {
  return statementPages.pages.reduce((total, page) => total + page.items.length, 0);
}

/**
 * Read a command-line option's value.
 *
 * Side effects: none.
 *
 * @param {string} name Option name.
 * @returns {string|undefined} The value, if the option was given.
 */
function argument_value(name) {
  const position = process.argv.indexOf(name);
  return position > 0 ? process.argv[position + 1] : undefined;
}
