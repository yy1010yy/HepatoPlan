"""Serve the project's static directory with the case cache policy."""

import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import re
from urllib.parse import urlsplit

from .case_selection import PUBLIC_DIRECTORY


RELEASE_ASSET = re.compile(
    r"/cases/releases/[a-z0-9-]+/(?:ATTRIBUTION\.txt|"
    r"[a-z0-9-]+/(?:metadata\.json|labels\.bin|liver\.stl|tumour\.stl))"
)


class PreviewHandler(SimpleHTTPRequestHandler):
    def send_response(self, code, message=None):
        super().send_response(code, message)
        if code in (200, 304):
            path = urlsplit(self.path).path
            if path == "/cases/index.json":
                self.send_header("Cache-Control", "no-cache")
            elif RELEASE_ASSET.fullmatch(path):
                self.send_header("Cache-Control", "public, max-age=31536000, immutable")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    handler = partial(PreviewHandler, directory=str(PUBLIC_DIRECTORY))
    with ThreadingHTTPServer(("127.0.0.1", args.port), handler) as server:
        print(f"Serving {PUBLIC_DIRECTORY} at http://127.0.0.1:{server.server_port}", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
