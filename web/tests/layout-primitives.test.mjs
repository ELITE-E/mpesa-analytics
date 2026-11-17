// Contracts of the shared layout primitives ported from the IA prototype in
// Stage 2 of the migration (components/layout/): AnalyticSplit's responsive
// structure, the canvas variants, and that every theme token the primitives
// use is defined in app/globals.css (an undefined token would silently
// produce no CSS).
//
// Run from web-prototype/:
//   node --import ./tests/support/register.mjs --test tests/layout-primitives.test.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

const { AnalyticSplit, PRIMARY_SPAN, INSPECTOR_SPAN } = await import(
  "../src/components/layout/analytic-split.tsx"
);
const { pageCanvas, canvasFrame } = await import("../src/components/layout/canvas.ts");
const { sheetDialogClasses } = await import("../src/components/layout/sheet-dialog.ts");

const GLOBALS_CSS = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");

/** A panel whose content is identifiable in the markup. */
function panel(order, name) {
  return { order, content: createElement("p", { "data-panel": name }, name) };
}

/** The class lists of every element in `html` that wraps a test panel, in DOM order. */
function panelWrappers(html) {
  return [...html.matchAll(/<div class="([^"]*)"><p data-panel="([^"]*)">/g)].map((m) => ({
    name: m[2],
    classes: m[1].split(" "),
  }));
}

/** The class list of the element directly containing the panel named `name`. */
function groupClassesAround(html, name) {
  const at = html.indexOf(`data-panel="${name}"`);
  const opens = [...html.slice(0, at).matchAll(/<div class="([^"]*)">/g)];
  return opens.at(-2)[1].split(" ");
}

describe("AnalyticSplit", () => {
  const html = renderToString(
    createElement(AnalyticSplit, {
      primary: [panel(1, "story"), panel(3, "bridge")],
      inspector: [panel(2, "review"), panel(4, "events")],
      gapClassName: "gap-4",
    }),
  );

  test("each panel takes its mobile order and drops it from 1024px", () => {
    assert.deepEqual(
      panelWrappers(html).map(({ name, classes }) => [name, classes]),
      [
        ["story", ["order-1", "lg:order-none"]],
        ["bridge", ["order-3", "lg:order-none"]],
        ["review", ["order-2", "lg:order-none"]],
        ["events", ["order-4", "lg:order-none"]],
      ],
    );
  });

  test("groups dissolve below 1024px and take the 7/5 → 8/4 spans above it", () => {
    for (const [name, span] of [["story", PRIMARY_SPAN], ["review", INSPECTOR_SPAN]]) {
      const classes = groupClassesAround(html, name);
      assert.ok(classes.includes("contents"), `${name}'s group is display: contents on mobile`);
      for (const spanClass of span.split(" ")) assert.ok(classes.includes(spanClass), `${name}: ${spanClass}`);
    }
    assert.equal(PRIMARY_SPAN, "lg:col-span-7 xl:col-span-8");
    assert.equal(INSPECTOR_SPAN, "lg:col-span-5 xl:col-span-4");
  });

  test("the mobile column uses the caller's gap and becomes a 12-column grid from 1024px", () => {
    const root = html.match(/^<div class="([^"]*)">/)[1].split(" ");
    for (const expected of ["flex", "flex-col", "gap-4", "lg:grid", "lg:grid-cols-12"]) {
      assert.ok(root.includes(expected), expected);
    }
  });
});

describe("canvas", () => {
  test("canvasFrame is pageCanvas without the mobile padding", () => {
    const page = pageCanvas.split(" ");
    const frame = canvasFrame.split(" ");
    assert.deepEqual(page.filter((c) => !frame.includes(c)), ["px-space-base"]);
    assert.deepEqual(frame.filter((c) => !page.includes(c)), []);
  });
});

describe("theme tokens used by the primitives exist", () => {
  const TOKEN_CLASS = /(?:^|:)(?:bg|text|p|px)-((?:space|surface|on|inverse)-[a-z-]+)/;
  const classes = [pageCanvas, canvasFrame, sheetDialogClasses].join(" ").split(" ");
  const tokens = [...new Set(classes.map((c) => c.match(TOKEN_CLASS)?.[1]).filter(Boolean))];

  test("the guarded tokens are exactly the ones the primitives use", () => {
    assert.deepEqual(tokens.sort(), [
      "inverse-surface",
      "on-surface",
      "space-base",
      "space-lg",
      "surface-container-lowest",
    ]);
  });

  for (const token of tokens) {
    test(token, () => {
      const namespace = token.startsWith("space-") ? "spacing" : "color";
      assert.match(GLOBALS_CSS, new RegExp(`--${namespace}-${token}:`));
    });
  }
});
