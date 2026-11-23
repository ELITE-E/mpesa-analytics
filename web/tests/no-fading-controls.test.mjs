// A control that is dimmed while disabled must not animate its opacity when it becomes enabled:
// during the fade its text really is low contrast, and CI's axe audit caught the upload screen's
// Proceed button mid-fade ("color-contrast (serious)"). Opacity changes at once; colours, shadows
// and the press animation may still transition.
//
// Run from web/:
//   node --import ./tests/support/register.mjs --test tests/no-fading-controls.test.mjs

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const SRC = join(import.meta.dirname, "../src");

/** Every .tsx and .ts file under a folder. */
function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sourceFiles(join(directory, entry.name))
      : /\.tsx?$/.test(entry.name)
        ? [join(directory, entry.name)]
        : [],
  );
}

const FADES = /\btransition-(all|opacity)\b/;
const DIMMED = /\bdisabled:opacity-/;

test("no class string that dims a disabled control also animates its opacity", () => {
  const fading = [];
  for (const file of sourceFiles(SRC)) {
    for (const match of readFileSync(file, "utf8").matchAll(/"([^"\n]*)"|`([^`]*)`/g)) {
      const classes = match[1] ?? match[2];
      if (DIMMED.test(classes) && FADES.test(classes)) fading.push(`${file.slice(SRC.length)}: ${classes.slice(0, 60)}`);
    }
  }
  assert.deepEqual(fading, []);
});

test("the upload screen's Proceed button, as rendered, dims at once and never fades", async () => {
  const { createElement } = await import("react");
  const { renderToString } = await import("react-dom/server");
  const { ProceedCallToAction } = await import("../src/components/upload/proceed-call-to-action.tsx");
  const html = renderToString(createElement(ProceedCallToAction, { disabled: true, onProceed() {} }));
  const classes = html.match(/<button[^>]*class="([^"]*)"/)[1];
  assert.match(classes, DIMMED);
  assert.equal(FADES.test(classes), false, classes);
});
