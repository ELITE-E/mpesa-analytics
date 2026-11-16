#!/usr/bin/env python3
"""Fetch and checksum the pinned runtime. Output is gitignored, never committed.

Commands:
    fetch [pyodide|pdfjs|gitleaks|node ...]: Download and verify against PINS.
    verify: Re-hash what is already on disk.
    table: Print sha256 and size for docs.
    runtime --wheel PATH: Copy what the browser loads into web/public/runtime/<version>/, with a
        SHA-256 manifest. Fetched files only, never a CDN at runtime; also gitignored.
    verify-runtime: Re-hash the built runtime against its manifest, and the manifest against its
        version.
"""

import argparse
import base64
import hashlib
import io
import json
import shutil
import sys
import tarfile
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
VENDOR = REPO / "web" / "public" / "vendor"
RUNTIME_ROOT = REPO / "web" / "public" / "runtime"
RUNTIME_POINTER = "current.json"
RUNTIME_MANIFEST = "manifest.json"
RUNTIME_VERSION_LENGTH = 16
PURE_WHEEL_SUFFIX = "-py3-none-any.whl"
BIN = REPO / ".cache" / "bin"
DOWNLOAD_TIMEOUT_SECONDS = 120

PYODIDE_VERSION = "314.0.7"
PDFJS_VERSION = "6.4.299"
GITLEAKS_VERSION = "8.30.1"
NODE_VERSION = "24.21.0"

NPM = "https://registry.npmjs.org"
PYODIDE_TGZ = f"{NPM}/pyodide/-/pyodide-{PYODIDE_VERSION}.tgz"
PYODIDE_CDN = f"https://cdn.jsdelivr.net/pyodide/v{PYODIDE_VERSION}/full"
PDFJS_TGZ = f"{NPM}/pdfjs-dist/-/pdfjs-dist-{PDFJS_VERSION}.tgz"
GITLEAKS_TGZ = (
    "https://github.com/gitleaks/gitleaks/releases/download/"
    f"v{GITLEAKS_VERSION}/gitleaks_{GITLEAKS_VERSION}_linux_x64.tar.gz"
)

NODE_DIR = f"node-v{NODE_VERSION}-linux-x64"
NODE_ARCHIVE = f"https://nodejs.org/dist/v{NODE_VERSION}/{NODE_DIR}.tar.xz"

# npm's own dist.integrity values, checked before anything is unpacked.
NPM_INTEGRITY = {
    PYODIDE_TGZ: (
        "sha512-0YvXxEhfEdpLfb/XkM2BFAeMROq0iMUX2bzzH9pOttyMcWkwq+"
        "HbE5uyuGD82LN7y2q+SNvi/6V5JEsOlD2R1A=="
    ),
    PDFJS_TGZ: (
        "sha512-AVl138zALtfaAPvADulE0PZThbYzCBS79nL4pOSL/6Sm/"
        "4AH5A21BD9VHt97OlCuzJuCpmeZtAtkinisF4Vb1g=="
    ),
}

# The groups reported in docs/decisions/0001-versions.md.
GROUPS = {
    "pyodide-core": [
        "pyodide/pyodide.mjs",
        "pyodide/pyodide.asm.mjs",
        "pyodide/pyodide.asm.wasm",
        "pyodide/python_stdlib.zip",
        "pyodide/pyodide-lock.json",
    ],
    "numpy": ["pyodide/numpy-2.4.6-cp314-cp314-pyemscripten_2026_0_wasm32.whl"],
    "pandas": [
        "pyodide/pandas-3.0.2-cp314-cp314-pyemscripten_2026_0_wasm32.whl",
        "pyodide/python_dateutil-2.9.0.post0-py2.py3-none-any.whl",
        "pyodide/pytz-2026.1.post1-py2.py3-none-any.whl",
        "pyodide/six-1.17.0-py2.py3-none-any.whl",
    ],
    "pdfjs": ["pdfjs/pdf.min.mjs", "pdfjs/pdf.worker.min.mjs"],
    # Dev only: the build that runs under Node, because the modern one needs Uint8Array.toHex.
    "pdfjs-node": ["pdfjs-node/pdf.min.mjs", "pdfjs-node/pdf.worker.min.mjs"],
    # Dev only: runs tests/core under Pyodide. Never served, and not part of the download budget.
    "test-runner": [
        "pyodide/atomicwrites-1.4.1-py2.py3-none-any.whl",
        "pyodide/attrs-26.1.0-py3-none-any.whl",
        "pyodide/exceptiongroup-1.3.1-py3-none-any.whl",
        "pyodide/iniconfig-2.3.0-py3-none-any.whl",
        "pyodide/more_itertools-11.0.1-py3-none-any.whl",
        "pyodide/pluggy-1.6.0-py3-none-any.whl",
        "pyodide/py-1.11.0-py2.py3-none-any.whl",
        "pyodide/pygments-2.20.0-py3-none-any.whl",
        "pyodide/pyparsing-3.3.2-py3-none-any.whl",
        "pyodide/pytest-9.0.2-py3-none-any.whl",
        "pyodide/setuptools-82.0.1-py3-none-any.whl",
    ],
}

