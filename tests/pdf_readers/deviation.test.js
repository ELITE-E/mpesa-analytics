import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { test } from "node:test";

import { MAX_DEVIATION_POINTS, measure_deviation } from "../../tools/pdf_readers/item_deviation.js";
import { REPO } from "./helpers.js";

/**
 * Build a one-page statement.
 *
 * @param {object[]} items Text items.
 * @returns {object} The statement pages.
 */
function one_page(items) {
  return { pages: [{ items }] };
}

/**
 * Build a text item.
 *
 * @param {string} text Text.
 * @param {number} top Top position.
 * @param {number} [x0] Left edge.
 * @returns {object} The item.
 */
function text_item(text, top, x0 = 10) {
  return { text, x0, x1: x0 + 5, top, bottom: top + 6 };
}

test("the limit is half a point", () => {
  assert.equal(MAX_DEVIATION_POINTS, 0.5);
});

test("identical items deviate by nothing", () => {
  const items = [text_item("a", 100)];
  const deviation = measure_deviation(one_page(items), one_page(items));
  assert.equal(deviation.maximum, 0);
  assert.equal(deviation.unmatched, 0);
  assert.equal(deviation.extra, 0);
});

test("the worst axis is reported, whichever direction it goes", () => {
  const deviation = measure_deviation(
    one_page([text_item("a", 100)]),
    one_page([text_item("a", 98.5, 10.25)]),
  );
  assert.equal(deviation.maximum, 1.5);
  assert.equal(deviation.by_axis.top, 1.5);
  assert.equal(deviation.by_axis.x0, 0.25);
});

test("repeated text pairs with its nearest item, not the first", () => {
  const model = one_page([text_item("a", 100), text_item("a", 200)]);
  const recorded = one_page([text_item("a", 200), text_item("a", 100)]);
  assert.equal(measure_deviation(model, recorded).maximum, 0);
});

test("modelled text that pdf.js did not return is counted as unmatched", () => {
  const deviation = measure_deviation(one_page([text_item("a", 100)]), one_page([]));
  assert.equal(deviation.unmatched, 1);
});

test("text pdf.js returned beyond the model is counted, split out for whitespace", () => {
  const deviation = measure_deviation(
    one_page([text_item("a", 100)]),
    one_page([text_item("a", 100), text_item(" ", 100), text_item("b", 100)]),
  );
  assert.equal(deviation.extra, 2);
  assert.equal(deviation.extra_whitespace, 1);
});

test("the comparison tool prints numbers and fixed labels, never fixture text", () => {
  const completed = spawnSync(
    process.execPath,
    [join(REPO, "tools/pdf_readers/compare_items.mjs"), "--fixture", "F-TIES"],
    { encoding: "utf8", cwd: REPO },
  );
  assert.ok(completed.stdout.includes("max_deviation_points:"), completed.stderr);
  assert.ok(!completed.stdout.includes("ZZ"));
  assert.ok(!completed.stdout.includes("Example"));
  assert.ok(!completed.stdout.includes("Completed"));
});

test("the comparison tool exits non-zero when deviation is over the limit", () => {
  const completed = spawnSync(
    process.execPath,
    [join(REPO, "tools/pdf_readers/compare_items.mjs"), "--fixture", "F-TIES", "--limit", "0"],
    { encoding: "utf8", cwd: REPO },
  );
  assert.equal(completed.status, 1, completed.stderr);
  assert.ok(completed.stdout.includes("STOP"));
});

test("every committed fixture stays within the limit, with nothing unpaired", () => {
  const completed = spawnSync(
    process.execPath,
    [join(REPO, "tools/pdf_readers/compare_items.mjs")],
    {
      encoding: "utf8",
      cwd: REPO,
    },
  );
  assert.equal(completed.status, 0, completed.stdout);
  assert.ok(!completed.stdout.includes("STOP"));
});

test("modelled text pdf.js did not return fails the comparison, whatever the deviation", () => {
  const completed = spawnSync(
    process.execPath,
    [join(REPO, "tools/pdf_readers/compare_items.mjs"), "--fixture", "F-TIES", "--limit", "1000"],
    { encoding: "utf8", cwd: REPO },
  );
  assert.ok(completed.stdout.includes("unmatched=0"), completed.stdout);
  assert.ok(completed.stdout.includes("extra_text=0"), completed.stdout);
});
