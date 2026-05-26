"""py2app build script — produces dist/agent-dashboard.app.

Invoked via:
    agent-dashboard build-app
    # or directly:
    python setup_py2app.py py2app

The resulting .app bundles a frozen copy of this venv's Python plus all
runtime deps, so the user who installs it does NOT need Python.
"""
from setuptools import setup

APP = ["agent_dashboard/_app_launcher.py"]

OPTIONS = {
    "argv_emulation": False,
    "packages": [
        "agent_dashboard",
        "fastapi",
        "starlette",
        "uvicorn",
        "watchdog",
        "sse_starlette",
        "anyio",
        "webview",
    ],
    "includes": [
        "websockets",
        "h11",
        "httptools",
        "click",
    ],
    "excludes": [
        "tkinter",
        "PyQt5",
        "PyQt6",
        "PySide2",
        "PySide6",
    ],
    "plist": {
        "CFBundleName": "agent-dashboard",
        "CFBundleDisplayName": "agent-dashboard",
        "CFBundleIdentifier": "com.user.agent-dashboard",
        "CFBundleShortVersionString": "0.1.0",
        "CFBundleVersion": "0.1.0",
        "LSMinimumSystemVersion": "12.0",
        "NSHighResolutionCapable": True,
        "LSUIElement": False,
    },
}

setup(
    name="agent-dashboard",
    app=APP,
    options={"py2app": OPTIONS},
)
