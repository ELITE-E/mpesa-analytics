#!/usr/bin/env node
// Checks a deployed site (CP10b item 2) and prints one PASS or FAIL line per check. The only tool
// in this repo that makes network requests, and only to the URL it is given. It prints paths and
// header names, never a response body or a header value.
//
// - headers: every response has the expected headers (web/scripts/host_headers.mjs): the one
//   hash-based CSP, computed from the deployed pages themselves, the shared security headers, the
//   Cache-Control for its path, and no Access-Control-Allow-Origin.
// - app_checksums: every file in the service worker's allow-list (/sw-allow-list.js) matches its
//   SHA-256 integrity, so no host changed or injected anything in a listed file.
// - runtime_checksums: every runtime file matches the runtime's checksum manifest.
// - no_third_party: no response header, redirect or text body names another host (scripts and
//   binaries are covered by the checksums), and the browser requests nothing from another host.
// - no_sitemap: no /sitemap.xml, and no robots.txt pointing at one (private beta).
// - service_worker: in Chrome, the page registers /sw.js and it becomes active.
// - release_checksums, with --sums: every file matches the release's sha256sums.txt.
//
//   node tools/release/check_deployed.mjs https://site.example/ [--sums sha256sums.txt] [--no-browser]
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { chromium } from "playwright-core";

import { chrome_path } from "../browser/browser_session.js";
import { cacheControlFor, sharedHeaders, siteCsp } from "../../web/scripts/host_headers.mjs";
import { servedPath } from "../../web/scripts/sw_allow_list.mjs";

const UNKNOWN_PATH = "/check-deployed-no-such-page";
const PARALLEL_REQUESTS = 8;
const MAX_REDIRECTS = 3;
const MAX_LISTED = 10;
const SERVICE_WORKER_TIMEOUT_MS = 180_000;
const PAGE_LOAD_TIMEOUT_MS = 120_000;
const TEXT_TYPES =
  /^(text\/(html|css|plain|xml)|application\/(json|manifest\+json|xml)|image\/svg\+xml)/;
