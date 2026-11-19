#!/usr/bin/env node
// After `next build` (static export): ships the statement engine with the app, drops what must not
// ship, and writes each page's CSP. Next writes inline scripts into every page, so each page's
// script-src gets one SHA-256 hash per inline script; it never gets 'unsafe-inline' or
// 'unsafe-eval' (CP8b item 1, ADR 0015). The policies go to out/_headers, one block per path.
//   node scripts/postbuild.mjs
import { createHash } from "node:crypto";
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { ARCHITECTURE_CSP } from "../harness/serve.js";
import { allowListScript, buildAllowList } from "./sw_allow_list.mjs";

const WEB = join(import.meta.dirname, "..");
const OUT = join(WEB, "out");
const ENGINE = join(WEB, "../pdf_reader");
const INLINE_SCRIPT = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
// Files served beside the pages; they run no inline script, so the plain policy covers them.
const ASSET_PATTERNS = [
  "/_next/*",
  "/runtime/*",
  "/pdf_reader/*",
  "/sw.js",
  "/sw-allow-list.js",
  "/manifest.webmanifest",
];

main();

/**
 * Ship the engine, drop dev-only files, and write the headers.
 *
 * Side effects: writes and deletes inside out/; exits if the runtime was not built.
 */
function main() {
  if (!existsSync(join(OUT, "runtime", "current.json"))) {
    console.error("postbuild: the runtime is missing; run tools/vendor.py runtime first");
    process.exit(1);
  }
  // public/vendor holds dev-only files (the Node build of pdf.js, test wheels); never shipped.
  rmSync(join(OUT, "vendor"), { recursive: true, force: true });
  cpSync(ENGINE, join(OUT, "pdf_reader"), {
    recursive: true,
    filter: (source) => !source.includes(`${sep}.`) && !source.endsWith(".gitkeep"),
  });
  // The service worker's allow-list, from every shipped file's checksum (CP10a item 4); written
  // after the engine is copied in, so pdf_reader/ is listed too.
  writeFileSync(join(OUT, "sw-allow-list.js"), allowListScript(buildAllowList(OUT)));
  const blocks = [
    ...page_routes().map(([route, file]) => [route, page_csp(file)]),
    ...ASSET_PATTERNS.map((pattern) => [pattern, ARCHITECTURE_CSP]),
  ];
  writeFileSync(
    join(OUT, "_headers"),
    blocks.map(([path, csp]) => `${path}\n  Content-Security-Policy: ${csp}\n`).join(""),
  );
  console.log(`postbuild: ${blocks.length} header blocks`);
}

/**
 * The route a built page is served at: "/" for the home page, "/ledger" for ledger.html, and the
 * 404 page under its own name.
 *
 * @param {string} path The page's path inside out/, from "/".
 * @returns {string} Its route.
 */
function route_of(path) {
  if (path === "/index.html") return "/";
  if (path === "/404.html") return path;
  return path.slice(0, -".html".length);
}

/**
 * Every built page and the path it is served at.
 *
 * @returns {Array<[string, string]>} Route ("/overview", "/", "/404.html") and file path.
 */
function page_routes() {
  const routes = [];
  for (const file of html_files(OUT)) {
    const path = `/${relative(OUT, file).split(sep).join("/")}`;
    routes.push([route_of(path), file]);
  }
  return routes.sort(([first], [second]) => first.localeCompare(second));
}

/**
 * The architecture CSP for one page, with a hash for each of its inline scripts.
 *
 * @param {string} file The page's HTML file.
 * @returns {string} The policy.
 */
function page_csp(file) {
  const hashes = new Set();
  for (const [, body] of readFileSync(file, "utf8").matchAll(INLINE_SCRIPT)) {
    hashes.add(`'sha256-${createHash("sha256").update(body).digest("base64")}'`);
  }
  return ARCHITECTURE_CSP.replace(
    "script-src 'self' 'wasm-unsafe-eval'",
    ["script-src 'self' 'wasm-unsafe-eval'", ...hashes].join(" "),
  );
}

/**
 * Every HTML file under a directory, the engine's and the runtime's folders left out.
 *
 * @param {string} directory Where to start.
 * @returns {string[]} The files' paths.
 */
function html_files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return ["runtime", "pdf_reader", "_next"].includes(entry.name) ? [] : html_files(path);
    }
    return entry.name.endsWith(".html") ? [path] : [];
  });
}
