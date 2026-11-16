// Shared by the measurement tools: the synthetic F-LARGE statement, and the memory of Chrome's
// process tree. Linux only: memory is the summed RSS of the tree, read from /proc.
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const REPO = join(import.meta.dirname, "../..");
const FIXTURE = "F-LARGE";
const SAMPLE_INTERVAL_MS = 100;
const PAGE_SIZE_BYTES = 4096;

/**
 * Write F-LARGE with the synthetic generator.
 *
 * Side effects: runs Python and writes files to the directory.
 *
 * @param {string} directory Where to write.
 * @param {string} [rows] Another row count than F-LARGE's 5,700.
 * @returns {Uint8Array} The PDF's bytes.
 * @throws {Error} If the generator fails.
 */
export function generate_large(directory, rows) {
  const python = join(REPO, ".venv/bin/python");
  const generator = join(REPO, "tools/synth/generate.py");
  const rowArguments = rows === undefined ? [] : ["--rows", rows];
  const generatorArguments = [
    generator,
    "--name",
    FIXTURE,
    ...rowArguments,
    "--out-dir",
    directory,
  ];
  const ran = spawnSync(python, generatorArguments, {
    cwd: REPO,
    encoding: "utf8",
  });
  if (ran.status !== 0) throw new Error("generator failed");
  return new Uint8Array(readFileSync(join(directory, `${FIXTURE}.pdf`)));
}

/**
 * Sample the summed RSS of Chrome's process tree until stopped. Playwright starts Chrome as a
 * child of this process, so the tree is everything below it.
 *
 * Side effects: reads /proc on a timer.
 *
 * @returns {{peak: Function, mark: Function, peak_since_mark: Function, stop: Function}} The
 *   highest sum seen overall; `mark` starts a new window and returns the sum at that moment;
 *   `peak_since_mark` gives the highest sum since then; `stop` ends sampling.
 */
export function start_rss_sampler() {
  let peak = 0;
  let windowPeak = 0;
  /**
   * Read the tree's RSS once and raise both peaks.
   *
   * @returns {number} The summed RSS now, in bytes.
   */
  const sample = () => {
    const resident = tree_rss_bytes(process.pid);
    peak = Math.max(peak, resident);
    windowPeak = Math.max(windowPeak, resident);
    return resident;
  };
  const timer = setInterval(sample, SAMPLE_INTERVAL_MS);
  return {
    peak: () => peak,
    mark: () => {
      windowPeak = 0;
      return sample();
    },
    peak_since_mark: () => Math.max(windowPeak, sample()),
    stop: () => clearInterval(timer),
  };
}

/**
 * Sum the RSS of a process's descendants, not counting the process itself.
 *
 * Side effects: reads /proc.
 *
 * @param {number} rootPid The root process.
 * @returns {number} Bytes resident.
 */
function tree_rss_bytes(rootPid) {
  const parents = new Map();
  const resident = new Map();
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    const stat = read_or_null(`/proc/${entry}/stat`);
    const statm = read_or_null(`/proc/${entry}/statm`);
    if (stat === null || statm === null) continue;
    parents.set(Number(entry), Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]));
    resident.set(Number(entry), Number(statm.split(" ")[1]) * PAGE_SIZE_BYTES);
  }
  let total = 0;
  for (const [pid, bytes] of resident) {
    if (descends_from(pid, rootPid, parents)) total += bytes;
  }
  return total;
}

/**
 * Tell whether a process is one of the root's descendants.
 *
 * Side effects: none.
 *
 * @param {number} pid The process.
 * @param {number} rootPid The root.
 * @param {Map<number, number>} parents Each process's parent.
 * @returns {boolean} True if pid is below the root.
 */
function descends_from(pid, rootPid, parents) {
  if (pid === rootPid) return false;
  for (let current = pid; current > 1; current = parents.get(current) ?? 0) {
    if (current === rootPid) return true;
  }
  return false;
}

/**
 * Read a /proc file, which may vanish between listing and reading.
 *
 * Side effects: reads the file.
 *
 * @param {string} path The file.
 * @returns {string|null} Its text, or null if it is gone.
 */
function read_or_null(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}
