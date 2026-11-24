#!/usr/bin/env node
// The host's headers for the static export (CP10b item 1, ADR 0019), written as a `_headers` file,
// the format both candidate hosts read: Cloudflare Pages and Netlify. Both apply every rule whose
// path matches a request and join the values of a header that two matching rules set, so each
// header here comes from exactly one matching rule:
//
// - "/*" carries everything that is the same on every response: one hash-based CSP (the
//   architecture CSP plus a SHA-256 hash for every inline script in every page; never
//   'unsafe-inline' or 'unsafe-eval'), nosniff, no referrer, a Permissions-Policy that denies the
//   camera, microphone and geolocation, COOP same-origin and, during the private beta, noindex.
// - Every other rule sets Cache-Control only: immutable for files whose names carry their hash
//   (/_next/static, /runtime/<version>), no-cache for pages and every other shipped file.
//
//   node web/scripts/host_headers.mjs --host cloudflare-pages|netlify [--out web/out] [--to DIR]
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { parseArgs } from "node:util";

import { ARCHITECTURE_CSP } from "../harness/serve.js";
import { filesUnder, servedPath } from "./sw_allow_list.mjs";

export const HOSTS = Object.freeze(["cloudflare-pages", "netlify"]);
// While the beta is private, search engines are told not to index any response (CP10b item 8).
export const PRIVATE_BETA = true;
export const NO_CACHE = "no-cache";
export const IMMUTABLE = "public, max-age=31536000, immutable";
const INLINE_SCRIPT = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
const HASHED_PATHS = [/^\/_next\/static\//, /^\/runtime\/[0-9a-f]{16}\//];
const SCRIPT_SRC = "script-src 'self' 'wasm-unsafe-eval'";
// Cloudflare Pages adds this header to every response by default; the app shares nothing across
// origins, so the file detaches it (Netlify neither adds it nor reads the "!" syntax).
const CLOUDFLARE_DETACHED = ["Access-Control-Allow-Origin"];
// Cloudflare Pages' documented limits for a _headers file.
const CLOUDFLARE_MAX_RULES = 100;
const CLOUDFLARE_MAX_LINE = 2000;
const FILE_NAME = "_headers";

/**
 * The rules for a built app on a host.
 *
 * @param {string} outDir The static export (web/out).
 * @param {string} host One of HOSTS.
 * @returns {{path: string, headers: Array<[string, string]>, detached: string[]}[]} The rules,
 *   "/*" first.
 * @throws {Error} If the host is unknown, or the rules exceed Cloudflare Pages' limits.
 */
export function hostRules(outDir, host) {
  if (!HOSTS.includes(host))
    throw new Error(`unknown host: ${host} (expected ${HOSTS.join(" or ")})`);
  const paths = shippedFiles(outDir).map(({ path }) => path);
  const pages = shippedFiles(outDir).filter(({ file }) => file.endsWith(".html"));
  const csp = siteCsp(pages.map(({ file }) => readFileSync(file, "utf8")));
  const rules = [
    {
      path: "/*",
      headers: sharedHeaders(csp),
      detached: host === "cloudflare-pages" ? CLOUDFLARE_DETACHED : [],
    },
    ...cacheRules(paths),
  ];
  if (host === "cloudflare-pages") assertWithinCloudflareLimits(rules);
  return rules;
}

/**
 * The headers every response gets.
 *
 * @param {string} csp The site's CSP, from siteCsp.
 * @returns {Array<[string, string]>} Header names and values.
 */
export function sharedHeaders(csp) {
  return [
    ["Content-Security-Policy", csp],
    ["X-Content-Type-Options", "nosniff"],
    ["Referrer-Policy", "no-referrer"],
    ["Permissions-Policy", "camera=(), microphone=(), geolocation=()"],
    ["Cross-Origin-Opener-Policy", "same-origin"],
    ...(PRIVATE_BETA ? [["X-Robots-Tag", "noindex"]] : []),
  ];
}

/**
 * The site's CSP: the architecture CSP with one SHA-256 hash per distinct inline script across all
 * pages, sorted, added to script-src and nothing else changed.
 *
 * @param {string[]} pageHtml Every page's HTML.
 * @returns {string} The policy.
 */
export function siteCsp(pageHtml) {
  const hashes = new Set();
  for (const html of pageHtml) {
    for (const [, body] of html.matchAll(INLINE_SCRIPT)) {
      hashes.add(`'sha256-${createHash("sha256").update(body).digest("base64")}'`);
    }
  }
  return ARCHITECTURE_CSP.replace(SCRIPT_SRC, [SCRIPT_SRC, ...[...hashes].sort()].join(" "));
}

/**
 * The Cache-Control a served path gets.
 *
 * @param {string} path The served path ("/ledger", "/_next/static/chunks/app.js").
 * @returns {string} IMMUTABLE for a hashed file name, else NO_CACHE.
 */
export function cacheControlFor(path) {
  return HASHED_PATHS.some((pattern) => pattern.test(path)) ? IMMUTABLE : NO_CACHE;
}

/**
 * The rules as a _headers file.
 *
 * @param {object[]} rules From hostRules.
 * @returns {string} The file's text.
 */
export function formatRules(rules) {
  return rules
    .map(({ path, headers, detached }) =>
      [
        path,
        ...detached.map((name) => `  ! ${name}`),
        ...headers.map(([name, value]) => `  ${name}: ${value}`),
      ].join("\n"),
    )
    .join("\n")
    .concat("\n");
}

/**
 * Read a _headers file back into rules.
 *
 * @param {string} text The file's text.
 * @returns {object[]} Rules shaped like hostRules' output.
 */
export function parseRules(text) {
  const rules = [];
  for (const line of text.split("\n").filter((candidate) => candidate.trim())) {
    if (!/^\s/.test(line)) {
      rules.push({ path: line.trim(), headers: [], detached: [] });
      continue;
    }
    const detach = line.trim().match(/^!\s*(\S+)$/);
    if (detach) rules.at(-1).detached.push(detach[1]);
    else
      rules.at(-1).headers.push(
        line
          .trim()
          .split(/:\s*(.*)/s)
          .slice(0, 2),
      );
  }
  return rules;
}

/**
 * A path's headers as the hosts serve them: from every matching rule, a header set by two rules
 * joined with ", " as the hosts join them.
 *
 * @param {object[]} rules The rules.
 * @param {string} path The served path.
 * @returns {Map<string, string>} Lower-case header name to value.
 */
export function resolveHeaders(rules, path) {
  const headers = new Map();
  for (const rule of rules.filter((candidate) => ruleMatches(candidate.path, path))) {
    for (const [name, value] of rule.headers) {
      const key = name.toLowerCase();
      headers.set(key, headers.has(key) ? `${headers.get(key)}, ${value}` : value);
    }
  }
  return headers;
}

/**
 * Write the host's _headers file.
 *
 * Side effects: creates the target folder and writes `_headers` into it.
 *
 * @param {string} outDir The static export.
 * @param {string} host One of HOSTS.
 * @param {string} [targetDir] Where to write; the export itself by default.
 * @returns {string} The file's text.
 * @throws {Error} From hostRules, before anything is written.
 */
export function writeHostHeaders(outDir, host, targetDir = outDir) {
  const text = formatRules(hostRules(outDir, host));
  mkdirSync(targetDir, { recursive: true });
  writeFileSync(join(targetDir, FILE_NAME), text);
  return text;
}

/**
 * Whether a rule's path matches a served path: exactly, or "/prefix/*" for anything below the
 * prefix ("/*" matches every path).
 *
 * @param {string} rulePath The rule's path.
 * @param {string} path The served path.
 * @returns {boolean} Whether the rule applies.
 */
function ruleMatches(rulePath, path) {
  return rulePath.endsWith("/*") ? path.startsWith(rulePath.slice(0, -1)) : rulePath === path;
}

/**
 * Every file the export ships, with the path it is served at.
 *
 * @param {string} outDir The static export.
 * @returns {{file: string, path: string}[]} Files and served paths, the _headers file left out.
 */
function shippedFiles(outDir) {
  return filesUnder(outDir)
    .map((file) => ({ file, path: servedPath(`/${relative(outDir, file).split(sep).join("/")}`) }))
    .filter(({ path }) => path !== `/${FILE_NAME}`);
}

/**
 * The Cache-Control rules, as few as can be without overlap: a folder gets one "/folder/*" rule
 * when everything below it has the same value, else its files and subfolders get their own. The
 * root never gets "/*", which already carries the shared headers.
 *
 * @param {string[]} paths Every served path.
 * @returns {object[]} Rules setting Cache-Control only, sorted by path.
 */
function cacheRules(paths) {
  const valuesBelow = new Map();
  for (const path of paths) {
    for (const folder of foldersOf(path)) {
      valuesBelow.set(folder, new Set([...(valuesBelow.get(folder) ?? []), cacheControlFor(path)]));
    }
  }
  const exact = new Map(paths.map((path) => [path, cacheControlFor(path)]));
  /**
   * Whether one "/folder/*" rule can cover a folder: one value below it, and the page at the
   * folder's own path (if any) has that value too.
   *
   * @param {string} folder The folder's path.
   * @returns {boolean} Whether it is uniform.
   */
  const isUniform = (folder) =>
    valuesBelow.get(folder).size === 1 &&
    (!exact.has(folder) || valuesBelow.get(folder).has(exact.get(folder)));
  const rules = new Map();
  for (const path of paths) {
    const folder = foldersOf(path).find(isUniform);
    const rulePath = folder ? `${folder}/*` : path;
    rules.set(rulePath, cacheControlFor(path));
  }
  return [...rules]
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([path, value]) => ({ path, headers: [["Cache-Control", value]], detached: [] }));
}

