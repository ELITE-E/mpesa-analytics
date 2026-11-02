#!/usr/bin/env python3
"""Fetch and checksum the pinned runtime. Output is gitignored, never committed.

    vendor.py fetch [pyodide|pdfjs|gitleaks ...]   download and verify against PINS
    vendor.py verify                               re-hash what is already on disk
    vendor.py table                                print sha256 and size for docs
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

PYODIDE_VERSION = "314.0.7"
PDFJS_VERSION = "6.4.299"
GITLEAKS_VERSION = "8.30.1"

NPM = "https://registry.npmjs.org"
PYODIDE_TGZ = f"{NPM}/pyodide/-/pyodide-{PYODIDE_VERSION}.tgz"
PYODIDE_CDN = f"https://cdn.jsdelivr.net/pyodide/v{PYODIDE_VERSION}/full"
PDFJS_TGZ = f"{NPM}/pdfjs-dist/-/pdfjs-dist-{PDFJS_VERSION}.tgz"
GITLEAKS_TGZ = (
    "https://github.com/gitleaks/gitleaks/releases/download/"
    f"v{GITLEAKS_VERSION}/gitleaks_{GITLEAKS_VERSION}_linux_x64.tar.gz"
)

# npm's own dist.integrity values, checked before anything is unpacked.
NPM_INTEGRITY = {
    PYODIDE_TGZ: "sha512-0YvXxEhfEdpLfb/XkM2BFAeMROq0iMUX2bzzH9pOttyMcWkwq+HbE5uyuGD82LN7y2q+SNvi/6V5JEsOlD2R1A==",
    PDFJS_TGZ: "sha512-AVl138zALtfaAPvADulE0PZThbYzCBS79nL4pOSL/6Sm/4AH5A21BD9VHt97OlCuzJuCpmeZtAtkinisF4Vb1g==",
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
}

PINS = {
    "pyodide/pyodide.mjs": "6f1d60f7bf529beb300f0f47983c921d3982363640ba20af0e38efdddbc66109",
    "pyodide/pyodide.asm.mjs": "f7cdc8ece80678ceb712f8e65ebe6d3a83203a180c399865f49612a051693635",
    "pyodide/pyodide.asm.wasm": "cc36e3cab04fdfc9a63ff13eb52eae2b911bf46c025cc7b281f394bd3de1d5e6",
    "pyodide/python_stdlib.zip": "fa1957e5777068fc4f7437f96d860ae2fbe9c19732ba06c84e004ec16dd7dd7a",
    "pyodide/pyodide-lock.json": "5dc2fc119108bc148c7457dc86e7675b5c87e1cafd420b9c34c1eaef7b36c010",
    "pyodide/numpy-2.4.6-cp314-cp314-pyemscripten_2026_0_wasm32.whl": "a292c1f5d7d8a2208cd5e94fc467604c131cabcd2fc14fed6eefde121e7fabdf",
    "pyodide/pandas-3.0.2-cp314-cp314-pyemscripten_2026_0_wasm32.whl": "45ff57772cc2f366a8582c7d3097cc4e6676342ecd5a3c08184a43462d5a02ae",
    "pyodide/python_dateutil-2.9.0.post0-py2.py3-none-any.whl": "9b13365edf9c188f570baf9c540bbb3029ada2a2dacb9694b3659941693ee9e5",
    "pyodide/pytz-2026.1.post1-py2.py3-none-any.whl": "b8249d6450146e0b61e6d710dc02ebb35a904796c4c2f97fe87d4ac5872db36a",
    "pyodide/six-1.17.0-py2.py3-none-any.whl": "228c50f73aa7addf2c2ccf2979c256802a59ab69cad8152b31b9443cc8140f42",
    "pdfjs/pdf.min.mjs": "57456c8e0c81e46be31174b499ef77f2b9f5ee46d04412ba627320a36755d4c2",
    "pdfjs/pdf.worker.min.mjs": "9536359f1b8367850d485731ca1d5e45c159a7b7a0912325e539937aa21ceb18",
}
GITLEAKS_SHA256 = "551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb"


def download(url):
    request = urllib.request.Request(url, headers={"User-Agent": "mpesa-analytics-vendor"})
    with urllib.request.urlopen(request, timeout=120) as response:
        return response.read()


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def fetch_tgz(url):
    data = download(url)
    digest = "sha512-" + base64.b64encode(hashlib.sha512(data).digest()).decode()
    if digest != NPM_INTEGRITY[url]:
        sys.exit(f"integrity mismatch: {url}")
    return tarfile.open(fileobj=io.BytesIO(data), mode="r:gz")


def store(rel, data):
    pinned = PINS.get(rel)
    if pinned != sha256(data):
        sys.exit(f"sha256 mismatch: {rel}")
    path = VENDOR / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    print(f"ok {rel} {len(data)}")


def member_bytes(archive, name):
    # Members are read by exact name and written to paths we choose; nothing is extracted.
    return archive.extractfile(name).read()


def fetch_pyodide():
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
    with fetch_tgz(PDFJS_TGZ) as archive:
        for rel in GROUPS["pdfjs"]:
            store(rel, member_bytes(archive, f"package/build/{rel.removeprefix('pdfjs/')}"))


def fetch_gitleaks():
    data = download(GITLEAKS_TGZ)
    if sha256(data) != GITLEAKS_SHA256:
        sys.exit("sha256 mismatch: gitleaks")
    BIN.mkdir(parents=True, exist_ok=True)
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:
        (BIN / "gitleaks").write_bytes(member_bytes(archive, "gitleaks"))
    (BIN / "gitleaks").chmod(0o755)
    print(f"ok gitleaks {len(data)}")


def verify():
    bad = 0
    for rel, pinned in sorted(PINS.items()):
        path = VENDOR / rel
        if not path.is_file() or sha256(path.read_bytes()) != pinned:
            print(f"BAD {rel}")
            bad += 1
    print(f"verified {len(PINS) - bad}/{len(PINS)}")
    return 1 if bad else 0


def table():
    for group, members in GROUPS.items():
        for rel in members:
            data = (VENDOR / rel).read_bytes()
            print(f"| {group} | `{rel}` | {len(data)} | `{sha256(data)}` |")
    return 0


FETCHERS = {"pyodide": fetch_pyodide, "pdfjs": fetch_pdfjs, "gitleaks": fetch_gitleaks}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["fetch", "verify", "table"])
    parser.add_argument("targets", nargs="*", choices=[[], *FETCHERS], default=[])
    args = parser.parse_args()
    if args.command == "verify":
        return verify()
    if args.command == "table":
        return table()
    for target in args.targets or FETCHERS:
        if shutil.which("gitleaks") and target == "gitleaks":
            print("gitleaks already on PATH")
            continue
        FETCHERS[target]()
    return 0


if __name__ == "__main__":
    sys.exit(main())