# What the browser loads, by published path under runtime/<version>/, from its vendored path.
# Pyodide, the browser build of pdf.js, and only the packages the core loads: numpy and pandas,
# with their dependencies, for the analysis extra. The core wheel is added at build time.
RUNTIME_SOURCES = {
    rel: rel for group in ("pyodide-core", "numpy", "pandas", "pdfjs") for rel in GROUPS[group]
}

PINS = dict(
    (
        (
            "pdfjs-node/pdf.min.mjs",
            "bccc24ea711db8e44503629519904a5292d73b9daaa214bbe7cdcc282b0f4259",
        ),
        (
            "pdfjs-node/pdf.worker.min.mjs",
            "145d2dd3ab0c86151011dba95acfa2d5336e2accd59388ea43dbee0efddaaec6",
        ),
        (
            "pyodide/atomicwrites-1.4.1-py2.py3-none-any.whl",
            "18fdd95649db5939bbf2b214302282b6a00aba8b76265db459e95dbb32e22561",
        ),
        (
            "pyodide/attrs-26.1.0-py3-none-any.whl",
            "0506ebb8e46c83017941a7239eecb2f74420d332cf1f341bddc43a217ab0bb66",
        ),
        (
            "pyodide/exceptiongroup-1.3.1-py3-none-any.whl",
            "15c063c35d433d28df83fa51f897619583ad3d6b43a5c58e44737afb3fe46dfc",
        ),
        (
            "pyodide/iniconfig-2.3.0-py3-none-any.whl",
            "7a5425ae2eda9988c8a841e386dd74f4ce6333bbba40e926cb7ad5153396c077",
        ),
        (
            "pyodide/more_itertools-11.0.1-py3-none-any.whl",
            "f969b7b2dac6c78a527430279d5a56fc7ef61c2ccd2b4f0e817c3d79e3894ba0",
        ),
        (
            "pyodide/pluggy-1.6.0-py3-none-any.whl",
            "d9d6b776793b43137ea724291c466154764491db5fe6a4d8197a84b0cf592c7d",
        ),
        (
            "pyodide/py-1.11.0-py2.py3-none-any.whl",
            "6b0bb803b77d41978a0fb477125ae0a171c202f37c1cc025d40b4d10b2da488b",
        ),
        (
            "pyodide/pygments-2.20.0-py3-none-any.whl",
            "6e0fd0e83d3e725a668aa73110112ffe67e59feb4516eeff3a0b8c12a236462f",
        ),
        (
            "pyodide/pyparsing-3.3.2-py3-none-any.whl",
            "f0dd8225b5f8e945980b400bd465b4b90cb0498a2eede0d9dbea98372f6110c5",
        ),
        (
            "pyodide/pytest-9.0.2-py3-none-any.whl",
            "88b9f5fbf0e425844c0909772952a8c43d5aacbd33e5b9ef821bc6a4c7e53b82",
        ),
        (
            "pyodide/setuptools-82.0.1-py3-none-any.whl",
            "f411555185daefde67e99bec050782a5390ea62270ac6cddc2dab7bea70e53b1",
        ),
        (
            "pyodide/pyodide.mjs",
            "6f1d60f7bf529beb300f0f47983c921d3982363640ba20af0e38efdddbc66109",
        ),
        (
            "pyodide/pyodide.asm.mjs",
            "f7cdc8ece80678ceb712f8e65ebe6d3a83203a180c399865f49612a051693635",
        ),
        (
            "pyodide/pyodide.asm.wasm",
            "cc36e3cab04fdfc9a63ff13eb52eae2b911bf46c025cc7b281f394bd3de1d5e6",
        ),
        (
            "pyodide/python_stdlib.zip",
            "fa1957e5777068fc4f7437f96d860ae2fbe9c19732ba06c84e004ec16dd7dd7a",
        ),
        (
            "pyodide/pyodide-lock.json",
            "5dc2fc119108bc148c7457dc86e7675b5c87e1cafd420b9c34c1eaef7b36c010",
        ),
        (
            "pyodide/numpy-2.4.6-cp314-cp314-pyemscripten_2026_0_wasm32.whl",
            "a292c1f5d7d8a2208cd5e94fc467604c131cabcd2fc14fed6eefde121e7fabdf",
        ),
        (
            "pyodide/pandas-3.0.2-cp314-cp314-pyemscripten_2026_0_wasm32.whl",
            "45ff57772cc2f366a8582c7d3097cc4e6676342ecd5a3c08184a43462d5a02ae",
        ),
        (
            "pyodide/python_dateutil-2.9.0.post0-py2.py3-none-any.whl",
            "9b13365edf9c188f570baf9c540bbb3029ada2a2dacb9694b3659941693ee9e5",
        ),
        (
            "pyodide/pytz-2026.1.post1-py2.py3-none-any.whl",
            "b8249d6450146e0b61e6d710dc02ebb35a904796c4c2f97fe87d4ac5872db36a",
        ),
        (
            "pyodide/six-1.17.0-py2.py3-none-any.whl",
            "228c50f73aa7addf2c2ccf2979c256802a59ab69cad8152b31b9443cc8140f42",
        ),
        (
            "pdfjs/pdf.min.mjs",
            "57456c8e0c81e46be31174b499ef77f2b9f5ee46d04412ba627320a36755d4c2",
        ),
        (
            "pdfjs/pdf.worker.min.mjs",
            "9536359f1b8367850d485731ca1d5e45c159a7b7a0912325e539937aa21ceb18",
        ),
    )
)
NODE_SHA256 = "fd8e59d5a511510f6a298afb548f18c7d2b1be404d8b4a27d94fbe49f56cb2d6"
GITLEAKS_SHA256 = "551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb"


