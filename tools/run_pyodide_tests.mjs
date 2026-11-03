#!/usr/bin/env node
// Runs tests/core under the pinned Pyodide, against the built wheel. Run tools/vendor.py first.
//   node tools/run_pyodide_tests.mjs [--wheel dist/x.whl] [--tests tests/core]
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const indexURL = join(repo, "web/public/vendor/pyodide") + sep;
const TEST_ROOT = "/testroot";
const FAILURE = 1;

const RUN_TESTS = `
import pathlib
import sys

import pytest

import mpesa_core


class Counts:
    collected = 0
    skipped = 0

    def pytest_collection_modifyitems(self, items):
        Counts.collected = len(items)

    def pytest_runtest_logreport(self, report):
        Counts.skipped += report.skipped


exit_code = int(
    pytest.main(
        [test_dir, "-q", "-p", "no:cacheprovider", "--import-mode=importlib",
         "--rootdir", test_root],
        plugins=[Counts()],
    )
)
core_source = "wheel" if "site-packages" in pathlib.Path(mpesa_core.__file__).parts else "other"
python_version = sys.version.split()[0]
tests_collected = Counts.collected
tests_skipped = Counts.skipped
`;

process.exit(await main());

/**
 * Install the wheel, copy the tests in and run them with pytest.
 *
 * Side effects: reads the wheel and tests, and writes the outcome to stdout.
 *
 * @returns {Promise<number>} Process exit code.
 */
async function main() {
  const wheelPath = argumentValue("--wheel") ?? newestWheel();
  const testDir = resolve(argumentValue("--tests") ?? join(repo, "tests/core"));
  if (!wheelPath || !existsSync(wheelPath) || !existsSync(testDir)) {
    console.log("run_pyodide_tests: FAIL (wheel or tests not found; run uv build --wheel)");
    return FAILURE;
  }
  const { loadPyodide } = await import(pathToFileURL(join(indexURL, "pyodide.mjs")));
  const pyodide = await loadPyodide({ indexURL });
  await pyodide.loadPackage("pytest", { messageCallback: () => {} });
  // Pyodide rejects a Node Buffer here, so hand it a plain typed array.
  const extractDir = pyodide.runPython("import site; site.getsitepackages()[0]");
  pyodide.unpackArchive(new Uint8Array(readFileSync(wheelPath)), "wheel", { extractDir });
  copyTests(pyodide, testDir);
  pyodide.globals.set("test_dir", `${TEST_ROOT}/${basename(testDir)}`);
  pyodide.globals.set("test_root", TEST_ROOT);
  pyodide.runPython(RUN_TESTS);
  return report(pyodide);
}

/**
 * Print the summary line and work out the exit code.
 *
 * Side effects: writes to stdout.
 *
 * @param {object} pyodide Pyodide instance that ran the tests.
 * @returns {number} Pytest's exit code.
 */
function report(pyodide) {
  const exitCode = pyodide.globals.get("exit_code");
  const fields = [
    `pyodide=${pyodide.version}`,
    `python=${pyodide.globals.get("python_version")}`,
    `core=${pyodide.globals.get("core_source")}`,
    `tests=${pyodide.globals.get("tests_collected")}`,
    `skipped=${pyodide.globals.get("tests_skipped")}`,
  ];
  console.log(`run_pyodide_tests: ${exitCode === 0 ? "PASS" : "FAIL"} (${fields.join(" ")})`);
  return exitCode;
}

/**
 * Copy the test directory, plus the skip policy beside it, into Pyodide's filesystem.
 *
 * Side effects: reads test files and writes to Pyodide's filesystem.
 *
 * @param {object} pyodide Loaded Pyodide instance.
 * @param {string} testDir Absolute path of the test directory.
 */
function copyTests(pyodide, testDir) {
  const policyDir = dirname(testDir);
  for (const name of ["conftest.py", "skip_allowlist.toml"]) {
    writeInto(pyodide, join(policyDir, name), `${TEST_ROOT}/${name}`);
  }
  for (const entry of readdirSync(testDir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".py")) continue;
    const source = join(entry.parentPath, entry.name);
    const rel = relative(testDir, source).split(sep).join("/");
    writeInto(pyodide, source, `${TEST_ROOT}/${basename(testDir)}/${rel}`);
  }
}

/**
 * Copy one file into Pyodide's filesystem.
 *
 * Side effects: reads the file and writes to Pyodide's filesystem.
 *
 * @param {object} pyodide Loaded Pyodide instance.
 * @param {string} source Path on the host.
 * @param {string} target Path inside Pyodide.
 */
function writeInto(pyodide, source, target) {
  pyodide.FS.mkdirTree(target.slice(0, target.lastIndexOf("/")));
  pyodide.FS.writeFile(target, readFileSync(source));
}

/**
 * Read a command-line option's value.
 *
 * Side effects: none.
 *
 * @param {string} name Option name.
 * @returns {string|undefined} The value, if the option was given.
 */
function argumentValue(name) {
  const position = process.argv.indexOf(name);
  return position > 0 ? process.argv[position + 1] : undefined;
}

/**
 * Find the wheel that `uv build --wheel` left in dist/.
 *
 * Side effects: reads the directory.
 *
 * @returns {string|undefined} Path of the wheel, if there is one.
 */
function newestWheel() {
  const dist = join(repo, "dist");
  if (!existsSync(dist)) return undefined;
  const wheels = readdirSync(dist).filter((name) => name.endsWith(".whl"));
  return wheels.length ? join(dist, wheels.sort().at(-1)) : undefined;
}
