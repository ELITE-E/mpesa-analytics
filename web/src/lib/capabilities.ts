// The browser capability check at app start (CP10a item 2). Pure: it reads the given scope and
// never creates a worker, fetches or writes.

/** A capability the app cannot run without. */
export type Capability = "moduleWorker" | "webAssembly" | "cryptoSubtle" | "randomValues";

/** What the check found: the missing required capabilities, and whether storage is there. */
export type BrowserCheck = { missing: Capability[]; storage: boolean };

// A URL that cannot parse: the Worker constructor reads its options, then throws before it fetches
// anything or consults the CSP.
const UNPARSABLE_URL = "http://[";

/**
 * Check what this browser offers.
 *
 * @param scope The global object to inspect (tests pass their own).
 * @returns The missing required capabilities in a fixed order, and whether IndexedDB exists
 *   (without it the app runs memory-only). Side effects: none.
 */
export function checkBrowser(scope: Record<string, unknown> = globalThis as unknown as Record<string, unknown>): BrowserCheck {
  const cryptoApi = scope.crypto as { subtle?: unknown; getRandomValues?: unknown } | undefined;
  const missing: Capability[] = [];
  if (!supportsModuleWorkers(scope.Worker)) missing.push("moduleWorker");
  if (typeof scope.WebAssembly !== "object" || scope.WebAssembly === null) missing.push("webAssembly");
  if (!cryptoApi?.subtle) missing.push("cryptoSubtle");
  if (typeof cryptoApi?.getRandomValues !== "function") missing.push("randomValues");
  return { missing, storage: Boolean(scope.indexedDB) };
}

/**
 * Whether the Worker constructor understands `{type: "module"}`: a browser that supports module
 * workers reads the option; one that does not ignores it.
 *
 * @param workerConstructor The scope's Worker.
 * @returns True if it read `type`. Side effects: none; the probe URL cannot parse.
 */
function supportsModuleWorkers(workerConstructor: unknown): boolean {
  if (typeof workerConstructor !== "function") return false;
  let readType = false;
  const options = {
    get type() {
      readType = true;
      return "module";
    },
  };
  try {
    new (workerConstructor as new (url: string, options: object) => unknown)(UNPARSABLE_URL, options);
  } catch {
    // Expected: the URL cannot parse. Only whether `type` was read matters.
  }
  return readType;
}