def main():
    """Run the requested command.

    Returns:
        Process exit code: 0 on success, 1 when ``verify`` finds a bad file.

    Side Effects:
        ``fetch`` downloads and writes files; ``verify`` and ``table`` read them.
    """
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "command", choices=["fetch", "verify", "table", "runtime", "verify-runtime"]
    )
    parser.add_argument("targets", nargs="*", choices=[[], *FETCHERS], default=[])
    parser.add_argument("--wheel", type=Path)
    args = parser.parse_args()
    if args.command == "verify":
        return verify()
    if args.command == "runtime":
        if args.wheel is None:
            parser.error("runtime needs --wheel")
        print(f"runtime {build_runtime(args.wheel)}")
        return verify_runtime(RUNTIME_ROOT)
    if args.command == "verify-runtime":
        return verify_runtime(RUNTIME_ROOT)
    if args.command == "table":
        return print_table()
    for target in args.targets or FETCHERS:
        if shutil.which("gitleaks") and target == "gitleaks":
            print("gitleaks already on PATH")
            continue
        FETCHERS[target]()
    return 0


def verify():
    """Re-hash the vendored files against the pins.

    Returns:
        Process exit code: 1 if any file is missing or differs, otherwise 0.

    Side Effects:
        Reads the vendored files and writes to stdout.
    """
    bad = 0
    for rel, pinned in sorted(PINS.items()):
        path = VENDOR / rel
        if not path.is_file() or sha256(path.read_bytes()) != pinned:
            print(f"BAD {rel}")
            bad += 1
    print(f"verified {len(PINS) - bad}/{len(PINS)}")
    return 1 if bad else 0


