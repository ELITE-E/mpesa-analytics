// Contracts of the responsive application shell (IA migration Stage 3,
// components/layout/{page-shell,desktop-app-bar,desktop-footer}) that hold
// without a browser: the desktop app bar offers exactly the mobile tab bar's
// destinations, the footer states only supported facts with the current
// year, and PageShell leaves out the desktop shell where a screen has no
// navigation. Visibility per breakpoint is covered by app-shell-browser.
//
// Run from web-prototype/:
//   node --import ./tests/support/register.mjs --test tests/app-shell.test.mjs

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

// Browser globals the client modules touch, set before the app is imported.
process.env.NEXT_PUBLIC_API_BASE_URL = "https://api.app.test";
globalThis.window = {
  sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  location: new URL("https://app.test/"),
};

const { BottomNav } = await import("../src/components/bottom-nav.tsx");
const { DesktopAppBar } = await import("../src/components/layout/desktop-app-bar.tsx");
const { DesktopFooter } = await import("../src/components/layout/desktop-footer.tsx");
const { PageShell } = await import("../src/components/layout/page-shell.tsx");

/** Each link in `html` as { href, text, current }, in DOM order. */
function links(html) {
  return [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map(([, attributes, inner]) => ({
    href: attributes.match(/href="([^"]*)"/)?.[1],
    text: inner.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(),
    current: attributes.includes('aria-current="page"'),
  }));
}

/** The links inside the first <nav> of `html`. */
function navLinks(html) {
  return links(html.match(/<nav\b[\s\S]*?<\/nav>/)[0]);
}

describe("DesktopAppBar", () => {
  test("offers the mobile tab bar's destinations and marks the same tab current", () => {
    const mobile = navLinks(renderToString(createElement(BottomNav, { active: "ingest" })));
    const desktop = navLinks(renderToString(createElement(DesktopAppBar, { navigation: { tabs: "ingest", active: "ingest" } })));
    // The mobile tab text also contains its icon's ligature name.
    assert.deepEqual(
      desktop.map(({ href, text, current }) => ({ href, current, label: text })),
      mobile.map(({ href, text, current }) => ({ href, current, label: text.split(" ").at(-1) })),
    );
    assert.deepEqual(desktop.map((link) => link.href), ["/upload", "/ledger", "/breakdown/fees"]);
  });

  test("marks no tab current when the screen is not a tab (login)", () => {
    const desktop = navLinks(renderToString(createElement(DesktopAppBar, { navigation: { tabs: "ingest" } })));
    assert.deepEqual(desktop.filter((link) => link.current), []);
  });

  test("says the statement stays on this device, with no account control (CP8b)", () => {
    const html = renderToString(createElement(DesktopAppBar, { navigation: { tabs: "ingest", active: "ingest" } }));
    assert.match(html.replace(/<[^>]*>/g, " "), /Private on this device/);
    assert.doesNotMatch(html, /aria-label="Sign in"/);
  });
});

describe("DesktopFooter", () => {
  test("states the brand, what the app does, privacy and the current year", () => {
    const text = renderToString(createElement(DesktopFooter)).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
    for (const expected of ["Sovereign Ledger", "M-Pesa statement analysis", "Private on this device", `© ${new Date().getFullYear()} Sovereign Ledger`]) {
      assert.ok(text.toLowerCase().includes(expected.toLowerCase()), `footer lacks "${expected}"`);
    }
    for (const unsupported of [/institutional/i, /reconcil/i, /hash/i, /aes/i, /encrypt/i, /audit/i]) {
      assert.doesNotMatch(text, unsupported);
    }
  });

  test("says the app is not affiliated with Safaricom (CP10b item 8)", () => {
    const text = renderToString(createElement(DesktopFooter)).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
    assert.match(text, /not affiliated with Safaricom/i);
  });
});

describe("PageShell", () => {
  const content = createElement("p", null, "page content");
  const header = createElement("header", { "data-shell": "mobile-header" });
  const nav = createElement("nav", { "data-shell": "mobile-nav" });

  test("frames a navigable screen: mobile header, desktop bar, main, footer, mobile tab bar", () => {
    const html = renderToString(
      createElement(PageShell, { header, nav, desktop: { tabs: "ingest", active: "ingest" }, mainClassName: "pt-16 pb-20" }, content),
    );
    const order = [...html.matchAll(/<(header|nav|main|footer)\b([^>]*)>/g)]
      .map(([, tag, attributes]) => attributes.match(/data-shell="([^"]*)"/)?.[1] ?? tag)
      .filter((part) => part !== "nav"); // the desktop bar's own <nav>
    assert.deepEqual(order, ["mobile-header", "header", "main", "footer", "mobile-nav"]);
    assert.match(html, /<main class="pt-16 pb-20 lg:pb-0">/);
  });

  test("leaves out the desktop bar and footer where the screen has no navigation", () => {
    const html = renderToString(createElement(PageShell, { header, desktop: null, mainClassName: "pt-16" }, content));
    assert.deepEqual([...html.matchAll(/<(header|nav|footer)\b/g)].map((m) => m[1]), ["header"]);
  });
});
