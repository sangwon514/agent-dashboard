"""Native macOS window mode (pywebview).

Runs the FastAPI server in a background thread on a free local port and
displays the existing web UI inside a native WebKit window — no browser,
no terminal needed. Used by the bundled ``.app`` and by ``agent-dashboard app``.
"""
from __future__ import annotations

import logging
import os
import socket
import sys
import threading
import time
from urllib.request import urlopen

log = logging.getLogger("agent-dashboard.app")


def _pick_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _wait_until_ready(url: str, timeout: float = 10.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with urlopen(url, timeout=0.5) as resp:
                if resp.status < 500:
                    return True
        except Exception:
            time.sleep(0.1)
    return False


def _serve_in_background(host: str, port: int) -> threading.Thread:
    import uvicorn

    from .ui_web.server import make_app

    config = uvicorn.Config(
        make_app(),
        host=host,
        port=port,
        log_level="warning",
        access_log=False,
    )
    server = uvicorn.Server(config)

    def _run() -> None:
        try:
            server.run()
        except Exception:
            log.exception("uvicorn crashed")

    t = threading.Thread(target=_run, name="agent-dashboard-uvicorn", daemon=True)
    t.start()
    return t


def run() -> None:
    try:
        import webview
    except ImportError:
        sys.stderr.write(
            "pywebview is not installed.\n"
            "Install with:  pip install -e \".[app]\"\n"
        )
        sys.exit(2)

    logging.basicConfig(
        level=os.environ.get("AGENT_DASHBOARD_LOG", "INFO"),
        format="%(asctime)s %(name)s %(levelname)s %(message)s",
    )

    host = "127.0.0.1"
    port = int(os.environ.get("AGENT_DASHBOARD_APP_PORT", "0")) or _pick_free_port()
    url = f"http://{host}:{port}"

    _serve_in_background(host, port)
    if not _wait_until_ready(url):
        sys.stderr.write(f"server did not become ready at {url}\n")
        sys.exit(1)

    log.info("opening native window → %s", url)
    webview.create_window(
        title="agent-dashboard",
        url=url,
        width=1100,
        height=720,
        min_size=(720, 480),
    )
    webview.start()


if __name__ == "__main__":
    run()
