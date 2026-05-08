"""agent-dashboard CLI entry point.

Usage:
  agent-dashboard                       # default: serve web (alias of `serve`)
  agent-dashboard serve                 # web server on http://127.0.0.1:7878
  agent-dashboard tui                   # rich TUI (terminal)
  agent-dashboard menubar               # macOS menubar (requires rumps)
  agent-dashboard install-launchagents  # register web+menubar as LaunchAgents
  agent-dashboard uninstall-launchagents
  agent-dashboard status                # show launchctl entries for agent-dashboard
  agent-dashboard help
"""
from __future__ import annotations

import sys


_USAGE = """\
agent-dashboard — live monitor for Claude Code subagents.

  serve                  start the web server (default)
  tui                    rich terminal UI
  menubar                macOS menubar app
  install-launchagents   register web + menubar to launch at login
  uninstall-launchagents
  status                 show launchctl entries
  help
"""


def main() -> None:
    args = sys.argv[1:]
    cmd = args[0] if args else "serve"

    if cmd in ("serve", "web", "run"):
        from .ui_web.server import main as run_web
        run_web()
    elif cmd in ("tui",):
        from .ui_tui import run as run_tui
        run_tui()
    elif cmd in ("menubar", "mb"):
        from .ui_menubar import run as run_menubar
        run_menubar()
    elif cmd in ("install-launchagents", "install"):
        from .launchagents import install
        install()
    elif cmd in ("uninstall-launchagents", "uninstall"):
        from .launchagents import uninstall
        uninstall()
    elif cmd in ("status",):
        from .launchagents import status
        status()
    elif cmd in ("-h", "--help", "help"):
        print(_USAGE)
    else:
        print(f"unknown command: {cmd}\n", file=sys.stderr)
        print(_USAGE, file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    main()
