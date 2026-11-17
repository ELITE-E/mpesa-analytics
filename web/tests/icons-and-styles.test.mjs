// CP8b item 1: icons are inline SVG from the Material Symbols pack (no icon font, no request), and
// no component sets a style attribute, which the CSP's style-src 'self' would block in the
// pre-rendered HTML. Needs `npm run icons` (part of `npm run build`).
//
// Run from web/:
//   node --import ./tests/support/register.mjs --test tests/icons-and-styles.test.mjs

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

const SRC = join(import.meta.dirname, "../src");
const { ICON_PATHS } = await import("../src/components/icon-paths.ts");
const { EXTRA_ICONS } = await import("../src/components/icon-extra.ts");
const { Icon } = await import("../src/components/icon.tsx");

/**
 * Every .ts and .tsx file under a directory.
 *
 * @param {string} directory Where to start.
 * @returns {string[]} The files' paths.
 */
function source_files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? source_files(join(directory, entry.name))
      : /\.(ts|tsx)$/.test(entry.name) && entry.name !== "icon-paths.ts"
        ? [join(directory, entry.name)]
        : [],
  );
}

const SOURCES = source_files(SRC).map((file) => [file, readFileSync(file, "utf8")]);

test("every icon a component names has a generated SVG path", () => {
  const named = new Set();
  for (const [, source] of SOURCES) {
    for (const [, name] of source.matchAll(/<Icon name="([a-z0-9_]+)"/g)) named.add(name);
    for (const [, name] of source.matchAll(/\bicon:\s*"([a-z0-9_]+)"/g)) named.add(name);
  }
  assert.ok(named.size > 30);
  for (const name of named) assert.ok(name in ICON_PATHS || name in EXTRA_ICONS, name);
});

test("an icon renders as an inline SVG at its size, with no style attribute", () => {
  const html = renderToString(createElement(Icon, { name: "lock", size: 18 }));
  assert.match(html, /^<svg[^>]*width="18"[^>]*height="18"/);
  assert.match(html, /aria-hidden="true"/);
  assert.equal(html.includes("style="), false);
  const filled = renderToString(createElement(Icon, { name: "lock", size: 18, filled: true }));
  assert.notEqual(filled, html);
});

test("no component sets a style attribute", () => {
  for (const [file, source] of SOURCES) assert.equal(/\bstyle=\{/.test(source), false, file);
});
