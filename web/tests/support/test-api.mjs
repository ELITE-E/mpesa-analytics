// A throwaway instance of the real FastAPI backend for browser tests: a new
// SQLite database in a temp dir, migrated with `alembic upgrade head` (the
// production schema path), one synthetic account created through the
// project's own account CLI, and CORS opened only to the test frontend.
// It never reads the repository's .env and never touches the development
// database. Uses the repository's existing virtualenv (.venv).

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPOSITORY_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const PYTHON = join(REPOSITORY_ROOT, ".venv", "bin", "python");

/** Run `python -m <module> …args` in the repository; rejects with its output on failure. */
function runPython(args, env) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(PYTHON, args, { cwd: REPOSITORY_ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolveRun(output) : reject(new Error(`python ${args.join(" ")} failed:\n${output}`)),
    );
  });
}

/**
 * Start the API on `port`, allowing `webOrigin`; resolves to
 * { origin, account: { username, password }, stop(), output() }.
 */
export async function startTestApi({ port, webOrigin }) {
  if (!existsSync(PYTHON)) throw new Error(`no virtualenv at ${PYTHON}; run \`uv sync\` first`);
  const dataDir = mkdtempSync(join(tmpdir(), "browser-csp-api-"));
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    DATABASE_URL: `sqlite:///${join(dataDir, "api.db")}`,
    APP_ENV: "development",
    CORS_ALLOWED_ORIGINS: webOrigin,
    API_DOCS_ENABLED: "false",
  };
  const account = {
    username: "browser-csp-check",
    // Synthetic, per run; exists only in this throwaway database.
    password: randomBytes(18).toString("base64url"),
  };

  await runPython(["-m", "alembic", "upgrade", "head"], env);
  await runPython(["-m", "src.api.manage", "create-user", account.username], {
    ...env,
    MPESA_NEW_USER_PASSWORD: account.password,
  });

  const child = spawn(
    PYTHON,
    ["-m", "uvicorn", "--factory", "src.api.main:create_app", "--host", "127.0.0.1", "--port", String(port)],
    { cwd: REPOSITORY_ROOT, env, detached: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  const exited = new Promise((resolveExit) => child.once("exit", resolveExit));
  const origin = `http://127.0.0.1:${port}`;

  /** Stop the server and delete its database. */
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        // Already gone.
      }
      await Promise.race([exited, new Promise((wait) => setTimeout(wait, 10_000))]);
    }
    rmSync(dataDir, { recursive: true, force: true });
  };

  const deadline = Date.now() + 60_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`test API exited early:\n${output}`);
    try {
      if ((await fetch(`${origin}/ready`)).ok) break;
    } catch {
      // Not listening yet.
    }
    if (Date.now() > deadline) {
      await stop();
      throw new Error(`test API did not become ready:\n${output}`);
    }
    await new Promise((wait) => setTimeout(wait, 250));
  }
  return { origin, account, stop, output: () => output };
}