def build_runtime(wheel_path, *, runtime_root=RUNTIME_ROOT, vendor=VENDOR):
    """Copy what the browser loads into a directory named by its manifest's digest.

    Each vendored file is checked against its pin before it is copied, so the build verifies
    the runtime and the browser verifies it again at load. Any older version is removed.

    Args:
        wheel_path: The built ``py3-none-any`` wheel of ``mpesa_core``.
        runtime_root: Where the version directories and the pointer go.
        vendor: Where ``fetch`` put the vendored files.

    Returns:
        The runtime version: the first characters of the manifest's SHA-256.

    Side Effects:
        Reads the vendored files and the wheel, replaces ``runtime_root``'s contents and writes
        one line per file to stdout; exits if a file differs from its pin or the wheel is not
        pure Python.
    """
    if not wheel_path.name.endswith(PURE_WHEEL_SUFFIX):
        sys.exit(f"not a pure Python wheel: {wheel_path.name}")
    files = {}
    for published, rel in RUNTIME_SOURCES.items():
        content = (vendor / rel).read_bytes()
        if sha256(content) != PINS[rel]:
            sys.exit(f"sha256 mismatch: {rel}")
        files[published] = content
    wheel = f"core/{wheel_path.name}"
    files[wheel] = wheel_path.read_bytes()
    manifest = runtime_manifest(files, wheel)
    version = runtime_version(manifest)
    if runtime_root.exists():
        shutil.rmtree(runtime_root)
    for published, content in files.items():
        target = runtime_root / version / published
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
    (runtime_root / version / RUNTIME_MANIFEST).write_bytes(manifest)
    (runtime_root / RUNTIME_POINTER).write_text(json.dumps({"version": version}) + "\n")
    return version


def runtime_manifest(files, wheel):
    """Describe a runtime: the pinned versions, the wheel and every file's digest and size.

    Args:
        files: Published path to bytes.
        wheel: Published path of the core wheel.

    Returns:
        The manifest as canonical JSON bytes (sorted keys, no spaces), so equal runtimes give
        equal bytes and an equal version.

    Side Effects:
        None.
    """
    manifest = {
        "schema_version": 1,
        "pyodide_version": PYODIDE_VERSION,
        "pdfjs_version": PDFJS_VERSION,
        "wheel": wheel,
        "files": {
            path: {"sha256": sha256(content), "size": len(content)}
            for path, content in sorted(files.items())
        },
    }
    return json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode("utf-8")


def runtime_version(manifest):
    """Name a runtime by its manifest, so the name itself checks the manifest.

    Args:
        manifest: The manifest's bytes.

    Returns:
        The first ``RUNTIME_VERSION_LENGTH`` hex characters of the manifest's SHA-256.

    Side Effects:
        None.
    """
    return sha256(manifest)[:RUNTIME_VERSION_LENGTH]


def verify_runtime(runtime_root):
    """Re-hash the built runtime: the manifest against its version, each file against the manifest.

    Args:
        runtime_root: The directory ``build_runtime`` wrote.

    Returns:
        Process exit code: 1 if anything is missing or differs, otherwise 0.

    Side Effects:
        Reads the runtime and writes to stdout.
    """
    version = json.loads((runtime_root / RUNTIME_POINTER).read_text())["version"]
    manifest_bytes = (runtime_root / version / RUNTIME_MANIFEST).read_bytes()
    if runtime_version(manifest_bytes) != version:
        print("BAD manifest")
        return 1
    entries = json.loads(manifest_bytes)["files"]
    bad = [
        path
        for path, entry in sorted(entries.items())
        if not (runtime_root / version / path).is_file()
        or sha256((runtime_root / version / path).read_bytes()) != entry["sha256"]
    ]
    for path in bad:
        print(f"BAD {path}")
    print(f"runtime verified {len(entries) - len(bad)}/{len(entries)}")
    return 1 if bad else 0


def print_table():
    """Print a Markdown row with size and sha256 for each vendored file.

    Returns:
        Process exit code, always 0.

    Side Effects:
        Reads the vendored files and writes to stdout.
    """
    for group, members in GROUPS.items():
        for rel in members:
            content = (VENDOR / rel).read_bytes()
            print(f"| {group} | `{rel}` | {len(content)} | `{sha256(content)}` |")
    return 0


def fetch_pyodide():
    """Vendor Pyodide's runtime from npm and its wheels from the CDN.

    Side Effects:
        Downloads files and writes them under ``VENDOR``; exits on a checksum mismatch.
    """
    wanted = [rel for group in GROUPS.values() for rel in group if rel.startswith("pyodide/")]
    with fetch_tgz(PYODIDE_TGZ) as archive:
        members = set(archive.getnames())
        for rel in wanted:
            member = f"package/{rel.removeprefix('pyodide/')}"
            if member in members:
                store(rel, member_bytes(archive, member))
            else:
                store(rel, download(f"{PYODIDE_CDN}/{rel.removeprefix('pyodide/')}"))


