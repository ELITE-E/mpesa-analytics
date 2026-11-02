#!/usr/bin/env python3
"""Loopback static server for web/, with the CSP variants the pandas probe tests."""

import argparse
import gzip
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

WEB = Path(__file__).resolve().parents[1]
CSP = {
    "none": None,
    "strict": "script-src 'self' 'wasm-unsafe-eval'",
    "no-wasm": "script-src 'self'",
}
TYPES = {
    ".mjs": "text/javascript",
    ".js": "text/javascript",
    ".wasm": "application/wasm",
    ".whl": "application/zip",
    ".zip": "application/zip",
    ".json": "application/json",
}


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, **TYPES}

    def __init__(self, *args, csp, use_gzip, packed, **kwargs):
        self.csp = csp
        self.use_gzip = use_gzip
        self.packed = packed
        super().__init__(*args, directory=str(WEB), **kwargs)

    def do_GET(self):
        path = Path(self.translate_path(self.path))
        if path.is_dir():
            path = path / "index.html"
        if not path.is_file():
            self.send_error(404)
            return
        data = path.read_bytes()
        accepts = "gzip" in self.headers.get("Accept-Encoding", "")
        self.send_response(200)
        if self.use_gzip and accepts:
            if path not in self.packed:
                self.packed[path] = gzip.compress(data, 9, mtime=0)
            data = self.packed[path]
            self.send_header("Content-Encoding", "gzip")
            self.send_header("Vary", "Accept-Encoding")
        self.send_header("Content-Type", self.guess_type(str(path)))
        self.send_header("Content-Length", str(len(data)))
        # Lets a reload be a true warm start; a cold start needs a fresh or cache-disabled profile.
        self.send_header("Cache-Control", "public, max-age=86400")
        if self.csp:
            self.send_header("Content-Security-Policy", self.csp)
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args):
        pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--csp", choices=CSP, default="none")
    parser.add_argument("--no-gzip", action="store_true")
    args = parser.parse_args()
    handler = partial(Handler, csp=CSP[args.csp], use_gzip=not args.no_gzip, packed={})
    server = ThreadingHTTPServer(("127.0.0.1", args.port), handler)
    print(f"http://127.0.0.1:{server.server_port}/probe/", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
