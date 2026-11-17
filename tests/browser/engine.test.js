// The browser engine in real Chrome: the same statement pages as the Node reader, the same
// pipeline result as CPython, every failure code, and no request but same-origin static GETs.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { DESKTOP_LIMITS } from "../../pdf_reader/limits.js";
import {
  FIXTURE_NAMES,
  extract_fixture,
  manifest_password,
  use_node_reader,
} from "../../tools/pdf_readers/fixture_reader.js";
import {
  fixture_pdf,
  open_session,
  other_requests,
  run_in_browser,
  run_in_cpython,
} from "../../tools/browser/browser_session.js";
import { deflate_bomb_pdf } from "./hostile_pdf.js";

const PROCESSED_AT = "2026-11-16T09:00:00Z";
const NO_PAGE_LIMIT = { pageLimit: Number.MAX_SAFE_INTEGER };
const ENCRYPTED = "F-ENCRYPTED";
const WITHOUT_ROWS = "F-NOTABLE";
const PDF_HEADER = "%PDF-1.7\n";
// The hostile PDF is calibrated on the machine running the test: it must take at least
// MIN_HOSTILE_READ_MS to read in this browser, or it is made heavier (CP8b: a fixed size was
// slow on the dev laptop but read in under a second on GitHub's runner).
const START_HOSTILE_LINES = 250_000;
const MAX_HOSTILE_LINES = 12_000_000;
const MIN_HOSTILE_READ_MS = 2000;
const CALIBRATION_TIMEOUT_MS = 180_000;
const MIN_ENGINE_TIMEOUT_MS = 250;

let session;
const browserRuns = new Map();

before(async () => {
  await use_node_reader();
  session = await open_session();
  for (const name of FIXTURE_NAMES) {
    const password = name === ENCRYPTED ? manifest_password() : undefined;
    const outcome = await run_in_browser(session, fixture_pdf(name), {
      password,
      limits: NO_PAGE_LIMIT,
      include_statement_pages: true,
      processed_at: PROCESSED_AT,
    });
    browserRuns.set(name, outcome);
  }
});

after(async () => {
  await session?.close();
});

/**
 * Bytes that start like a PDF and continue as noise.
 *
 * @param {number} size Total length.
 * @returns {Uint8Array} The bytes.
 */
function pdf_shaped_noise(size) {
  const bytes = new Uint8Array(size).map((_, index) => (index * 7919) % 251);
  bytes.set(new TextEncoder().encode(PDF_HEADER));
  return bytes;
}

test("the engine loads its runtime from local files and reports the load time", () => {
  assert.equal(session.ready.ok, true);
  assert.ok(session.ready.timings.runtime_load_ms > 0);
});

test("on every fixture the browser's statement pages equal the Node reader's, item for item", async () => {
  for (const name of FIXTURE_NAMES) {
    const outcome = browserRuns.get(name);
    assert.equal(typeof outcome.statement_pages_json, "string", name);
    const browserPages = JSON.parse(outcome.statement_pages_json);
    const nodePages = await extract_fixture(name);
    assert.equal(browserPages.pages.length, nodePages.pages.length, name);
    for (const [index, page] of browserPages.pages.entries()) {
      assert.deepEqual(page, nodePages.pages[index], `${name} page ${index + 1}`);
    }
    assert.deepEqual(browserPages, nodePages, name);
  }
});

test("on every fixture the browser's pipeline result equals CPython's", () => {
  const names = FIXTURE_NAMES;
  const envelopes = run_in_cpython(
    names.map((name) => ({
      statement_pages_json: browserRuns.get(name).statement_pages_json,
      processed_at: PROCESSED_AT,
    })),
  );
  for (const [index, name] of names.entries()) {
    const outcome = browserRuns.get(name);
    const envelope = envelopes[index];
    if (envelope.ok) {
      assert.equal(outcome.ok, true, name);
      assert.deepEqual(JSON.parse(outcome.pipeline_result_json), envelope.pipeline_result, name);
    } else {
      assert.equal(outcome.ok, false, name);
      assert.equal(outcome.failure.core_code, envelope.error.code, name);
    }
  }
});

test("a fixture with no rows reads but fails as LAYOUT_UNRECOGNIZED", () => {
  const outcome = browserRuns.get(WITHOUT_ROWS);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.failure.code, "LAYOUT_UNRECOGNIZED");
});

test("a password PDF without its password is PASSWORD_REQUIRED", async () => {
  const outcome = await run_in_browser(session, fixture_pdf(ENCRYPTED));
  assert.equal(outcome.failure.code, "PASSWORD_REQUIRED");
});

test("a password PDF with the wrong password is PASSWORD_INCORRECT", async () => {
  const outcome = await run_in_browser(session, fixture_pdf(ENCRYPTED), { password: "wrong" });
  assert.equal(outcome.failure.code, "PASSWORD_INCORRECT");
});

test("bytes that start like a PDF and are not one are CORRUPT_PDF", async () => {
  const outcome = await run_in_browser(session, pdf_shaped_noise(4096));
  assert.equal(outcome.failure.code, "CORRUPT_PDF");
});

