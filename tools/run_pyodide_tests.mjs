#!/usr/bin/env node
// Imports every mpesa_core module under the vendored Pyodide. Run tools/vendor.py first.
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const indexURL = join(repo, "web/public/vendor/pyodide") + sep;
const core = join(repo, "src/mpesa_core");

const { loadPyodide } = await import(pathToFileURL(join(indexURL, "pyodide.mjs")));
const pyodide = await loadPyodide({ indexURL });

const modules = [];
for (const entry of readdirSync(core, { recursive: true, withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith(".py")) continue;
  const path = join(entry.parentPath, entry.name);
  const rel = relative(core, path).split(sep).join("/");
  const target = `/lib/mpesa_core/${rel}`;
  pyodide.FS.mkdirTree(target.slice(0, target.lastIndexOf("/")));
  pyodide.FS.writeFile(target, readFileSync(path));
  modules.push(`mpesa_core.${rel.replace(/\.py$/, "").replaceAll("/", ".")}`.replace(/\.__init__$/, ""));
}
pyodide.globals.set("modules", pyodide.toPy(modules));
pyodide.runPython(`
import importlib, sys
sys.path.insert(0, "/lib")
for name in modules:
    importlib.import_module(name)
`);
console.log(`run_pyodide_tests: PASS (${modules.length} modules, Python ${pyodide.runPython("sys.version.split()[0]")})`);
