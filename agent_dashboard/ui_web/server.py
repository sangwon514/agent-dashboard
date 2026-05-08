from __future__ import annotations

import asyncio
import json
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sse_starlette.sse import EventSourceResponse

from ..core.store import Store
from ..core.watcher import JsonlWatcher
from ..core.wt_status import WtStatusWatcher

log = logging.getLogger("agent-dashboard.web")
STATIC = Path(__file__).parent / "static"

DEFAULT_HOST = os.environ.get("AGENT_DASHBOARD_HOST", "127.0.0.1")
DEFAULT_PORT = int(os.environ.get("AGENT_DASHBOARD_PORT", "7878"))


def make_app() -> FastAPI:
    store = Store()
    update_event = asyncio.Event()
    main_loop: asyncio.AbstractEventLoop | None = None

    def _on_update() -> None:
        if main_loop is not None and main_loop.is_running():
            main_loop.call_soon_threadsafe(update_event.set)

    store.subscribe(_on_update)

    js_watcher = JsonlWatcher(store.update_transcript)
    wt_watcher = WtStatusWatcher(store.update_wt_status)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        nonlocal main_loop
        main_loop = asyncio.get_running_loop()
        js_watcher.start()
        wt_watcher.start()
        log.info("watchers started")
        try:
            yield
        finally:
            js_watcher.stop()
            wt_watcher.stop()
            log.info("watchers stopped")

    app = FastAPI(lifespan=lifespan, title="agent-dashboard")

    @app.get("/")
    async def root():
        return FileResponse(STATIC / "index.html")

    @app.get("/api/snapshot")
    async def snapshot():
        return store.snapshot()

    @app.get("/api/stream")
    async def stream(request: Request):
        async def gen():
            yield {"event": "snapshot", "data": json.dumps(store.snapshot())}
            while True:
                if await request.is_disconnected():
                    break
                try:
                    await asyncio.wait_for(update_event.wait(), timeout=15.0)
                    update_event.clear()
                    yield {"event": "snapshot", "data": json.dumps(store.snapshot())}
                except asyncio.TimeoutError:
                    yield {"event": "ping", "data": ""}

        return EventSourceResponse(gen())

    app.mount("/static", StaticFiles(directory=STATIC), name="static")
    return app


def main() -> None:
    import uvicorn

    logging.basicConfig(
        level=os.environ.get("AGENT_DASHBOARD_LOG", "INFO"),
        format="%(asctime)s %(name)s %(levelname)s %(message)s",
    )
    uvicorn.run(
        make_app(),
        host=DEFAULT_HOST,
        port=DEFAULT_PORT,
        log_level="info",
        access_log=False,
    )


if __name__ == "__main__":
    main()
