// The service worker's allow-list (CP10a item 4): every file the static export ships, with its
// SHA-256 integrity hash, for public/sw.js to precache and serve. The app shell's hashes are taken
// here from the built files; the runtime's and the wheel's come from the runtime's own checksum
// manifest, and each file must match it. Written to out/sw-allow-list.js by postbuild.mjs.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { APP_NAME } from "../src/content/brand.ts";

// Files the host or the worker owns, never cached: the CSP headers, the 404 page served for unknown
// paths, and the worker's own two files (the browser checks those for updates itself).
const NOT_LISTED = new Set(["/_headers", "/404.html", "/sw.js", "/sw-allow-list.js"]);
// Files whose names change whenever their bytes do, so the cache can serve them first.
const HASHED_PREFIXES = ["/_next/static/"];
const RUNTIME = "/runtime/";
const VERSION_LENGTH = 16;
// The worker's caches are named after the app (content/brand.ts): "tallydesk-<version>".
const CACHE_PREFIX = `${APP_NAME.toLowerCase()}-`;

/**
 * The allow-list for a built app.
 *
 * @param {string} outDir The static export (web/out).
 * @returns {{version: string, cachePrefix: string, entries: {path: string, kind: string,
 *   integrity: string}[]}} The prefix of the worker's cache names, from the app's name, and every
 *   shipped file by the path it is served at ("/upload" for upload.html, "/" for index.html), as
 *   "hashed" (cache-first) or "page" (network-first), with its integrity; the version is a digest
 *   of the whole list, so any change to any file is a new version.
 * @throws {Error} If a runtime file's bytes do not match the runtime's manifest.
 */
export function buildAllowList(outDir) {
  const runtimeHashes = runtimeManifestHashes(outDir);
  const entries = filesUnder(outDir)
    .map((file) => ({
      file,
      servedAt: servedPath(`/${relative(outDir, file).split(sep).join("/")}`),
    }))
    .filter(({ servedAt }) => !NOT_LISTED.has(servedAt))
    .map(({ file, servedAt }) => entryFor(file, servedAt, runtimeHashes))
    .sort((first, second) => first.path.localeCompare(second.path));
  const version = createHash("sha256")
    .update(JSON.stringify(entries))
    .digest("hex")
    .slice(0, VERSION_LENGTH);
  return { version, cachePrefix: CACHE_PREFIX, entries };
}

/**
 * The allow-list as the script the service worker imports.
 *
 * @param {object} list From buildAllowList.
 * @returns {string} JavaScript setting `self.SW_ALLOW_LIST`.
 */
export function allowListScript(list) {
  return `self.SW_ALLOW_LIST = ${JSON.stringify(list)};\n`;
}

/**
 * One file's entry.
 *
 * @param {string} file The file on disk.
 * @param {string} path The path it is served at.
 * @param {Map<string, string>} runtimeHashes Runtime path to its manifest's hex digest.
 * @returns {{path: string, kind: string, integrity: string}} The entry.
 * @throws {Error} If a runtime file does not match its manifest.
 */
function entryFor(file, path, runtimeHashes) {
  const bytes = readFileSync(file);
  const digest = createHash("sha256").update(bytes);
  const hex = digest.copy().digest("hex");
  const expected = runtimeHashes.get(path);
  if (expected !== undefined && expected !== hex)
    throw new Error(`runtime file does not match its manifest: ${path}`);
  const isVersionedRuntime = path.startsWith(RUNTIME) && path !== `${RUNTIME}current.json`;
  const isHashed = isVersionedRuntime || HASHED_PREFIXES.some((prefix) => path.startsWith(prefix));
  return {
    path,
    kind: isHashed ? "hashed" : "page",
    integrity: `sha256-${digest.digest("base64")}`,
  };
}

/**
 * The runtime's checksum manifest: each listed file's served path and hex SHA-256.
 *
 * @param {string} outDir The static export.
 * @returns {Map<string, string>} Path to digest; empty without a runtime.
 */
function runtimeManifestHashes(outDir) {
  const hashes = new Map();
  const runtimeDir = join(outDir, "runtime");
  for (const version of safeList(runtimeDir)) {
    const manifestFile = join(runtimeDir, version, "manifest.json");
    if (!statSync(join(runtimeDir, version)).isDirectory()) continue;
    const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
    for (const [path, { sha256 }] of Object.entries(manifest.files))
      hashes.set(`${RUNTIME}${version}/${path}`, sha256);
  }
  return hashes;
}

/**
 * The path a built file is served at: pages without ".html", the home page at "/".
 *
 * @param {string} filePath The file's path inside out/, from "/".
 * @returns {string} The served path.
 */
export function servedPath(filePath) {
  if (filePath === "/index.html") return "/";
  if (filePath === "/404.html") return filePath;
  return filePath.endsWith(".html") ? filePath.slice(0, -".html".length) : filePath;
}

/**
 * Every file under a folder.
 *
 * @param {string} directory The folder.
 * @returns {string[]} Their paths.
 */
export function filesUnder(directory) {
  return safeList(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

/**
 * A folder's entries, or none when it does not exist.
 *
 * @param {string} directory The folder.
 * @returns {string[]} Names.
 */
function safeList(directory) {
  try {
    return readdirSync(directory);
  } catch {
    return [];
  }
}