const SCRIPT_TYPES = /^(text|application)\/javascript/;
const URL_HOST = /\bhttps?:\/\/([^/\s"'<>)\\]+)/g;
const PROTOCOL_RELATIVE = /\b(?:src|href|action)\s*=\s*["']?\/\/([^/\s"'<>]+)/g;
const XML_NAMESPACE = /\bxmlns(?::\w+)?\s*=\s*"[^"]*"/g;
const USAGE = "usage: check_deployed.mjs <site URL> [--sums sha256sums.txt] [--no-browser]";

/**
 * Check a deployed site.
 *
 * Side effects: sends GET requests to the site; with `browser`, opens it in headless Chrome.
 *
 * @param {string} siteUrl The site's address.
 * @param {object} [options] Options.
 * @param {boolean} [options.browser] Check the service worker in Chrome (default true).
 * @param {string|null} [options.sums] A sha256sums.txt file to check every file against.
 * @returns {Promise<{check: string, ok: boolean, line: string}[]>} One entry per check.
 */
export async function checkDeployed(siteUrl, { browser = true, sums = null } = {}) {
  const origin = new URL(siteUrl).origin;
  const site = await fetchSite(origin);
  const visit = browser ? await visitInChrome(origin, site) : null;
  const lines = [
    line("headers", headerProblems(site)),
    line("app_checksums", appChecksumProblems(site)),
    line("runtime_checksums", runtimeChecksumProblems(site)),
    line("no_third_party", [...thirdPartyProblems(site), ...(visit?.foreignRequests ?? [])]),
    line("no_sitemap", sitemapProblems(site)),
  ];
  if (visit) lines.push(line("service_worker", visit.serviceWorkerProblems));
  if (sums) lines.push(line("release_checksums", releaseChecksumProblems(site, sums)));
  return lines;
}

/**
 * Fetch every file the site should serve: its allow-list, the service worker, the runtime's
 * manifest, an unknown path and the sitemap paths.
 *
 * @param {string} origin The site's origin.
 * @returns {Promise<object>} `origin`, `allowList`, `runtime` ({version, files}) and `responses`
 *   (path to response).
 */
async function fetchSite(origin) {
  const responses = new Map();
  /**
   * Fetch paths into `responses`.
   *
   * @param {string[]} paths The paths.
   * @returns {Promise<void>} Resolves when all are fetched.
   */
  const fetchInto = async (paths) => {
    const fetched = await inParallel(paths, (path) => fetchPath(origin, path));
    paths.forEach((path, index) => responses.set(path, fetched[index]));
  };
  await fetchInto(["/sw.js", "/sw-allow-list.js", "/runtime/current.json", UNKNOWN_PATH]);
  await fetchInto(["/sitemap.xml", "/robots.txt"]);
  const allowList = parseAllowList(responses.get("/sw-allow-list.js"));
  const version = parseJson(responses.get("/runtime/current.json"))?.version;
  const manifestPath = `/runtime/${version}/manifest.json`;
  await fetchInto([manifestPath, ...allowList.entries.map((entry) => entry.path)]);
  const runtime = { version, files: parseJson(responses.get(manifestPath))?.files ?? {} };
  return { origin, allowList, runtime, responses };
}

/**
 * Fetch one path, following same-origin redirects, and keep its status, headers and bytes.
 *
 * @param {string} origin The site's origin.
 * @param {string} path The path.
 * @returns {Promise<{status: number, headers: Headers, bytes: Buffer, redirects: string[]}>} The
 *   final response, and every redirect target on the way.
 */
async function fetchPath(origin, path) {
  const redirects = [];
  let url = new URL(path, origin);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await fetch(url, { redirect: "manual" });
    const location = response.headers.get("location");
    if (!location || response.status < 300 || response.status >= 400) {
      return {
        status: response.status,
        headers: response.headers,
        bytes: Buffer.from(await response.arrayBuffer()),
        redirects,
      };
    }
    url = new URL(location, url);
    redirects.push(url.href);
    if (url.origin !== origin) break;
  }
  return { status: 0, headers: new Headers(), bytes: Buffer.alloc(0), redirects };
}

/**
 * Every response's header problems, as "path header-name".
 *
 * @param {object} site From fetchSite.
 * @returns {string[]} Problems.
 */
function headerProblems(site) {
  const pages = [...site.responses].filter(([path]) => isPage(path) || path === UNKNOWN_PATH);
  const csp = siteCsp(pages.map(([, response]) => response.bytes.toString("utf8")));
  const problems = [];
  for (const [path, response] of site.responses) {
    if (response.status !== 200 && path !== UNKNOWN_PATH) continue;
    const expected = new Map(
      sharedHeaders(csp).map(([name, value]) => [name.toLowerCase(), value]),
    );
    if (path !== UNKNOWN_PATH) expected.set("cache-control", cacheControlFor(path));
    for (const [name, value] of expected) {
      if (!sameHeader(name, response.headers.get(name), value)) problems.push(`${path} ${name}`);
    }
    if (response.headers.has("access-control-allow-origin"))
      problems.push(`${path} access-control-allow-origin`);
  }
  return problems;
}

/**
 * Whether a served header equals the expected one; Cache-Control is compared as a set of
 * directives, since a host may repeat one.
 *
 * @param {string} name Lower-case header name.
 * @param {string|null} served The served value.
 * @param {string} expected The expected value.
 * @returns {boolean} Whether they agree.
 */
function sameHeader(name, served, expected) {
  if (served === null) return false;
  if (name !== "cache-control") return served === expected;
  /**
   * A Cache-Control value as its sorted, distinct directives.
   *
   * @param {string} value The value.
   * @returns {string} The directives.
   */
  const directives = (value) =>
    [...new Set(value.split(",").map((part) => part.trim().toLowerCase()))].sort().join(",");
  return directives(served) === directives(expected);
}

/**
 * Allow-listed files that are missing or do not match their integrity.
 *
 * @param {object} site From fetchSite.
 * @returns {string[]} Their paths.
 */
function appChecksumProblems(site) {
  if (site.allowList.entries.length === 0) return ["/sw-allow-list.js"];
  return site.allowList.entries
    .filter(({ path, integrity }) => {
      const response = site.responses.get(path);
      return response.status !== 200 || `sha256-${digest(response.bytes, "base64")}` !== integrity;
    })
    .map(({ path }) => path);
}

/**
 * Runtime files that are missing or do not match the runtime's manifest.
 *
 * @param {object} site From fetchSite.
 * @returns {string[]} Their paths.
 */
function runtimeChecksumProblems(site) {
  const files = Object.entries(site.runtime.files);
  if (files.length === 0) return [`/runtime/${site.runtime.version}/manifest.json`];
  return files
    .map(([file, { sha256 }]) => [`/runtime/${site.runtime.version}/${file}`, sha256])
    .filter(([path, sha256]) => {
      const response = site.responses.get(path);
      return !response || response.status !== 200 || digest(response.bytes, "hex") !== sha256;
    })
    .map(([path]) => path);
}

/**
 * Responses that name another host: in a header, a redirect, or a text body.
 *
 * @param {object} site From fetchSite.
 * @returns {string[]} Problems, as "path where".
 */
function thirdPartyProblems(site) {
  const own = new URL(site.origin).host;
  /**
   * Whether any host is not the site's own.
   *
   * @param {string[]} hosts Hosts.
   * @returns {boolean} Whether one is foreign.
   */
  const foreign = (hosts) => hosts.some((host) => host.toLowerCase() !== own);
  const listed = new Set(site.allowList.entries.map((entry) => entry.path));
  const problems = [];
  for (const [path, response] of site.responses) {
    for (const [name, value] of response.headers) {
      if (foreign(hostsIn(value))) problems.push(`${path} header ${name}`);
    }
    if (foreign(response.redirects.map((href) => new URL(href).host)))
      problems.push(`${path} redirect`);
    if (isScannedText(response, listed.has(path)) && foreign(hostsIn(textOf(response)))) {
      problems.push(`${path} body`);
    }
  }
  return problems;
}

/**
 * Whether a body is scanned for other hosts: text, pages and data always; a script only when the
 * allow-list's checksums do not cover it (the service worker's own two files), since the app's
 * bundles hold inert documentation links that are never requested.
 *
 * @param {object} response The response.
 * @param {boolean} isListed Whether the allow-list covers the path.
 * @returns {boolean} Whether to scan it.
 */
function isScannedText(response, isListed) {
  const type = response.headers.get("content-type") ?? "";
  return TEXT_TYPES.test(type) || (SCRIPT_TYPES.test(type) && !isListed);
}

/**
 * A body as text, with XML namespace declarations removed: they name a URI, not a host to fetch.
 *
 * @param {object} response The response.
 * @returns {string} The text.
 */
function textOf(response) {
  return response.bytes.toString("utf8").replace(XML_NAMESPACE, "");
}

/**
 * The hosts named in a text by absolute or protocol-relative URL.
 *
 * @param {string} text The text.
 * @returns {string[]} Hosts, with ports.
 */
function hostsIn(text) {
  return [...text.matchAll(URL_HOST), ...text.matchAll(PROTOCOL_RELATIVE)].map((match) => match[1]);
}

/**
 * Problems with the private beta's no-sitemap rule.
 *
 * @param {object} site From fetchSite.
 * @returns {string[]} Problems.
 */
function sitemapProblems(site) {
  const problems = [];
  if (site.responses.get("/sitemap.xml").status === 200) problems.push("/sitemap.xml served");
  const robots = site.responses.get("/robots.txt");
  if (robots.status === 200 && /sitemap:/i.test(robots.bytes.toString("utf8")))
    problems.push("/robots.txt names a sitemap");
  return problems;
}

/**
 * Files that differ from the release's sha256sums.txt. The host serves no _headers file, and the 404
 * page is checked as the body of an unknown path.
 *
 * @param {object} site From fetchSite.
 * @param {string} sumsFile The sha256sums.txt file.
 * @returns {string[]} Their paths as listed.
 */
function releaseChecksumProblems(site, sumsFile) {
  const listed = readFileSync(sumsFile, "utf8")
    .trimEnd()
    .split("\n")
    .map((entry) => entry.match(/^([0-9a-f]{64}) {2}(.+)$/));
  if (listed.some((entry) => !entry)) return [`${sumsFile} is not a sha256sum list`];
  return listed
    .filter(([, , file]) => file !== "_headers")
    .filter(([, sha256, file]) => {
      const response = site.responses.get(
        file === "404.html" ? UNKNOWN_PATH : servedPath(`/${file}`),
      );
      return !response || digest(response.bytes, "hex") !== sha256;
    })
    .map(([, , file]) => file);
}

/**
 * Open the site in headless Chrome, wait for its service worker, and record requests to other
 * hosts.
 *
 * Side effects: launches Chrome with a fresh profile and loads the site.
 *
 * @param {string} origin The site's origin.
 * @param {object} site From fetchSite.
 * @returns {Promise<{serviceWorkerProblems: string[], foreignRequests: string[]}>} Problems.
 */
async function visitInChrome(origin, site) {
  if (site.responses.get("/sw.js").status !== 200) {
    return { serviceWorkerProblems: ["/sw.js not served"], foreignRequests: [] };
  }
  const browser = await chromium.launch({ executablePath: chrome_path(), headless: true });
  const foreignRequests = [];
  try {
    const context = await browser.newContext();
    context.on("request", (request) => {
      if (new URL(request.url()).origin !== origin)
        foreignRequests.push(`browser request to ${new URL(request.url()).host}`);
    });
    const page = await context.newPage();
    await page.goto(`${origin}/`, { waitUntil: "load", timeout: PAGE_LOAD_TIMEOUT_MS });
    const scriptUrl = await activeServiceWorker(page);
    const problems = scriptUrl === `${origin}/sw.js` ? [] : ["/sw.js not registered and active"];
    return { serviceWorkerProblems: problems, foreignRequests };
  } finally {
    await browser.close();
  }
}

/**
 * The script URL of the page's active service worker, once it is active.
 *
 * @param {object} page The Playwright page.
 * @returns {Promise<string|null>} The URL, or null if none became active in time.
 */
async function activeServiceWorker(page) {
  return page
    .evaluate(
      (timeoutMs) =>
        Promise.race([
          navigator.serviceWorker.ready.then(
            (registration) => registration.active?.scriptURL ?? null,
          ),
          new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs)),
        ]),
      SERVICE_WORKER_TIMEOUT_MS,
    )
    .catch(() => null);
}