test("bytes that are not a PDF are NOT_A_PDF", async () => {
  const outcome = await run_in_browser(session, new TextEncoder().encode("Example text, no PDF"));
  assert.equal(outcome.failure.code, "NOT_A_PDF");
});

test("a PDF over the desktop byte limit is TOO_LARGE", async () => {
  const outcome = await run_in_browser(session, pdf_shaped_noise(DESKTOP_LIMITS.byteLimit + 1));
  assert.equal(outcome.failure.code, "TOO_LARGE");
});

test("a PDF over the desktop page limit is TOO_MANY_PAGES", async () => {
  const outcome = await run_in_browser(session, fixture_pdf("F-MANY-PAGES"));
  assert.equal(outcome.failure.code, "TOO_MANY_PAGES");
});

test("pandas loads at the analysis step only, and its load time is reported apart", async () => {
  const fresh = await open_session();
  try {
    const stopsEarly = await run_in_browser(fresh, fixture_pdf(WITHOUT_ROWS));
    assert.equal(stopsEarly.timings.pandas_load_ms, null);
    assert.equal(
      fresh.requests.some((request) => request.url.includes("/pandas-")),
      false,
    );
    const analysed = await run_in_browser(fresh, fixture_pdf("F-BASIC"));
    assert.equal(analysed.ok, true);
    assert.ok(analysed.timings.pandas_load_ms > 0);
    assert.ok(analysed.timings.core_ms > 0);
    assert.ok(analysed.timings.read_ms > 0);
    assert.equal(
      fresh.requests.some((request) => request.url.includes("/pandas-")),
      true,
    );
    const again = await run_in_browser(fresh, fixture_pdf("F-BASIC"));
    assert.equal(again.timings.pandas_load_ms, null);
  } finally {
    await fresh.close();
  }
});

test("a hostile PDF times out by terminating the worker, and a fresh one serves the next run", async () => {
  const { hostile, readMs } = await calibrated_hostile_pdf();
  const timeoutMs = Math.max(MIN_ENGINE_TIMEOUT_MS, Math.floor(readMs / 4));
  const started = Date.now();
  const outcome = await run_in_browser(session, hostile, { timeout_ms: timeoutMs });
  const waited = Date.now() - started;
  assert.deepEqual(outcome.failure, { code: "TIMEOUT", stage: "engine" });
  // The engine stopped the read rather than waiting for it to finish.
  assert.ok(waited < readMs * 0.75, `waited ${waited} ms for a ${readMs} ms read`);
  const next = await run_in_browser(session, fixture_pdf("F-BASIC"));
  assert.equal(next.ok, true);
  assert.ok(next.timings.worker_restarts >= 1);
});

/**
 * A hostile PDF that takes at least MIN_HOSTILE_READ_MS to read in this browser, measured by the
 * engine's own read time, made heavier until it does.
 *
 * @returns {Promise<{hostile: Uint8Array, readMs: number}>} The PDF and its measured read time.
 */
async function calibrated_hostile_pdf() {
  let lines = START_HOSTILE_LINES;
  for (;;) {
    const hostile = deflate_bomb_pdf(lines);
    const measured = await run_in_browser(session, hostile, { timeout_ms: CALIBRATION_TIMEOUT_MS });
    const readMs = measured.timings.read_ms;
    if (readMs >= MIN_HOSTILE_READ_MS) return { hostile, readMs };
    assert.ok(lines < MAX_HOSTILE_LINES, `still read in ${readMs} ms at ${lines} lines`);
    const growth = Math.min(8, Math.ceil((MIN_HOSTILE_READ_MS * 1.5) / Math.max(readMs, 50)));
    lines = Math.min(MAX_HOSTILE_LINES, lines * growth);
  }
}

test("a runtime file that fails its checksum stops the engine before it loads", async () => {
  const tampered = await open_session({ corrupt_runtime_file: "pdfjs/pdf.min.mjs" });
  try {
    assert.deepEqual(tampered.ready, {
      ok: false,
      failure: { code: "ENGINE_FAILED", stage: "runtime" },
    });
  } finally {
    await tampered.close();
  }
});

test("the password never reaches the console, a request, or an outcome", async () => {
  const password = manifest_password();
  const outcome = await run_in_browser(session, fixture_pdf(ENCRYPTED), { password });
  assert.equal(outcome.ok, true);
  assert.equal(JSON.stringify(outcome).includes(password), false);
  assert.equal(JSON.stringify([...browserRuns.values()]).includes(password), false);
  assert.equal(session.console_lines.join("\n").includes(password), false);
  assert.equal(
    session.requests.some((request) => request.url.includes(password)),
    false,
  );
});

test("no request but same-origin static GETs, during and after the imports", async () => {
  await new Promise((resolve) => setTimeout(resolve, 2000));
  assert.ok(session.requests.some((request) => request.url.includes("/runtime/")));
  assert.ok(session.requests.some((request) => request.url.includes("pyodide.asm.wasm")));
  assert.deepEqual(other_requests(session), []);
});
