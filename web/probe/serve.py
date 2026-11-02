#!/usr/bin/env python3
"""Loopback static server for web/, with the CSP variants the pandas probe tests."""

import argparse
import gzip
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

WEB = Path(__file__).resolve().parents[1]
GZIP_LEVEL = 9
NOT_FOUND = 404
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


def main():
    """Parse arguments and serve until interrupted.

    Side Effects:
        Binds a loopback port, prints the probe URL and serves forever.
    """
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--csp", choices=CSP, default="none")
    parser.add_argument("--no-gzip", action="store_true")
    args = parser.parse_args()
    handler = partial(Handler, csp=CSP[args.csp], use_gzip=not args.no_gzip, packed={})
    server = ThreadingHTTPServer(("127.0.0.1", args.port), handler)
    sys.stdout.write(f"http://127.0.0.1:{server.server_port}/probe/\n")
    sys.stdout.flush()
    server.serve_forever()


class Handler(SimpleHTTPRequestHandler):
    """Serve web/ with explicit caching, optional gzip and the CSP under test."""

    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, **TYPES}

    def __init__(self, *args, csp, use_gzip, packed, **kwargs):
        """Store per-server settings before the base class handles the request.

        Args:
            *args: Positional arguments for the base handler.
            csp: Content-Security-Policy value, or None for no header.
            use_gzip: Whether to compress when the client accepts it.
            packed: Cache of compressed bodies, shared between requests.
            **kwargs: Keyword arguments for the base handler.

        Side Effects:
            Handles the request, because the base class does so on construction.
        """
        self.csp = csp
        self.use_gzip = use_gzip
        self.packed = packed
        super().__init__(*args, directory=str(WEB), **kwargs)

    def do_GET(self):
        """Serve one file with the probe's headers.

        Side Effects:
            Reads the file and writes the HTTP response.
        """
        path = Path(self.translate_path(self.path))
        if path.is_dir():
            path = path / "index.html"
        if path.is_file():
            self._send_file(path)
        else:
            self.send_error(NOT_FOUND)

    def log_message(self, *args):
        """Discard the access log, which the probe does not need.

        Args:
            *args: The base class's format string and values.

        Side Effects:
            None.
        """

    def _send_file(self, path):
        """Send one existing file with caching, compression and CSP headers.

        Args:
            path: Path of the file.

        Side Effects:
            Reads the file and writes the HTTP response.
        """
        body = path.read_bytes()
        self.send_response(200)
        if self.use_gzip and "gzip" in self.headers.get("Accept-Encoding", ""):
            body = self._compressed(path, body)
            self.send_header("Content-Encoding", "gzip")
            self.send_header("Vary", "Accept-Encoding")
        self.send_header("Content-Type", self.guess_type(str(path)))
        self.send_header("Content-Length", str(len(body)))
        # Lets a reload be a true warm start; a cold start needs a fresh or cache-disabled profile.
        self.send_header("Cache-Control", "public, max-age=86400")
        if self.csp:
            self.send_header("Content-Security-Policy", self.csp)
        self.end_headers()
        self.wfile.write(body)

    def _compressed(self, path, body):
        """Compress a body once, since level 9 on the wasm file takes a noticeable time.

        Args:
            path: The file's path, used as the cache key.
            body: The file's bytes.

        Returns:
            The gzip-compressed bytes.

        Side Effects:
            Adds to the shared compressed-body cache.
        """
        if path not in self.packed:
            self.packed[path] = gzip.compress(body, GZIP_LEVEL, mtime=0)
        return self.packed[path]


if __name__ == "__main__":
    main()
