#!/usr/bin/env node
// Imports every mpesa_core module under the vendored Pyodide. Run tools/vendor.py first.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const indexURL = join(repo, "web/public/vendor/pyodide") + sep;
const core = join(repo, "src/mpesa_core");

await main();

/**
 * Load Pyodide, copy the core into its filesystem and import every module.
 *
 * Side effects: reads the core sources and writes the outcome to stdout.
 *
 * @returns {Promise<void>} Resolves when every module has imported.
 */
async function main() {
  const { loadPyodide } = await import(pathToFileURL(join(indexURL, "pyodide.mjs")));
  const pyodide = await loadPyodide({ indexURL });
  const modules = copyCore(pyodide);
  pyodide.globals.set("modules", pyodide.toPy(modules));
  pyodide.runPython(`
import importlib, sys
sys.path.insert(0, "/lib")
for name in modules:
    importlib.import_module(name)
`);
  const version = pyodide.runPython("sys.version.split()[0]");
  console.log(`run_pyodide_tests: PASS (${modules.length} modules, Python ${version})`);
}

/**
 * Copy every core source file into Pyodide's filesystem.
 *
 * Side effects: reads the core sources and writes to Pyodide's filesystem.
 *
 * @param {object} pyodide Loaded Pyodide instance.
 * @returns {string[]} Dotted names of the copied modules.
 */
function copyCore(pyodide) {
  const modules = [];
  for (const entry of readdirSync(core, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".py")) continue;
    const path = join(entry.parentPath, entry.name);
    const rel = relative(core, path).split(sep).join("/");
    const target = `/lib/mpesa_core/${rel}`;
    pyodide.FS.mkdirTree(target.slice(0, target.lastIndexOf("/")));
    pyodide.FS.writeFile(target, readFileSync(path));
    modules.push(moduleName(rel));
  }
  return modules;
}

/**
 * Convert a source path to a dotted module name.
 *
 * Side effects: none.
 *
 * @param {string} rel Path relative to the core package, with forward slashes.
 * @returns {string} Dotted module name.
 */
function moduleName(rel) {
  const dotted = rel.replace(/\.py$/, "").replaceAll("/", ".");
  return `mpesa_core.${dotted}`.replace(/\.__init__$/, "");
}