/**
 * The folders above a served path, outermost first, the root left out.
 *
 * @param {string} path "/breakdown/cash/x.txt".
 * @returns {string[]} ["/breakdown", "/breakdown/cash"].
 */
function foldersOf(path) {
  const parts = path.split("/").slice(1, -1);
  return parts.map((_, index) => `/${parts.slice(0, index + 1).join("/")}`);
}

/**
 * Refuse rules Cloudflare Pages would not apply.
 *
 * @param {object[]} rules The rules.
 * @returns {void}
 * @throws {Error} With more than 100 rules, or a line over 2,000 characters.
 */
function assertWithinCloudflareLimits(rules) {
  if (rules.length > CLOUDFLARE_MAX_RULES) {
    throw new Error(
      `${rules.length} rules; Cloudflare Pages applies at most ${CLOUDFLARE_MAX_RULES}`,
    );
  }
  const longest = Math.max(
    ...formatRules(rules)
      .split("\n")
      .map((line) => line.length),
  );
  if (longest > CLOUDFLARE_MAX_LINE) {
    throw new Error(
      `a line of ${longest} characters; Cloudflare Pages reads ${CLOUDFLARE_MAX_LINE}`,
    );
  }
}

/**
 * Write the headers from the command line.
 *
 * Side effects: writes `_headers`; exits 2 on an unknown host or a rule over the limits.
 *
 * @returns {void}
 */
function main() {
  const { values } = parseArgs({
    options: {
      host: { type: "string" },
      out: { type: "string", default: join(import.meta.dirname, "..", "out") },
      to: { type: "string" },
    },
  });
  try {
    writeHostHeaders(values.out, values.host, values.to ?? values.out);
  } catch (error) {
    console.error(`host_headers: ${error.message}`);
    process.exit(2);
  }
  console.log(`host_headers: wrote ${FILE_NAME} for ${values.host}`);
}

if (import.meta.main) main();
