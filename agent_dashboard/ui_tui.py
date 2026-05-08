from __future__ import annotations

import time

from rich.console import Console
from rich.live import Live
from rich.table import Table

from .core.store import Store
from .core.watcher import JsonlWatcher
from .core.wt_status import WtStatusWatcher

_STATUS = {
    "running": "[bold cyan]RUN[/]",
    "done": "[bold green]DONE[/]",
    "failed": "[bold red]FAIL[/]",
    "stale": "[dim]STALE[/]",
    "orphaned": "[yellow]ORPH[/]",
}


def _build(snap: dict) -> Table:
    t = Table(title="agent-dashboard (TUI) · live", show_lines=False, expand=True)
    t.add_column("Project", style="bold yellow", width=28)
    t.add_column("Session", width=10, style="dim")
    t.add_column("Subagent", style="magenta", width=20)
    t.add_column("Status", width=6, justify="center")
    t.add_column("Description", width=50)
    t.add_column("Dur", width=8, justify="right", style="dim")

    sessions = [s for s in snap.get("sessions", []) if s.get("events")]
    sessions.sort(key=lambda s: s.get("last_activity", ""), reverse=True)

    rows = 0
    for s in sessions:
        proj = s.get("project_display") or s.get("project_slug") or "?"
        sid = (s.get("session_id") or "")[:8]
        events = sorted(
            s["events"],
            key=lambda e: (0 if e.get("status") == "running" else 1, -1 * len(e.get("started_at") or "")),
        )
        for i, e in enumerate(events):
            label = _STATUS.get(e.get("status", "?"), e.get("status", "?"))
            dur = e.get("duration_sec")
            dur_s = f"{int(dur)}s" if isinstance(dur, (int, float)) else ""
            desc = e.get("description") or e.get("prompt_first_line") or ""
            sub = e.get("subagent_type") or "fork"
            t.add_row(
                proj if i == 0 else "",
                sid if i == 0 else "",
                sub[:20],
                label,
                desc[:50],
                dur_s,
            )
            rows += 1

    if rows == 0:
        t.add_row("[dim](no agent activity yet)[/]", "", "", "", "", "")

    wt = snap.get("wt_status", [])
    if wt:
        t.add_section()
        for w in wt:
            for i, task in enumerate(w.get("tasks", [])):
                t.add_row(
                    f"WT:{w.get('worktree','?')}" if i == 0 else "",
                    "",
                    w.get("domain", "") if i == 0 else "",
                    f"[dim]{str(task.get('status',''))[:6]}[/]",
                    str(task.get("name", ""))[:50],
                    "",
                )

    return t


def run() -> None:
    store = Store()
    js_watcher = JsonlWatcher(store.update_transcript)
    wt_watcher = WtStatusWatcher(store.update_wt_status)
    js_watcher.start()
    wt_watcher.start()
    console = Console()
    try:
        with Live(_build(store.snapshot()), console=console, refresh_per_second=1) as live:
            while True:
                time.sleep(2)
                live.update(_build(store.snapshot()))
    except KeyboardInterrupt:
        console.print("\n[dim]agent-dashboard stopped.[/]")
    finally:
        js_watcher.stop()
        wt_watcher.stop()


if __name__ == "__main__":
    run()
