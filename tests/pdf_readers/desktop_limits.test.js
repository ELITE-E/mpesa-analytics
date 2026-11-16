import assert from "node:assert/strict";
import { mock, test } from "node:test";

import { create_statement_engine } from "../../pdf_reader/engine_client.js";
import { DESKTOP_LIMITS } from "../../pdf_reader/limits.js";
import {
  DEFAULT_BYTE_LIMIT,
  DEFAULT_PAGE_LIMIT,
  DEFAULT_TIMEOUT_MS,
} from "../../pdf_reader/pdfjs/adapter.js";

const MIB = 1024 * 1024;

/**
 * Let every pending promise callback run. setImmediate is not mocked, and it runs only once the
 * microtask queue is empty, so a whole chain of awaits has settled by then.
 *
 * @returns {Promise<void>} Resolves after the queue drains.
 */
function settle_microtasks() {
  return new Promise((resolve) => setImmediate(resolve));
}

test("the desktop limits are 10 MiB, 300 pages and 600 seconds, as measured on F-LARGE", () => {
  assert.deepEqual(DESKTOP_LIMITS, { byteLimit: 10 * MIB, pageLimit: 300, timeoutMs: 600_000 });
});

test("the desktop limits cannot be changed at run time", () => {
  assert.equal(Object.isFrozen(DESKTOP_LIMITS), true);
});

test("the reader's defaults are the desktop limits", () => {
  assert.equal(DEFAULT_BYTE_LIMIT, DESKTOP_LIMITS.byteLimit);
  assert.equal(DEFAULT_PAGE_LIMIT, DESKTOP_LIMITS.pageLimit);
  assert.equal(DEFAULT_TIMEOUT_MS, DESKTOP_LIMITS.timeoutMs);
});

test("the engine times a run out at the desktop timeout by default", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const worker = {
      onmessage: null,
      postMessage(message) {
        if (message.type === "start") {
          // eslint-disable-next-line id-denylist -- a MessageEvent names this field.
          queueMicrotask(() => worker.onmessage({ data: { type: "ready", timings: {} } }));
        }
      },
      terminate() {},
    };
    const engine = create_statement_engine({ create_worker: () => worker, runtime_url: "/r/" });
    await engine.ready();
    let settled = null;
    const running = engine.run({ pdf_bytes: new Uint8Array(8) }).then((outcome) => {
      settled = outcome;
    });
    await settle_microtasks();
    mock.timers.tick(DESKTOP_LIMITS.timeoutMs - 1);
    await settle_microtasks();
    assert.equal(settled, null, "timed out before the desktop timeout");
    mock.timers.tick(1);
    await settle_microtasks();
    assert.equal(settled?.failure.code, "TIMEOUT", "no timeout at the desktop timeout");
    await running;
    engine.close();
  } finally {
    mock.timers.reset();
  }
});
