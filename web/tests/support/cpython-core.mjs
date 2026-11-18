// The real core for the store's Node tests (CP9b): one CPython process running
// mpesa_core.bridge.call_json, answering one JSON line per call. Nothing is mocked: the plans,
// validations and merged reports are the core's own. The browser reaches the same bridge
// function through the statement engine's worker.

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const PYTHON = join(REPO, ".venv", "bin", "python");
const SERVER = `
import json, sys
from mpesa_core import bridge
for line in sys.stdin:
    call = json.loads(line)
    print(bridge.call_json(call["function"], call["request"]), flush=True)
`;

/**
 * Start the core process.
 *
 * @returns {{call: Function, calls: string[], close: Function}} `call(functionName, requestText)`
 *   resolves to the core's envelope; `calls` records each function called; `close()` ends it.
 */
export function startCpythonCore() {
  const child = spawn(PYTHON, ["-c", SERVER], { cwd: REPO, stdio: ["pipe", "pipe", "inherit"] });
  const waiting = [];
  const calls = [];
  createInterface({ input: child.stdout }).on("line", (line) => waiting.shift()?.(JSON.parse(line)));
  return {
    calls,
    call(functionName, requestText) {
      calls.push(functionName);
      return new Promise((resolve) => {
        waiting.push(resolve);
        child.stdin.write(`${JSON.stringify({ function: functionName, request: requestText })}\n`);
      });
    },
    close() {
      child.stdin.end();
      return new Promise((resolve) => child.once("exit", resolve));
    },
  };
}
