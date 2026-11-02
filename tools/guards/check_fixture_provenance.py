#!/usr/bin/env python3
"""Guard 4: every fixture regenerates byte-identically from its manifest seed."""

import hashlib
import sys
import tomllib
from pathlib import PurePosixPath

from _common import REPO, SYNTHETIC, iter_files, parse_root, report

sys.path.insert(0, str(REPO / "tools" / "synth"))
import generate as generator  # noqa: E402

MANIFEST = f"{SYNTHETIC}MANIFEST.toml"
IGNORED = {MANIFEST, f"{SYNTHETIC}.gitkeep"}


def check(root):
    findings = {}
    path = root / MANIFEST
    if not path.is_file():
        return {MANIFEST: 1}
    manifest = tomllib.loads(path.read_text(encoding="utf-8"))
    if manifest.get("generator_version") != generator.VERSION or "fake_password" not in manifest:
        findings[MANIFEST] = 1
    listed = set()
    for entry in manifest.get("fixture", []):
        name = entry["path"]
        if ".." in PurePosixPath(name).parts or PurePosixPath(name).is_absolute():
            findings[MANIFEST] = findings.get(MANIFEST, 0) + 1
            continue
        rel = f"{SYNTHETIC}{name}"
        listed.add(rel)
        target = root / rel
        if not target.is_file():
            findings[rel] = 1
            continue
        actual = target.read_bytes()
        same_bytes = actual == generator.generate(entry["seed"], name)
        same_hash = hashlib.sha256(actual).hexdigest() == entry["sha256"]
        if not (same_bytes and same_hash):
            findings[rel] = 1
    for rel in iter_files(root):
        if rel.startswith(SYNTHETIC) and rel not in listed and rel not in IGNORED:
            findings[rel] = 1
    return findings


def main():
    args = parse_root(__doc__).parse_args()
    return report("check_fixture_provenance", check(args.root), "provenance mismatch(es)")


if __name__ == "__main__":
    sys.exit(main())