/**
 * One check's entry.
 *
 * @param {string} check The check's name.
 * @param {string[]} problems Its problems; none means PASS.
 * @returns {{check: string, ok: boolean, line: string}} The entry.
 */
function line(check, problems) {
  if (problems.length === 0) return { check, ok: true, line: `PASS ${check}` };
  const shown = problems.slice(0, MAX_LISTED).join("; ");
  const more = problems.length > MAX_LISTED ? ` (and ${problems.length - MAX_LISTED} more)` : "";
  return {
    check,
    ok: false,
    line: `FAIL ${check}: ${problems.length} problem(s): ${shown}${more}`,
  };
}

/**
 * The allow-list the service worker imports, or an empty one if it cannot be read.
 *
 * @param {object} response The /sw-allow-list.js response.
 * @returns {{entries: object[]}} The list.
 */
function parseAllowList(response) {
  const text = response.status === 200 ? response.bytes.toString("utf8") : "";
  const body = text.match(/^self\.SW_ALLOW_LIST = (\{.*\});\s*$/s)?.[1];
  return parseJson({ status: 200, bytes: Buffer.from(body ?? "") }) ?? { entries: [] };
}

/**
 * A response's JSON, or null.
 *
 * @param {object} response The response.
 * @returns {object|null} The parsed body.
 */
