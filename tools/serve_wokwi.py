#!/usr/bin/env python
"""Serve the wokwi/ folder over HTTP so the Wokwi online editor can fetch it.

Useful when pasting large files into the web editor is impractical: the
editor page (https://wokwi.com) is allowed to fetch http://localhost, and this
server adds the CORS headers that a plain ``python -m http.server`` lacks.

Usage:
    python tools/serve_wokwi.py [--port 8765]
"""
from __future__ import annotations

import argparse
import functools
import http.server
import os
import socketserver
from pathlib import Path


class CorsHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_OPTIONS(self) -> None:  # noqa: N802 - stdlib naming
        self.send_response(204)
        self.end_headers()

    def log_message(self, fmt: str, *args) -> None:  # noqa: ANN002
        print(f"{self.address_string()} - {fmt % args}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument(
        "--dir",
        default=str(Path(__file__).resolve().parent.parent / "wokwi"),
        help="Directory to serve (default: ../wokwi)",
    )
    args = parser.parse_args()

    os.chdir(args.dir)
    handler = functools.partial(CorsHandler, directory=args.dir)
    with socketserver.TCPServer(("127.0.0.1", args.port), handler) as httpd:
        print(f"Serving {args.dir} on http://localhost:{args.port} (Ctrl+C to stop)")
        httpd.serve_forever()


if __name__ == "__main__":
    main()
