// Node module hooks that let `node --test` import the app's own .ts/.tsx
// sources unchanged: TypeScript (already a devDependency) transpiles them,
// the tsconfig `@/*` alias is resolved, and `next/navigation` is swapped for
// a recording stand-in so tests observe the navigation boundary without a
// browser or a running Next server.

import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const PROJECT_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const NAVIGATION_MOCK = new URL("./next-navigation-mock.mjs", import.meta.url).href;
const SOURCE_EXTENSIONS = [".ts", ".tsx"];

/** The existing source file for an extensionless app path, or null. */
function findSourceFile(basePath) {
  const candidates = [
    basePath,
    ...SOURCE_EXTENSIONS.map((extension) => `${basePath}${extension}`),
    ...SOURCE_EXTENSIONS.map((extension) => `${basePath}/index${extension}`),
  ];
  return (
    candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile()) ??
    null
  );
}

/**
 * Resolve `@/…` aliases and `next/navigation`; defer everything else to Node.
 * Next's entry points such as `next/link` are CommonJS files without an
 * `exports` map, which Node's ESM resolver only finds with their `.js`
 * extension, so a bare `next/<name>` that Node cannot find is retried as
 * `next/<name>.js`.
 */
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "next/navigation") {
    return { url: NAVIGATION_MOCK, shortCircuit: true };
  }
  if (specifier.startsWith("@/")) {
    const file = findSourceFile(`${PROJECT_ROOT}src/${specifier.slice(2)}`);
    if (file) return { url: pathToFileURL(file).href, shortCircuit: true };
  }
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    const isBareNextEntry = /^next\/[\w-]+$/.test(specifier);
    if (!isBareNextEntry || error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
    return nextResolve(`${specifier}.js`, context);
  }
}

/** Transpile app .ts/.tsx sources to ES modules with the React JSX runtime. */
export async function load(url, context, nextLoad) {
  if (url.startsWith("file:") && SOURCE_EXTENSIONS.some((extension) => url.endsWith(extension))) {
    const source = await readFile(fileURLToPath(url), "utf8");
    const { outputText } = ts.transpileModule(source, {
      fileName: fileURLToPath(url),
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        isolatedModules: true,
      },
    });
    return { format: "module", source: outputText, shortCircuit: true };
  }
  return nextLoad(url, context);
}
