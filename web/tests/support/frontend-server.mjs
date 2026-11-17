// Runs the frontend for HTTP-level tests, in a throwaway copy of the app so
// the real .next/ (and any running `next dev`) is never touched.
//
// Production is built and started exactly as web-prototype/Dockerfile does
// (next build, then the standalone server.js with .next/static and public/
// copied beside it). Development is `next dev`, with .env.development.
//
// node_modules is copied rather than symlinked: Turbopack refuses a
// node_modules symlink that points outside the project root.
//
// FRONTEND_SECURITY_APP_DIR may name another app directory to build instead
// of web-prototype/ (for example a candidate implementation kept outside
// the repository); it defaults to the real app.

import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_APP_DIR = fileURLToPath(new URL("../../", import.meta.url));
const NODE_MODULES_DIR = join(DEFAULT_APP_DIR, "node_modules");
const NOT_COPIED = new Set(["node_modules", ".next", "tests", "stitch-export", "tsconfig.tsbuildinfo"]);

/** The app directory under test (see FRONTEND_SECURITY_APP_DIR above). */
export function appSourceDir() {
  return process.env.FRONTEND_SECURITY_APP_DIR || DEFAULT_APP_DIR;
}

/** Copy the app (without build output or tests) plus node_modules to a temp dir. */
export function copyAppToTempDir() {
  const target = mkdtempSync(join(tmpdir(), "frontend-security-"));
  cpSync(appSourceDir(), target, {
    recursive: true,
    filter: (source) => source === appSourceDir() || !NOT_COPIED.has(basename(source)),
  });
  cpSync(NODE_MODULES_DIR, join(target, "node_modules"), {
    recursive: true,
    verbatimSymlinks: true,
  });
  return target;
}

/** Remove a temp copy made by copyAppToTempDir. */
export function removeTempDir(dir) {
  if (dir && dir.startsWith(tmpdir())) rmSync(dir, { recursive: true, force: true });
}

/** A TCP port that was free a moment ago on 127.0.0.1. */
export function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolvePort(port));
    });
  });
}

/** Path of the Next.js CLI inside a copied app. */
function nextCli(appDir) {
  return join(appDir, "node_modules", "next", "dist", "bin", "next");
}

/**
 * Run a command to completion, collecting its output; rejects with that
 * output when it exits non-zero.
 */
function run(command, args, options) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolveRun(output) : reject(new Error(`${args.join(" ")} failed:\n${output}`)),
    );
  });
}

/** Environment for child processes: no telemetry, no inherited NODE_ENV. */
function childEnv(extra) {
  const env = { ...process.env, NEXT_TELEMETRY_DISABLED: "1", ...extra };
  if (!("NODE_ENV" in extra)) delete env.NODE_ENV;
  return env;
}

/** `next build` a copied app for production with the given API base URL. */
export async function buildForProduction(appDir, apiBaseUrl) {
  await run(process.execPath, [nextCli(appDir), "build"], {
    cwd: appDir,
    env: childEnv({ NODE_ENV: "production", NEXT_PUBLIC_API_BASE_URL: apiBaseUrl }),
  });
  // As the Dockerfile's runtime stage lays it out.
  const standalone = join(appDir, ".next", "standalone");
  cpSync(join(appDir, ".next", "static"), join(standalone, ".next", "static"), { recursive: true });
  if (existsSync(join(appDir, "public"))) {
    cpSync(join(appDir, "public"), join(standalone, "public"), { recursive: true });
  }
}

/**
 * Start a long-running server process in its own process group and wait
 * until `readyPath` answers; resolves to { origin, stop, output() }, where
 * `stop()` resolves after the whole process group has exited.
 */
async function startServer(command, args, options, port, readyPath = "/") {
  const child = spawn(command, args, {
    ...options,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  const origin = `http://127.0.0.1:${port}`;

  const exited = new Promise((resolveExit) => child.once("exit", resolveExit));
  const signalGroup = (signal) => {
    try {
      process.kill(-child.pid, signal);
    } catch {
      // Already gone.
    }
  };
  // Resolves once the server has exited, so its directory can be removed.
  const stop = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    signalGroup("SIGTERM");
    const timer = setTimeout(() => signalGroup("SIGKILL"), 10_000);
    await exited;
    clearTimeout(timer);
  };

  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited early:\n${output}`);
    try {
      await fetch(`${origin}${readyPath}`, { redirect: "manual" });
      return { origin, stop, output: () => output };
    } catch {
      await new Promise((wait) => setTimeout(wait, 250));
    }
  }
  await stop();
  throw new Error(`server did not start:\n${output}`);
}

/** Start the standalone production server of a built copy. */
export async function startProductionServer(appDir) {
  const port = await freePort();
  return startServer(
    process.execPath,
    ["server.js"],
    {
      cwd: join(appDir, ".next", "standalone"),
      env: childEnv({ NODE_ENV: "production", PORT: String(port), HOSTNAME: "127.0.0.1" }),
    },
    port,
  );
}

/** Start `next dev` in a copied app (uses its .env.development). */
export async function startDevelopmentServer(appDir) {
  const port = await freePort();
  return startServer(
    process.execPath,
    [nextCli(appDir), "dev", "--port", String(port), "--hostname", "127.0.0.1"],
    { cwd: appDir, env: childEnv({}) },
    port,
  );
}
