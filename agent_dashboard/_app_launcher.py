"""Entry point for the bundled .app (launched by py2app).

Routes logs to ~/Library/Logs/agent-dashboard/ (Apple convention) and starts
the native pywebview window. Kept tiny so py2app freezes only what it needs.
"""
from __future__ import annotations

import logging
import os
from pathlib import Path


def main() -> None:
    log_dir = Path.home() / "Library" / "Logs" / "agent-dashboard"
    log_dir.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(
        filename=str(log_dir / "app.log"),
        level=os.environ.get("AGENT_DASHBOARD_LOG", "INFO"),
        format="%(asctime)s %(name)s %(levelname)s %(message)s",
    )
    from agent_dashboard.ui_app import run
    run()


if __name__ == "__main__":
    main()
