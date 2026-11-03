import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { before, test } from "node:test";

import { extract_statement_pages } from "../pdfjs/adapter.js";
import {
  FIXTURE_NAMES,
  extract_fixture,
  serialize_statement_pages,
} from "../../tools/engines/fixture_engine.js";
import { FAKE_PASSWORD, REPO, fixture_bytes, use_real_pdfjs } from "./helpers.js";

const FIXTURE_PASSWORDS = {
  "F-GOLDEN": undefined,
  "F-ENCRYPTED": FAKE_PASSWORD,
  "F-TIES": undefined,
  "F-SPLIT": undefined,
  "F-DENSE": undefined,
};

before(use_real_pdfjs);

for (const [name, password] of Object.entries(FIXTURE_PASSWORDS)) {
  test(`${name}: adapter output equals the recorded items`, async () => {
    const path = join(REPO, "fixtures/synthetic", `${name}.items.json`);
    const recorded = JSON.parse(readFileSync(path, "utf8"));
    const statementPages = await extract_statement_pages(fixture_bytes(name), password);
    assert.ok(recorded.engine.startsWith("pdfjs "), "items were not recorded from pdf.js");
    assert.deepEqual(statementPages, recorded);
  });
}

test("F-MANY-PAGES: adapter output equals the recorded items, above the default limit", async () => {
  const path = join(REPO, "fixtures/synthetic", "F-MANY-PAGES.items.json");
  const recorded = JSON.parse(readFileSync(path, "utf8"));
  const statementPages = await extract_statement_pages(fixture_bytes("F-MANY-PAGES"), undefined, {
    pageLimit: 501,
  });
  assert.ok(recorded.engine.startsWith("pdfjs "), "items were not recorded from pdf.js");
  assert.deepEqual(statementPages, recorded);
});

test("every recorded file is byte-identical to a fresh recording", async () => {
  for (const name of FIXTURE_NAMES) {
    const statementPages = await extract_fixture(name);
    const path = join(REPO, "fixtures/synthetic", `${name}.items.json`);
    assert.equal(serialize_statement_pages(statementPages), readFileSync(path, "utf8"), name);
  }
});

test("F-SPLIT keeps the date and the time as two items under pdf.js", async () => {
  const statementPages = await extract_fixture("F-SPLIT");
  const texts = statementPages.pages.flatMap((page) => page.items.map((entry) => entry.text));
  assert.ok(texts.some((text) => /^\d{4}-\d{2}-\d{2}$/.test(text)));
  assert.ok(texts.some((text) => /^\d{2}:\d{2}:\d{2}$/.test(text)));
  assert.ok(!texts.some((text) => /\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}/.test(text)));
});

test("whitespace-only items are kept faithfully", async () => {
  const statementPages = await extract_fixture("F-GOLDEN");
  const items = statementPages.pages.flatMap((page) => page.items);
  assert.ok(items.some((entry) => entry.text.trim() === ""));
});
