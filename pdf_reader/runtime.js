// Loads the self-hosted runtime inside the worker: pdf.js, Pyodide and the mpesa_core wheel, all
// from local files checked against the runtime's SHA-256 manifest first. pandas loads later, only
// when the analysis step asks for it. Nothing is fetched from a CDN.

const MANIFEST = "manifest.json";
const LOCK_FILE = "pyodide/pyodide-lock.json";
const PDFJS_MODULE = "pdfjs/pdf.min.mjs";
const PDFJS_WORKER = "pdfjs/pdf.worker.min.mjs";
const PYODIDE_MODULE = "pyodide/pyodide.mjs";
// Everything the engine needs before its first run, checked before any of it is used.
const START_FILES = [
  PYODIDE_MODULE,
  "pyodide/pyodide.asm.mjs",
  "pyodide/pyodide.asm.wasm",
  "pyodide/python_stdlib.zip",
  LOCK_FILE,
  PDFJS_MODULE,
  PDFJS_WORKER,
];
// pandas and its dependencies, as the runtime's lock file resolves them (pytz is not one: pandas 3
// does not need it, so tools/vendor.py drops it, ADR 0006); all are in the manifest.
const ANALYSIS_PACKAGE = "pandas";
const ANALYSIS_FILE_PREFIXES = [
  "pyodide/numpy-",
  "pyodide/pandas-",
  "pyodide/python_dateutil-",
  "pyodide/six-",
];
const HEX_BASE = 16;
const HEX_DIGITS = 2;

/**
 * A runtime file did not match the manifest. The message names no file and no value.
 */
export class RuntimeIntegrityError extends Error {
  /**
   * Record that the runtime failed its check.
   *
   * Side effects: none.
   */
  constructor() {
    super("runtime failed its checksum");
    this.name = "RuntimeIntegrityError";
  }
}

/**
 * Pyodide could not load a package. The message names no file.
 */
export class RuntimeLoadError extends Error {
  /**
   * Record that a package failed to load.
   *
   * Side effects: none.
   */
  constructor() {
    super("runtime package failed to load");
    this.name = "RuntimeLoadError";
  }
}

/**
 * Verify and load the runtime.
 *
 * Side effects: fetches runtime files from the same origin, imports pdf.js and Pyodide, and
 * installs the wheel into Pyodide's site-packages.
 *
 * @param {string} runtimeUrl Same-origin URL of the runtime, ending in `<version>/`; the version
 *   is the start of the manifest's SHA-256.
 * @returns {Promise<object>} The pdf.js module and worker URL, the core (`run_json`,
 *   `load_analysis_runtime`, `wasm_memory_bytes`), the Pyodide instance (for measurement tools)
 *   and the load timings in milliseconds: verification, pdf.js import, Pyodide start, wheel
 *   install (with importing the bridge) and the total.
 * @throws {RuntimeIntegrityError} If the manifest or a file does not match.
 */
export async function load_runtime(runtimeUrl) {
  return load_absolute_runtime(new URL(runtimeUrl, self.location.href).href);
}

/**
 * Verify and load the runtime from an absolute URL; Pyodide rejects a relative package base.
 *
 * Side effects: as ``load_runtime``.
 *
 * @param {string} runtimeUrl Absolute URL of the runtime, ending in `<version>/`.
 * @returns {Promise<object>} As ``load_runtime``.
 * @throws {RuntimeIntegrityError} If the manifest or a file does not match.
 */
async function load_absolute_runtime(runtimeUrl) {
  const started = performance.now();
  const manifest = await fetch_manifest(runtimeUrl);
  const [verified, wheelBytes] = await Promise.all([
    Promise.all(START_FILES.map((path) => fetch_verified(runtimeUrl, manifest, path))),
    fetch_verified(runtimeUrl, manifest, manifest.wheel),
  ]);
  const lockFile = JSON.parse(new TextDecoder().decode(verified[START_FILES.indexOf(LOCK_FILE)]));
  const verifiedAt = performance.now();
  const pdfjsLib = await import(`${runtimeUrl}${PDFJS_MODULE}`);
  const pdfjsImportedAt = performance.now();
  const pyodide = await start_pyodide(runtimeUrl, lockFile);
  const pyodideStartedAt = performance.now();
  install_wheel(pyodide, wheelBytes);
  const coreBridge = pyodide.pyimport("mpesa_core.bridge");
  const runJson = coreBridge.run_json;
  const planJson = coreBridge.plan_statement_import_json;
  const wheelInstalledAt = performance.now();
  return {
    pdfjsLib,
    workerSrc: `${runtimeUrl}${PDFJS_WORKER}`,
    // For measurement tools only; the engine talks to Python through `core` alone.
    pyodide,
    core: {
      plan_json: (requestText) => planJson(requestText),
      run_json: (statementPagesText, processedAt) =>
        runJson(statementPagesText, processedAt ?? undefined),
      load_analysis_runtime: () => load_analysis_runtime(pyodide, runtimeUrl, manifest),
      // Load pandas and import the analysis now, so the first statement does not wait for it.
      warm_analysis: async () => {
        if (!pyodide.loadedPackages.pandas) {
          await load_analysis_runtime(pyodide, runtimeUrl, manifest);
        }
        pyodide.runPython("import mpesa_core.analysis.report");
      },
      wasm_memory_bytes: () => pyodide._module?.HEAPU8?.length ?? null,
    },
    timings: {
      runtime_verify_ms: verifiedAt - started,
      pdfjs_import_ms: pdfjsImportedAt - verifiedAt,
      pyodide_init_ms: pyodideStartedAt - pdfjsImportedAt,
      wheel_install_ms: wheelInstalledAt - pyodideStartedAt,
      runtime_load_ms: performance.now() - started,
    },
  };
}

