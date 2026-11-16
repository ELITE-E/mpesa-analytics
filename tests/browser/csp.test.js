// OQ-08: Pyodide, the wheel, numpy and pandas under the architecture's CSP, in a module worker,
// with no 'unsafe-eval'. A control without 'wasm-unsafe-eval' shows the header is enforced.
import assert from "node:assert/strict";
import { test } from "node:test";

import { ARCHITECTURE_CSP } from "../../web/harness/serve.js";
import {
  fixture_pdf,
  open_session,
  other_requests,
  run_in_browser,
} from "../../tools/browser/browser_session.js";

const EXPECTED_CSP = [
  "default-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self'",
  "connect-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "style-src 'self'",
  "manifest-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

test("the harness server sends the architecture CSP, with no 'unsafe-eval'", async () => {
  assert.equal(ARCHITECTURE_CSP, EXPECTED_CSP);
  assert.equal(/'unsafe-eval'|'unsafe-inline'/.test(ARCHITECTURE_CSP), false);
  const session = await open_session({ wait_ready: false });
  try {
    for (const path of ["/harness/", "/pdf_reader/reader.worker.js"]) {
      const response = await fetch(`${session.origin}${path}`);
      assert.equal(response.headers.get("content-security-policy"), EXPECTED_CSP, path);
    }
  } finally {
    await session.close();
  }
});

test("Pyodide, the wheel, numpy and pandas all run under the CSP with no violation", async () => {
  const session = await open_session();
  try {
    assert.equal(session.ready.ok, true);
    const outcome = await run_in_browser(session, fixture_pdf("F-GOLDEN"));
    assert.equal(outcome.ok, true);
    assert.ok(outcome.timings.pandas_load_ms > 0);
    assert.ok(JSON.parse(outcome.pipeline_result_json).report.cash_flow);
    for (const wheel of ["/numpy-", "/pandas-", "/core/mpesa_core-"]) {
      assert.ok(
        session.requests.some((request) => request.url.includes(wheel)),
        wheel,
      );
    }
    assert.equal(outcome.timings.csp_violations, 0);
    assert.equal(await session.page.evaluate(() => window.harness.csp_violations()), 0);
    assert.deepEqual(
      session.console_lines.filter((line) => /Content Security Policy/i.test(line)),
      [],
    );
    assert.deepEqual(other_requests(session), []);
  } finally {
    await session.close();
  }
});

test("without 'wasm-unsafe-eval' the runtime is refused, so the header is really enforced", async () => {
  const control = ARCHITECTURE_CSP.replace(" 'wasm-unsafe-eval'", "");
  const session = await open_session({ csp: control });
  try {
    assert.deepEqual(session.ready, {
      ok: false,
      failure: { code: "ENGINE_FAILED", stage: "runtime" },
    });
    assert.ok(
      session.console_lines.some((line) => /Content Security Policy|wasm-eval/i.test(line)),
    );
  } finally {
    await session.close();
  }
});
