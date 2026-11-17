// CP8b item 3: there is no login. No route, component, session code or token handling is left,
// and every header that showed an account button now says the statement stays on this device.
//
// Run from web/:
//   node --import ./tests/support/register.mjs --test tests/no-login.test.mjs

import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

const SRC = join(import.meta.dirname, "../src");
const REMOVED = [
  "app/login",
  "components/login",
  "components/account-button.tsx",
  "lib/session.ts",
  "lib/return-path.ts",
  "lib/api-config.ts",
];
const LOGIN_TRACES = [/sessionStorage/, /Authorization/, /Bearer /, /["'`]\/login/, /\blogout\(/, /\blogin\(/];

globalThis.window = { location: new URL("https://app.test/") };

/**
 * Every source file under src/.
 *
 * @param {string} directory Where to start.
 * @returns {string[]} The files' paths.
 */
function source_files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? source_files(join(directory, entry.name))
      : /\.(ts|tsx)$/.test(entry.name)
        ? [join(directory, entry.name)]
        : [],
  );
}

test("the login route, its components and the session code are gone", () => {
  for (const path of REMOVED) assert.equal(existsSync(join(SRC, path)), false, path);
});

test("no source file handles a login, a token or a stored session", () => {
  for (const file of source_files(SRC)) {
    const source = readFileSync(file, "utf8");
    for (const trace of LOGIN_TRACES) assert.equal(trace.test(source), false, `${file}: ${trace}`);
  }
});

test("the private label says the statement stays on this device, with no account action", async () => {
  const { PrivateOnDevice } = await import("../src/components/private-on-device.tsx");
  const html = renderToString(createElement(PrivateOnDevice));
  assert.match(html, /Private on this device/);
  assert.equal(/<button|<a\b/.test(html), false);
});

test("every header that had an account button shows the private label instead", async () => {
  const headers = [
    ["../src/components/app-header.tsx", "AppHeader", {}],
    ["../src/components/story-header.tsx", "StoryHeader", { title: "Overview" }],
    ["../src/components/processing/processing-header.tsx", "ProcessingHeader", {}],
    ["../src/components/layout/desktop-app-bar.tsx", "DesktopAppBar", { navigation: { tabs: "ingest", active: "ingest" } }],
  ];
  for (const [path, name, props] of headers) {
    const imported = await import(path);
    const html = renderToString(createElement(imported[name], props));
    assert.match(html, /Private on this device/, name);
    assert.equal(/Sign (in|out)|Log (in|out)/i.test(html), false, name);
  }
});