/**
 * Fetch the manifest and check it against the version in the URL.
 *
 * Side effects: fetches the manifest.
 *
 * @param {string} runtimeUrl The runtime's URL.
 * @returns {Promise<object>} The parsed manifest.
 * @throws {RuntimeIntegrityError} If its digest does not start with the version.
 */
async function fetch_manifest(runtimeUrl) {
  const version = runtimeUrl.split("/").filter(Boolean).at(-1);
  const manifestBytes = await fetch_bytes(`${runtimeUrl}${MANIFEST}`);
  if (!(await sha256_hex(manifestBytes)).startsWith(version)) throw new RuntimeIntegrityError();
  return JSON.parse(new TextDecoder().decode(manifestBytes));
}

/**
 * Fetch one runtime file and check it against the manifest.
 *
 * Side effects: fetches the file.
 *
 * @param {string} runtimeUrl The runtime's URL.
 * @param {object} manifest The checked manifest.
 * @param {string} path The file's path in the manifest.
 * @returns {Promise<Uint8Array>} The file's verified bytes.
 * @throws {RuntimeIntegrityError} If the file is not in the manifest or does not match it.
 */
async function fetch_verified(runtimeUrl, manifest, path) {
  const entry = manifest.files[path];
  if (!entry) throw new RuntimeIntegrityError();
  const bytes = await fetch_bytes(`${runtimeUrl}${path}`);
  if (bytes.length !== entry.size || (await sha256_hex(bytes)) !== entry.sha256) {
    throw new RuntimeIntegrityError();
  }
  return bytes;
}

/**
 * Start Pyodide from the local runtime, with the verified lock file.
 *
 * `packageBaseUrl` must be set: with a lock file passed in and no base URL, Pyodide would fetch
 * packages from its CDN.
 *
 * Side effects: imports Pyodide and instantiates its wasm module.
 *
 * @param {string} runtimeUrl The runtime's URL.
 * @param {object} lockFile The verified, parsed pyodide-lock.json.
 * @returns {Promise<object>} The Pyodide instance.
 */
async function start_pyodide(runtimeUrl, lockFile) {
  const { loadPyodide } = await import(`${runtimeUrl}${PYODIDE_MODULE}`);
  const pyodideUrl = `${runtimeUrl}pyodide/`;
  return loadPyodide({
    indexURL: pyodideUrl,
    packageBaseUrl: pyodideUrl,
    lockFileContents: lockFile,
    // Python output never reaches the console.
    stdout: () => undefined,
    stderr: () => undefined,
  });
}

/**
 * Install the core wheel from its verified bytes, as the Pyodide test runner does.
 *
 * Side effects: writes the wheel's files into Pyodide's site-packages.
 *
 * @param {object} pyodide The Pyodide instance.
 * @param {Uint8Array} wheelBytes The verified wheel.
 */
function install_wheel(pyodide, wheelBytes) {
  const extractDir = pyodide.runPython("import site; site.getsitepackages()[0]");
  pyodide.unpackArchive(wheelBytes, "wheel", { extractDir });
}

/**
 * Verify pandas and its dependencies, then load them into Pyodide.
 *
 * Side effects: fetches the package files twice: once here to check them against the manifest,
 * and once by Pyodide, which checks them against the lock file (from the HTTP cache).
 *
 * @param {object} pyodide The Pyodide instance.
 * @param {string} runtimeUrl The runtime's URL.
 * @param {object} manifest The checked manifest.
 * @returns {Promise<number>} The milliseconds the load took, checks included.
 * @throws {RuntimeIntegrityError} If a package file does not match.
 * @throws {RuntimeLoadError} If Pyodide reports that pandas did not load.
 */
async function load_analysis_runtime(pyodide, runtimeUrl, manifest) {
  const started = performance.now();
  const paths = Object.keys(manifest.files).filter((path) =>
    ANALYSIS_FILE_PREFIXES.some((prefix) => path.startsWith(prefix)),
  );
  if (paths.length !== ANALYSIS_FILE_PREFIXES.length) throw new RuntimeIntegrityError();
  await Promise.all(paths.map((path) => fetch_verified(runtimeUrl, manifest, path)));
  let loadFailed = false;
  await pyodide.loadPackage(ANALYSIS_PACKAGE, {
    messageCallback: () => undefined,
    // Pyodide reports a failed package here instead of rejecting; its text names files.
    errorCallback: () => {
      loadFailed = true;
    },
  });
  if (loadFailed || !pyodide.loadedPackages[ANALYSIS_PACKAGE]) throw new RuntimeLoadError();
  return performance.now() - started;
}

/**
 * Fetch a same-origin file's bytes.
 *
 * Side effects: makes one GET request.
 *
 * @param {string} url The file's URL.
 * @returns {Promise<Uint8Array>} The body.
 * @throws {RuntimeIntegrityError} If the response is not OK.
 */
async function fetch_bytes(url) {
  const response = await fetch(url);
  if (!response.ok) throw new RuntimeIntegrityError();
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * Hash bytes.
 *
 * Side effects: none.
 *
 * @param {Uint8Array} bytes The bytes.
 * @returns {Promise<string>} The lowercase hex SHA-256.
 */
async function sha256_hex(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(HEX_BASE).padStart(HEX_DIGITS, "0")).join("");
}
