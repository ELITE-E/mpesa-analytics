// Writes the owner's real-statement outputs safely: only outside the repo, readable by the owner
// alone. Shared by the tools that open a real statement on the owner's machine.
import {
  closeSync,
  fchmodSync,
  mkdirSync,
  openSync,
  readlinkSync,
  realpathSync,
  writeSync,
} from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";

import { REPO } from "./fixture_reader.js";

const OWNER_ONLY = 0o600;
const OWNER_ONLY_DIRECTORY = 0o700;

/**
 * Create an output directory only the owner can enter. It must not exist yet, so nothing in it
 * is overwritten and no looser permissions are inherited.
 *
 * Side effects: creates the directory and sets its mode.
 *
 * @param {string} directory The directory to create.
 * @throws {Error} If it already exists or cannot be created.
 */
export function make_owner_only_directory(directory) {
  mkdirSync(directory, { mode: OWNER_ONLY_DIRECTORY });
  chmod_directory(directory);
}

/**
 * Tell whether a path lands inside this repo, following links.
 *
 * Side effects: reads the filesystem.
 *
 * @param {string} outPath The output path.
 * @returns {boolean} True if the file would be written inside the repo.
 */
export function is_inside_repo(outPath) {
  const repo = realpathSync(REPO);
  const landing = landing_path(resolve(outPath));
  return landing === repo || landing.startsWith(repo + sep);
}

/**
 * Work out where a path really writes, including through a link whose target does not exist yet.
 *
 * Side effects: reads the filesystem.
 *
 * @param {string} absolutePath An absolute path.
 * @returns {string} The path with every link resolved.
 */
function landing_path(absolutePath) {
  try {
    return realpathSync(absolutePath);
  } catch {
    return resolve_dangling_link(absolutePath);
  }
}

/**
 * Resolve a path that does not exist yet: its directory, or a link's own target.
 *
 * Side effects: reads the filesystem.
 *
 * @param {string} absolutePath An absolute path that cannot be resolved directly.
 * @returns {string} The path it would write to.
 */
function resolve_dangling_link(absolutePath) {
  const link = read_link_target(absolutePath);
  if (link !== null) return landing_path(resolve(dirname(absolutePath), link));
  const parent = dirname(absolutePath);
  if (parent === absolutePath) return absolutePath;
  return join(landing_path(parent), basename(absolutePath));
}

/**
 * Read where a link points.
 *
 * Side effects: reads the filesystem.
 *
 * @param {string} path The path.
 * @returns {string|null} The link's target, or null if the path is not a link.
 */
function read_link_target(path) {
  try {
    return readlinkSync(path);
  } catch {
    return null;
  }
}

/**
 * Write a file only its owner can read. Permissions tighten before any text is written.
 *
 * Side effects: creates or replaces the file.
 *
 * @param {string} outPath The output path.
 * @param {string} text The file's text.
 */
export function write_owner_only(outPath, text) {
  const descriptor = openSync(outPath, "w", OWNER_ONLY);
  try {
    fchmodSync(descriptor, OWNER_ONLY);
    writeSync(descriptor, text);
  } finally {
    closeSync(descriptor);
  }
}

/**
 * Set a directory's mode to owner-only, whatever the umask did.
 *
 * Side effects: changes the directory's mode.
 *
 * @param {string} directory The directory.
 */
function chmod_directory(directory) {
  const descriptor = openSync(directory, "r");
  try {
    fchmodSync(descriptor, OWNER_ONLY_DIRECTORY);
  } finally {
    closeSync(descriptor);
  }
}
