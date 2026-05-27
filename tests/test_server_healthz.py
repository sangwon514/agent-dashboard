import asyncio
import json

from agent_dashboard.ui_web.server import make_app


def _call_healthz(app):
    route = next(route for route in app.routes if getattr(route, "path", None) == "/healthz")
    return asyncio.run(route.endpoint())


def _call_usage(app):
    route = next(route for route in app.routes if getattr(route, "path", None) == "/api/usage")
    return asyncio.run(route.endpoint())


def test_healthz_reports_watcher_status(monkeypatch):
    app = make_app()
    monkeypatch.setattr(app.state.jsonl_watcher, "is_alive", lambda: True)
    monkeypatch.setattr(app.state.wt_status_watcher, "is_alive", lambda: True)

    response = _call_healthz(app)

    assert response.status_code == 200
    assert json.loads(response.body) == {
        "ok": True,
        "watcher_alive": True,
        "last_event_at": None,
        "session_count": 0,
        "parse_failures": {"claude": 0, "codex": 0, "cursor": 0},
        "oldest_running_age_sec": None,
    }

    monkeypatch.setattr(app.state.jsonl_watcher, "is_alive", lambda: False)
    response = _call_healthz(app)

    assert response.status_code == 503
    body = json.loads(response.body)
    assert body["ok"] is False
    assert body["watcher_alive"] is False


def test_usage_includes_cursor(monkeypatch):
    import agent_dashboard.ui_web.server as server

    monkeypatch.setattr(server, "read_claude_usage", lambda: {"source": "claude"})
    monkeypatch.setattr(server, "read_codex_usage", lambda: {"source": "codex"})
    monkeypatch.setattr(server, "read_cursor_usage", lambda: {"source": "cursor"})
    app = make_app()

    assert _call_usage(app) == {
        "claude": {"source": "claude"},
        "codex": {"source": "codex"},
        "cursor": {"source": "cursor"},
    }
