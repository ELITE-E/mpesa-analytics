// The vault's test page for real Chrome (CP9a item 7): a loopback server that sends the
// architecture CSP (ADR 0013) on every response and serves a blank page plus the vault's own
// modules, transpiled from web/src/persistence/*.ts by TypeScript as the unit tests' loader does.
// Tests import the modules into the page with `import("/persistence/vault.js")`. It never logs a
// request and serves nothing else.

import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";

import ts from "typescript";

import { ARCHITECTURE_CSP } from "../../harness/serve.js";

const PERSISTENCE = join(import.meta.dirname, "..", "..", "src", "persistence");
const MODULE_PATH = /^\/persistence\/([a-z-]+)\.js$/;
const ALIAS_IMPORT = /from "@\/persistence\/([a-z-]+)"/g;
const TEST_PAGE = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><link rel="icon" href="data:,"><title>Vault test page</title></head>
  <body><h1>Vault test page</h1><p>Real-Chrome tests import the vault into this page.</p></body>
</html>
`;

/**
 * Start the server on a free loopback port.
 *
 * @returns {Promise<{origin: string, close: Function}>} The origin and a close function.
 */
export function startVaultPageServer() {
  const server = createServer((request, response) => {
    answer(request.url ?? "/")
      .then(({ status, type, body }) => {
        response.writeHead(status, {
          "Content-Type": type,
          "Content-Security-Policy": ARCHITECTURE_CSP,
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "no-store",
        });
        response.end(body);
      })
      .catch(() => {
        response.writeHead(404, { "Content-Security-Policy": ARCHITECTURE_CSP });
        response.end();
      });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () =>
      resolve({
        origin: `http://127.0.0.1:${server.address().port}`,
        close: () => {
          server.closeAllConnections();
          return new Promise((closed) => server.close(closed));
        },
      }),
    );
  });
}

/**
 * The response for one path: the test page, a vault module, or 404.
 *
 * @param {string} url The request URL.
 * @returns {Promise<{status: number, type: string, body: string}>} What to send.
 */
async function answer(url) {
  const path = new URL(url, "http://localhost").pathname;
  if (path === "/vault-test.html") return { status: 200, type: "text/html; charset=utf-8", body: TEST_PAGE };
  const moduleName = path.match(MODULE_PATH)?.[1];
  if (!moduleName) return { status: 404, type: "text/plain", body: "" };
  return { status: 200, type: "text/javascript; charset=utf-8", body: await transpiledModule(moduleName) };
}

/**
 * One persistence module as browser JavaScript, its `@/persistence/` imports pointed at this server.
 *
 * @param {string} name The module's file name without extension.
 * @returns {Promise<string>} The JavaScript.
 */
async function transpiledModule(name) {
  const fileName = join(PERSISTENCE, `${name}.ts`);
  const source = await readFile(fileName, "utf8");
  const { outputText } = ts.transpileModule(source, {
    fileName,
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, isolatedModules: true },
  });
  return outputText.replace(ALIAS_IMPORT, 'from "/persistence/$1.js"');
}
