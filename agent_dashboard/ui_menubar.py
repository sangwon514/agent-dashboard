"""macOS menubar app (rumps).

Polls the local web server's /api/snapshot. Requires the web server to be running
(via `agent-dashboard serve` or the LaunchAgent).

Install rumps separately:
    pip install -e ".[menubar]"
"""
from __future__ import annotations

import json
import os
import shlex
import subprocess
import sys
import urllib.error
import urllib.request
import webbrowser

try:
    import rumps  # type: ignore
except ImportError:  # pragma: no cover
    rumps = None  # type: ignore

DASHBOARD_URL = os.environ.get("AGENT_DASHBOARD_URL", "http://127.0.0.1:7878")
POLL_SEC = int(os.environ.get("AGENT_DASHBOARD_MENUBAR_POLL", "3"))
NOTIFY_ON_FAIL = os.environ.get("AGENT_DASHBOARD_NOTIFY", "1") not in ("0", "false", "False", "")


def _osa_notify(title: str, subtitle: str, message: str) -> None:
    """Show a macOS notification via osascript. Best-effort."""
    if not NOTIFY_ON_FAIL:
        return
    script = (
        f'display notification {shlex.quote(message)} '
        f'with title {shlex.quote(title)} subtitle {shlex.quote(subtitle)}'
    )
    try:
        subprocess.run(
            ["osascript", "-e", script],
            capture_output=True,
            check=False,
            timeout=2,
        )
    except (OSError, subprocess.TimeoutExpired):
        pass


def _fetch_snapshot() -> dict | None:
    try:
        with urllib.request.urlopen(f"{DASHBOARD_URL}/api/snapshot", timeout=2) as r:
            return json.loads(r.read())
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError):
        return None


def _counts(snap: dict) -> tuple[int, int, int]:
    r = d = f = 0
    for s in snap.get("sessions", []):
        for e in s.get("events", []):
            st = e.get("status")
            if st == "running":
                r += 1
            elif st == "done":
                d += 1
            elif st == "failed":
                f += 1
    return r, d, f


if rumps is not None:

    class _App(rumps.App):
        def __init__(self):
            super().__init__("AD", title="AD", quit_button="Quit agent-dashboard")
            self.menu = ["Open Web Dashboard", None, rumps.MenuItem("(loading…)", callback=None)]
            self._seen_failures: set[str] = set()
            self._first_tick = True
            rumps.Timer(self._tick, POLL_SEC).start()

        def _tick(self, _):
            snap = _fetch_snapshot()
            if snap is None:
                self.title = "AD ⚠"
                self._set_items([rumps.MenuItem("dashboard offline", callback=None)])
                return

            # Detect newly observed failures and notify (skip first tick to avoid backlog flood)
            current_failures = {
                e.get("tool_use_id", ""): (s, e)
                for s in snap.get("sessions", [])
                for e in s.get("events", [])
                if e.get("status") == "failed" and e.get("tool_use_id")
            }
            if self._first_tick:
                self._seen_failures = set(current_failures.keys())
                self._first_tick = False
            else:
                new_ids = set(current_failures.keys()) - self._seen_failures
                for tu_id in new_ids:
                    s, e = current_failures[tu_id]
                    proj = s.get("project_display") or s.get("project_slug") or "?"
                    sub = e.get("subagent_type") or "(fork)"
                    desc = (e.get("description") or e.get("prompt_first_line") or "")[:120]
                    _osa_notify(f"agent failed: {sub}", proj, desc or "(no description)")
                self._seen_failures |= new_ids

            r, d, f = _counts(snap)
            if r > 0:
                self.title = f"AD ▶{r}"
            elif f > 0:
                self.title = f"AD ✗{f}"
            elif d > 0:
                self.title = f"AD ✓{d}"
            else:
                self.title = "AD"

            items = [
                rumps.MenuItem(f"Running: {r}", callback=None),
                rumps.MenuItem(f"Done:    {d}", callback=None),
                rumps.MenuItem(f"Failed:  {f}", callback=None),
                None,
            ]
            active = [
                s for s in snap.get("sessions", [])
                if any(e.get("status") == "running" for e in s.get("events", []))
            ]
            if active:
                items.append(rumps.MenuItem("— Active sessions —", callback=None))
                for s in active[:8]:
                    proj = s.get("project_display") or s.get("project_slug") or "?"
                    sid = (s.get("session_id") or "")[:6]
                    rc = sum(1 for e in s.get("events", []) if e.get("status") == "running")
                    items.append(rumps.MenuItem(f"  {proj} ({sid}) ▶{rc}", callback=None))

            self._set_items(items)

        def _set_items(self, items):
            keep = "Open Web Dashboard"
            for k in list(self.menu.keys()):
                if k != keep:
                    try:
                        del self.menu[k]
                    except (KeyError, ValueError):
                        pass
            for it in items:
                if it is None:
                    self.menu.add(rumps.separator)
                else:
                    self.menu.add(it)

        @rumps.clicked("Open Web Dashboard")
        def _open(self, _):
            webbrowser.open(DASHBOARD_URL)


def run() -> None:
    if rumps is None:
        print("rumps not installed. Install with: pip install -e \".[menubar]\"", file=sys.stderr)
        sys.exit(1)
    _App().run()


if __name__ == "__main__":
    run()
