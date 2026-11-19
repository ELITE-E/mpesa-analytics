// CP10a item 2: the browser capability check at app start. Required: module workers,
// WebAssembly, WebCrypto's subtle API and getRandomValues; IndexedDB is optional (without it the
// app runs memory-only). A missing capability is named in plain words, and the copy says the app
// is verified on desktop Chrome and other browsers are untested.
//
// Run from web/:
//   node --import ./tests/support/register.mjs --test tests/capabilities.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

const { checkBrowser } = await import("../src/lib/capabilities.ts");
const copy = await import("../src/content/capabilities.ts");
const { CapabilityNotice } = await import("../src/components/capability-notice.tsx");

/** A Worker constructor that reads `type` from its options, as one supporting module workers does. */
class ModuleWorker {
  constructor(url, options) {
    void options?.type;
    new URL(url);
  }
}

/** A Worker constructor that never looks at its options, as an old browser's does. */
class ClassicWorker {
  constructor(url) {
    new URL(url);
  }
}

/** A browser with everything. */
function fullBrowser(overrides = {}) {
  return {
    Worker: ModuleWorker,
    WebAssembly: { instantiate() {} },
    crypto: { subtle: {}, getRandomValues: () => {} },
    indexedDB: {},
    ...overrides,
  };
}

/** The visible text of rendered HTML. */
function textOf(html) {
  return html.replace(/<[^>]*>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();
}

test("a browser with everything passes, with storage", () => {
  assert.deepEqual(checkBrowser(fullBrowser()), { missing: [], storage: true });
});

test("each required capability, when missing, is named", () => {
  const cases = [
    ["moduleWorker", { Worker: ClassicWorker }],
    ["moduleWorker", { Worker: undefined }],
    ["webAssembly", { WebAssembly: undefined }],
    ["cryptoSubtle", { crypto: { getRandomValues: () => {} } }],
    ["randomValues", { crypto: { subtle: {} } }],
  ];
  for (const [name, overrides] of cases) {
    assert.deepEqual(checkBrowser(fullBrowser(overrides)).missing, [name], name);
  }
  assert.deepEqual(checkBrowser(fullBrowser({ crypto: undefined })).missing, ["cryptoSubtle", "randomValues"]);
});

test("without IndexedDB nothing required is missing, but storage is off: memory-only", () => {
  assert.deepEqual(checkBrowser(fullBrowser({ indexedDB: undefined })), { missing: [], storage: false });
});

test("the check never creates a worker or touches the network", () => {
  let created = 0;
  class CountingWorker {
    constructor(url, options) {
      void options?.type;
      new URL(url);
      created += 1;
    }
  }
  checkBrowser(fullBrowser({ Worker: CountingWorker }));
  assert.equal(created, 0, "the probe URL cannot parse, so no worker is made");
});

test("the notice names every missing capability in plain words and says what is verified", () => {
  const text = textOf(renderToString(createElement(CapabilityNotice, { result: { missing: ["webAssembly", "cryptoSubtle"], storage: true } })));
  assert.ok(text.includes(copy.capabilities.title));
  assert.ok(text.includes(copy.capabilityNames.webAssembly));
  assert.ok(text.includes(copy.capabilityNames.cryptoSubtle));
  assert.equal(text.includes(copy.capabilityNames.moduleWorker), false);
  assert.ok(text.includes(copy.verifiedOn));
  assert.equal(copy.verifiedOn, "Verified on desktop Chrome; other browsers untested.");
});

test("memory-only is said plainly when only storage is missing", () => {
  const text = textOf(renderToString(createElement(CapabilityNotice, { result: { missing: [], storage: false } })));
  assert.ok(text.includes(copy.capabilities.memoryOnly));
  assert.equal(text.includes(copy.capabilities.title), false);
});

test("nothing is shown when everything is there", () => {
  assert.equal(renderToString(createElement(CapabilityNotice, { result: { missing: [], storage: true } })), "");
});

test("the welcome screen says which browser is verified", async () => {
  const { WelcomeHero } = await import("../src/components/welcome/welcome-hero.tsx");
  assert.ok(textOf(renderToString(createElement(WelcomeHero))).includes(copy.verifiedOn));
});
