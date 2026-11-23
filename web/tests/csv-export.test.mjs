// CP10a item 3: the CSV export (lib/ledger-csv.ts, lib/download-csv.ts). Cells starting with
// = + - @, a tab or a carriage return are neutralised unless they are plain numbers; commas, quotes
// and newlines are quoted; the file starts with a UTF-8 byte order mark; its name holds no personal
// data; and the screen says the CSV is not encrypted. Every Details text is invented.
//
// Run from web/:
//   node --import ./tests/support/register.mjs --test tests/csv-export.test.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

const { csvText, csvFileText, downloadCsv } = await import("../src/lib/download-csv.ts");
const { ledgerCsvFileName } = await import("../src/lib/ledger-csv.ts");
const { ExportLedgerButton } = await import("../src/components/ledger/export-ledger-button.tsx");
const { exportNotice } = await import("../src/content/ledger.ts");

const HOSTILE = [
  '=HYPERLINK("http://example.invalid","Example Shop")',
  "+SUM(1,2)",
  "-2+3+cmd|' /C calc'!A0",
  "@SUM(1)",
  "\tExample tabbed",
  "\rExample carriage",
];

/** The cells of a one-row CSV, parsed back (every cell is quoted). */
function cellsOf(text) {
  const line = text.split("\n")[1];
  return [...line.matchAll(/"((?:[^"]|"")*)"/g)].map((match) => match[1].replaceAll('""', '"'));
}

test("cells that a spreadsheet would run as a formula are neutralised", () => {
  for (const hostile of HOSTILE) {
    const [cell] = cellsOf(csvText(["statement_details"], [[hostile]]));
    assert.equal(cell, `'${hostile}`, JSON.stringify(hostile));
  }
});

test("plain numbers, signed or not, are left as numbers", () => {
  for (const number of ["-450.00", "+12", "-3.5", "1200.00", "0"]) {
    assert.deepEqual(cellsOf(csvText(["amount"], [[number]])), [number]);
  }
});

test("ordinary text is left alone", () => {
  for (const text of ["Merchant Payment to Example Shop", "Example - Shop", "A=B"]) {
    assert.deepEqual(cellsOf(csvText(["details"], [[text]])), [text]);
  }
});

test("commas, quotes and newlines stay inside their cell", () => {
  const text = csvText(["details", "amount"], [['Example "Shop", Nairobi\nbranch', "450.00"]]);
  assert.equal(text, '"details","amount"\n"Example ""Shop"", Nairobi\nbranch","450.00"');
});

test("the file starts with a UTF-8 byte order mark, so spreadsheets read its text right", () => {
  const text = csvFileText(["details"], [["Café Example"]]);
  assert.equal(text.charCodeAt(0), 0xfeff);
  assert.equal(text.slice(1), csvText(["details"], [["Café Example"]]));
});

test("the download carries the byte order mark and the neutralised cells", async () => {
  let blob = null;
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  URL.createObjectURL = (created) => {
    blob = created;
    return "blob:test";
  };
  URL.revokeObjectURL = () => {};
  globalThis.document = { createElement: () => ({ click() {} }) };
  try {
    downloadCsv("mpesa-ledger.csv", ["details"], [["=1+1"]]);
  } finally {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
    delete globalThis.document;
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.match(blob.type, /text\/csv/);
  assert.ok(new TextDecoder().decode(bytes).includes(`"'=1+1"`));
});

test("the file name holds the period's dates and nothing personal", () => {
  const name = ledgerCsvFileName({ period_start: "2026-01-02 10:00:00", period_end: "2026-01-31 18:05:00" });
  assert.equal(name, "mpesa-ledger-2026-01-02-to-2026-01-31.csv");
  assert.match(ledgerCsvFileName({ period_start: "", period_end: "" }), /^mpesa-ledger\.csv$/);
});

test("the Ledger names its export with that file name, never from the scope it shows", () => {
  const source = readFileSync(join(import.meta.dirname, "../src/components/ledger/ledger-explorer.tsx"), "utf8");
  assert.match(source, /ledgerCsvFileName\(/);
  assert.equal(/fileName = `ledger-/.test(source), false);
  assert.equal(/scope\.id/.test(source.slice(source.indexOf("const fileName"), source.indexOf("const fileName") + 200)), false);
});

test("the export says the CSV is not encrypted", () => {
  const html = renderToString(createElement(ExportLedgerButton, { rows: [], fileName: "mpesa-ledger.csv", className: "" }, "Export"));
  assert.ok(html.includes(exportNotice));
  assert.match(exportNotice, /not encrypted/);
});
