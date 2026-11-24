// CP10b item 8: each release publishes SHA-256 checksums. tools/release/release_checksums.mjs lists
// every file of the static export in `sha256sum` form (sha256sums.txt) and writes the release notes' checksum block,
// whose release checksum is the SHA-256 of that list.
//
// Needs `npm run build --prefix web` first. Run from the repo:
//   node --test tests/release/release_checksums.test.mjs

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { after, test } from "node:test";

import { releaseNotes, releaseSums } from "../../tools/release/release_checksums.mjs";

const REPO = join(import.meta.dirname, "../..");
const OUT = join(REPO, "web/out");
const scratch = mkdtempSync(join(tmpdir(), "release-sums-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

/**
 * Every file under a directory, relative to it, in POSIX form.
 *
 * @param {string} directory The directory.
 * @returns {string[]} Relative paths.
 */
function filesUnder(directory) {
  const walk = (folder) =>
    readdirSync(folder).flatMap((name) => {
      const path = join(folder, name);
      return statSync(path).isDirectory() ? walk(path) : [path];
    });
  return walk(directory).map((path) => relative(directory, path).split(sep).join("/"));
}

test("sha256sums.txt lists every file of the export once, sorted, with its SHA-256", () => {
  const lines = releaseSums(OUT).trimEnd().split("\n");
  const listed = lines.map((line) => line.match(/^([0-9a-f]{64}) {2}(.+)$/));
  assert.ok(listed.every(Boolean), "every line is '<sha256>  <path>'");
  const paths = listed.map(([, , path]) => path);
  assert.deepEqual(paths, [...filesUnder(OUT)].sort());
  for (const [, digest, path] of listed) {
    assert.equal(
      digest,
      createHash("sha256")
        .update(readFileSync(join(OUT, path)))
        .digest("hex"),
      path,
    );
  }
});

test("the list is the same on every run", () => {
  assert.equal(releaseSums(OUT), releaseSums(OUT));
});

test("the release notes give the version, the release checksum (SHA-256 of sha256sums.txt) and the file count", () => {
  const sums = releaseSums(OUT);
  const notes = releaseNotes(sums, "1.0.0");
  assert.match(notes, /1\.0\.0/);
  assert.ok(notes.includes(createHash("sha256").update(sums).digest("hex")));
  assert.match(notes, new RegExp(`${sums.trimEnd().split("\n").length} files`));
  assert.match(notes, /SHA-256/);
  assert.match(notes, /check_deployed/);
});

test("the command writes sha256sums.txt and the notes into a folder", () => {
  const target = join(scratch, "release");
  execFileSync(process.execPath, [
    join(REPO, "tools/release/release_checksums.mjs"),
    "--out",
    OUT,
    "--to",
    target,
    "--version",
    "1.0.0",
  ]);
  assert.equal(readFileSync(join(target, "sha256sums.txt"), "utf8"), releaseSums(OUT));
  assert.match(readFileSync(join(target, "RELEASE_NOTES.md"), "utf8"), /1\.0\.0/);
});