function parseJson(response) {
  try {
    return response.status === 200 ? JSON.parse(response.bytes.toString("utf8")) : null;
  } catch {
    return null;
  }
}

/**
 * Whether a served path is a page: its last segment has no file extension.
 *
 * @param {string} path The path.
 * @returns {boolean} Whether it is a page.
 */
function isPage(path) {
  return !path.split("/").at(-1).includes(".") && !path.startsWith("/check-deployed");
}

/**
 * A SHA-256 digest.
 *
 * @param {Buffer} bytes The content.
 * @param {string} encoding "hex" or "base64".
 * @returns {string} The digest.
 */
function digest(bytes, encoding) {
  return createHash("sha256").update(bytes).digest(encoding);
}

/**
 * Run a task for every input, a few at a time.
 *
 * @param {Array} inputs The inputs.
 * @param {Function} task Async function of one input.
 * @returns {Promise<Array>} The outputs, in input order.
 */
async function inParallel(inputs, task) {
  const outputs = new Array(inputs.length);
  let next = 0;
  /**
   * Take inputs one at a time until none are left.
   *
   * @returns {Promise<void>} Resolves when the inputs run out.
   */
  const worker = async () => {
    while (next < inputs.length) {
      const index = next;
      next += 1;
      outputs[index] = await task(inputs[index]);
    }
  };
  await Promise.all(Array.from({ length: PARALLEL_REQUESTS }, worker));
  return outputs;
}

/**
 * Check the site named on the command line and print the lines.
 *
 * Side effects: network requests to that site, Chrome, stdout; exits 0 when every check passes,
 * 1 when one fails, 2 on bad arguments.
 *
 * @returns {Promise<void>} Resolves when done.
 */
async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { sums: { type: "string" }, "no-browser": { type: "boolean", default: false } },
  });
  const url = URL.canParse(positionals[0] ?? "") ? new URL(positionals[0]) : null;
  if (!url || !["http:", "https:"].includes(url.protocol)) {
    console.error(USAGE);
    process.exit(2);
  }
  const lines = await checkDeployed(url.href, {
    browser: !values["no-browser"],
    sums: values.sums ?? null,
  });
  for (const entry of lines) console.log(entry.line);
  const failed = lines.filter((entry) => !entry.ok).length;
  console.log(
    `check_deployed: ${failed ? "FAIL" : "PASS"} (${failed} of ${lines.length} checks failed)`,
  );
  process.exit(failed ? 1 : 0);
}

if (import.meta.main) await main();