def fetch_pdfjs():
    """Vendor the browser and Node pdf.js build files from npm.

    Side Effects:
        Downloads the package and writes under ``VENDOR``; exits on a checksum mismatch.
    """
    with fetch_tgz(PDFJS_TGZ) as archive:
        for rel in GROUPS["pdfjs"]:
            store(rel, member_bytes(archive, f"package/build/{rel.removeprefix('pdfjs/')}"))
        for rel in GROUPS["pdfjs-node"]:
            member = f"package/legacy/build/{rel.removeprefix('pdfjs-node/')}"
            store(rel, member_bytes(archive, member))


def fetch_gitleaks():
    """Install the pinned gitleaks binary under ``.cache/bin``.

    Side Effects:
        Downloads the release and writes an executable; exits on a checksum mismatch.
    """
    archive_bytes = download(GITLEAKS_TGZ)
    if sha256(archive_bytes) != GITLEAKS_SHA256:
        sys.exit("sha256 mismatch: gitleaks")
    BIN.mkdir(parents=True, exist_ok=True)
    with tarfile.open(fileobj=io.BytesIO(archive_bytes), mode="r:gz") as archive:
        (BIN / "gitleaks").write_bytes(member_bytes(archive, "gitleaks"))
    (BIN / "gitleaks").chmod(0o755)
    print(f"ok gitleaks {len(archive_bytes)}")


def fetch_node():
    """Install the pinned node binary, which the lint hooks use under ``.cache/bin``.

    Side Effects:
        Downloads the release and writes an executable; exits on a checksum mismatch.
    """
    archive_bytes = download(NODE_ARCHIVE)
    if sha256(archive_bytes) != NODE_SHA256:
        sys.exit("sha256 mismatch: node")
    BIN.mkdir(parents=True, exist_ok=True)
    with tarfile.open(fileobj=io.BytesIO(archive_bytes), mode="r:xz") as archive:
        (BIN / "node").write_bytes(member_bytes(archive, f"{NODE_DIR}/bin/node"))
    (BIN / "node").chmod(0o755)
    print(f"ok node {len(archive_bytes)}")


def fetch_tgz(url):
    """Download an npm tarball and check it against npm's integrity value.

    Args:
        url: Tarball URL, a key of ``NPM_INTEGRITY``.

    Returns:
        The opened tar archive.

    Side Effects:
        Downloads the tarball; exits on a mismatch.
    """
    archive_bytes = download(url)
    digest = "sha512-" + base64.b64encode(hashlib.sha512(archive_bytes).digest()).decode()
    if digest != NPM_INTEGRITY[url]:
        sys.exit(f"integrity mismatch: {url}")
    return tarfile.open(fileobj=io.BytesIO(archive_bytes), mode="r:gz")


def store(rel, content):
    """Write one vendored file after checking it against its pin.

    Args:
        rel: Path relative to ``VENDOR``.
        content: The file's bytes.

    Side Effects:
        Writes the file and a line to stdout; exits on a mismatch.
    """
    if PINS.get(rel) != sha256(content):
        sys.exit(f"sha256 mismatch: {rel}")
    path = VENDOR / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    print(f"ok {rel} {len(content)}")


def member_bytes(archive, name):
    """Read one tar member by exact name, so nothing is extracted to a path it chose.

    Args:
        archive: The open tar archive.
        name: Exact member name.

    Returns:
        The member's bytes.

    Side Effects:
        None.
    """
    return archive.extractfile(name).read()


def download(url):
    """Fetch a URL.

    Args:
        url: URL to fetch.

    Returns:
        The response body.

    Side Effects:
        Makes a network request.
    """
    request = urllib.request.Request(url, headers={"User-Agent": "mpesa-analytics-vendor"})
    with urllib.request.urlopen(request, timeout=DOWNLOAD_TIMEOUT_SECONDS) as response:
        return response.read()


def sha256(content):
    """Hash bytes.

    Args:
        content: Bytes to hash.

    Returns:
        Lowercase hex digest.

    Side Effects:
        None.
    """
    return hashlib.sha256(content).hexdigest()


FETCHERS = {
    "pyodide": fetch_pyodide,
    "pdfjs": fetch_pdfjs,
    "gitleaks": fetch_gitleaks,
    "node": fetch_node,
}


if __name__ == "__main__":
    sys.exit(main())
