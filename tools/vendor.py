#!/usr/bin/env python3
"""Fetch and checksum the pinned runtime. Output is gitignored, never committed.

Commands:
    fetch [pyodide|pdfjs|gitleaks|node ...]: Download and verify against PINS.
    verify: Re-hash what is already on disk.
    table: Print sha256 and size for docs.
"""

import argparse
import base64
import hashlib
import io
import shutil
import sys
import tarfile
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
VENDOR = REPO / "web" / "public" / "vendor"
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

PINS = dict(
    (
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
    parser.add_argument("command", choices=["fetch", "verify", "table"])
    parser.add_argument("targets", nargs="*", choices=[[], *FETCHERS], default=[])
    args = parser.parse_args()
    if args.command == "verify":
        return verify()
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
    """Vendor the pdf.js build files from npm.

    Side Effects:
        Downloads the package and writes under ``VENDOR``; exits on a checksum mismatch.
    """
    with fetch_tgz(PDFJS_TGZ) as archive:
        for rel in GROUPS["pdfjs"]:
            store(rel, member_bytes(archive, f"package/build/{rel.removeprefix('pdfjs/')}"))


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
