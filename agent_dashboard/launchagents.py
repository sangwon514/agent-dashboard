"""macOS LaunchAgent installer for agent-dashboard.

Registers two agents:
  - com.user.agent-dashboard.web      → `agent-dashboard serve`
  - com.user.agent-dashboard.menubar  → `agent-dashboard menubar`
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

LAUNCH_DIR = Path.home() / "Library" / "LaunchAgents"
LOG_DIR = Path.home() / "agent-dashboard" / "logs"
WEB_LABEL = "com.user.agent-dashboard.web"
MENUBAR_LABEL = "com.user.agent-dashboard.menubar"


def _python() -> str:
    return sys.executable


def _plist(label: str, args: list[str], log_name: str) -> str:
    args_xml = "\n    ".join(f"<string>{a}</string>" for a in args)
    return f'''<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>{label}</string>
  <key>ProgramArguments</key>
  <array>
    {args_xml}
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>{LOG_DIR}/{log_name}.out.log</string>
  <key>StandardErrorPath</key><string>{LOG_DIR}/{log_name}.err.log</string>
</dict>
</plist>
'''


def _bootstrap(plist: Path) -> None:
    label = plist.stem
    uid = os.getuid()
    target = f"gui/{uid}"
    subprocess.run(
        ["launchctl", "bootout", target, str(plist)],
        capture_output=True,
        check=False,
    )
    res = subprocess.run(
        ["launchctl", "bootstrap", target, str(plist)],
        capture_output=True,
        text=True,
        check=False,
    )
    if res.returncode != 0:
        sys.stderr.write(
            f"[warn] launchctl bootstrap {label} returned {res.returncode}: "
            f"{res.stderr.strip() or res.stdout.strip()}\n"
            "       Falling back to launchctl load.\n"
        )
        subprocess.run(["launchctl", "unload", str(plist)], capture_output=True, check=False)
        subprocess.run(["launchctl", "load", str(plist)], capture_output=True, check=False)


def install(*, include_menubar: bool = True) -> None:
    LAUNCH_DIR.mkdir(parents=True, exist_ok=True)
    LOG_DIR.mkdir(parents=True, exist_ok=True)

    py = _python()

    web_plist = LAUNCH_DIR / f"{WEB_LABEL}.plist"
    web_plist.write_text(_plist(WEB_LABEL, [py, "-m", "agent_dashboard", "serve"], "web"))
    _bootstrap(web_plist)
    print(f"[ok] {web_plist}")

    if include_menubar:
        try:
            import rumps  # noqa: F401
        except ImportError:
            print(
                "[skip] rumps not installed — menubar agent NOT installed.\n"
                "       Install with: pip install -e \".[menubar]\"  then re-run install-launchagents.",
                file=sys.stderr,
            )
        else:
            mb_plist = LAUNCH_DIR / f"{MENUBAR_LABEL}.plist"
            mb_plist.write_text(_plist(MENUBAR_LABEL, [py, "-m", "agent_dashboard", "menubar"], "menubar"))
            _bootstrap(mb_plist)
            print(f"[ok] {mb_plist}")

    print(f"\nLogs: {LOG_DIR}/")
    print("Web:  http://127.0.0.1:7878")
    print("\nTo uninstall: agent-dashboard uninstall-launchagents")


def uninstall() -> None:
    uid = os.getuid()
    target = f"gui/{uid}"
    for label in (WEB_LABEL, MENUBAR_LABEL):
        plist = LAUNCH_DIR / f"{label}.plist"
        if plist.exists():
            subprocess.run(
                ["launchctl", "bootout", target, str(plist)],
                capture_output=True,
                check=False,
            )
            subprocess.run(["launchctl", "unload", str(plist)], capture_output=True, check=False)
            plist.unlink()
            print(f"[removed] {plist}")
        else:
            print(f"[skip] {plist} not found")


def status() -> None:
    res = subprocess.run(
        ["launchctl", "list"], capture_output=True, text=True, check=False
    )
    lines = [ln for ln in res.stdout.splitlines() if "agent-dashboard" in ln]
    if not lines:
        print("(no agent-dashboard launchctl entries)")
        return
    for ln in lines:
        print(ln)
