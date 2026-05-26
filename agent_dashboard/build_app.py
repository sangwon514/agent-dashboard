"""Build a distributable .app bundle via py2app.

Runs ``python setup_py2app.py py2app`` under the active interpreter.
Produces ``dist/agent-dashboard.app``.

py2app inherits ``install_requires`` from PEP 621 ``pyproject.toml`` and then
errors out because newer setuptools removed support for the field on
``setup()``. As a workaround we hide the ``pyproject.toml`` for the duration
of the build.
"""
from __future__ import annotations

import shutil
import subprocess
import sys
from contextlib import contextmanager
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SETUP = ROOT / "setup_py2app.py"
PYPROJECT = ROOT / "pyproject.toml"
PYPROJECT_HIDDEN = ROOT / "pyproject.toml.bak-py2app"


def _check_py2app() -> None:
    try:
        import py2app  # noqa: F401
    except ImportError:
        sys.stderr.write(
            "py2app is not installed.\n"
            "Install with:  pip install -e \".[app,build]\"\n"
        )
        sys.exit(2)


@contextmanager
def _hide_pyproject():
    """Temporarily move pyproject.toml aside so py2app does not see it."""
    moved = False
    if PYPROJECT.exists():
        PYPROJECT.rename(PYPROJECT_HIDDEN)
        moved = True
    try:
        yield
    finally:
        if moved and PYPROJECT_HIDDEN.exists():
            PYPROJECT_HIDDEN.rename(PYPROJECT)


def build() -> None:
    _check_py2app()
    if not SETUP.exists():
        sys.stderr.write(f"missing setup_py2app.py: {SETUP}\n")
        sys.exit(2)

    build_dir = ROOT / "build"
    dist_dir = ROOT / "dist"
    if build_dir.exists():
        shutil.rmtree(build_dir)
    if dist_dir.exists():
        shutil.rmtree(dist_dir)

    cmd = [sys.executable, str(SETUP), "py2app"]
    print(f"$ {' '.join(cmd)}")
    with _hide_pyproject():
        rc = subprocess.run(cmd, cwd=str(ROOT)).returncode
    if rc != 0:
        sys.exit(rc)

    app = dist_dir / "agent-dashboard.app"
    if not app.exists():
        sys.stderr.write(f"build finished but {app} is missing\n")
        sys.exit(1)
    print(f"\n[ok] built {app}")
    print("Open it:    open dist/agent-dashboard.app")
    print("Install it: mv dist/agent-dashboard.app /Applications/")


if __name__ == "__main__":
    build()
