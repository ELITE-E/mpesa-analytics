#!/usr/bin/env node
// The release's checksums (CP10b item 8): sha256sums.txt lists every file of the static export with
// its SHA-256, in `sha256sum` form, and the release notes publish the release checksum, the
// SHA-256 of that list. The release workflow attaches sha256sums.txt to the GitHub release;
// tools/release/check_deployed.mjs --sums checks a deployed site against it.
//   node tools/release/release_checksums.mjs [--out web/out] --to DIR [--version X.Y.Z]
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { parseArgs } from "node:util";

const REPO = join(import.meta.dirname, "../..");

/**
 * Every file of a static export with its SHA-256, sorted by path.
 *
 * @param {string} outDir The static export.
 * @returns {string} Lines of "<hex sha256>  <path relative to outDir>", newline-terminated.
 */
export function releaseSums(outDir) {
  return filesUnder(outDir)
    .map((file) => relative(outDir, file).split(sep).join("/"))
    .sort()
    .map((path) => `${sha256Hex(readFileSync(join(outDir, path)))}  ${path}\n`)
    .join("");
}

/**
 * The checksum block of the release notes.
 *
 * @param {string} sums sha256sums.txt, from releaseSums.
 * @param {string} version The release's version.
 * @returns {string} Markdown.
 */
export function releaseNotes(sums, version) {
  const count = sums.trimEnd().split("\n").length;
  return [
    `## Version ${version}: checksums`,
    "",
    `Release checksum (SHA-256 of the attached sha256sums.txt): \`${sha256Hex(sums)}\``,
    "",
    `sha256sums.txt lists ${count} files: every file of the static export, as deployed.`,
    "To check the deployed site against it:",
    "",
    "    sha256sum sha256sums.txt",
    "    node tools/release/check_deployed.mjs <site URL> --sums sha256sums.txt",
    "",
  ].join("\n");
}

/**
 * A file's SHA-256 as hex.
 *
 * @param {Buffer|string} bytes The content.
 * @returns {string} 64 hex digits.
 */
function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Every file under a folder.
 *
 * @param {string} directory The folder.
 * @returns {string[]} Their paths.
 */
function filesUnder(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

/**
 * Write sha256sums.txt and RELEASE_NOTES.md from the command line.
 *
 * Side effects: creates the target folder and writes both files into it.
 *
 * @returns {void}
 */
function main() {
  const { values } = parseArgs({
    options: {
      out: { type: "string", default: join(REPO, "web/out") },
      to: { type: "string" },
      version: { type: "string" },
    },
  });
  if (!values.to) {
    console.error("usage: release_checksums.mjs [--out web/out] --to DIR [--version X.Y.Z]");
    process.exit(2);
  }
  const version =
    values.version ?? JSON.parse(readFileSync(join(REPO, "web/package.json"), "utf8")).version;
  const sums = releaseSums(values.out);
  mkdirSync(values.to, { recursive: true });
  writeFileSync(join(values.to, "sha256sums.txt"), sums);
  writeFileSync(join(values.to, "RELEASE_NOTES.md"), releaseNotes(sums, version));
  console.log(`release_checksums: ${sums.trimEnd().split("\n").length} files, ${sha256Hex(sums)}`);
}

if (import.meta.main) main();
