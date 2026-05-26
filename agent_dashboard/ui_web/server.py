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

from ..core.codex_usage import read_codex_usage
from ..core.store import Store
from ..core.usage import read_claude_usage
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

    @app.get("/api/usage")
    async def usage():
        # codex_usage 는 subprocess + 180s 캐시 — async loop 블로킹 회피를 위해 threadpool 위임
        codex = await asyncio.to_thread(read_codex_usage)
        return {"claude": read_claude_usage(), "codex": codex}

    @app.get("/api/stream")
    async def stream(request: Request):
        # 다발성 transcript 갱신을 합쳐 보내는 디바운스 윈도우 (초).
        # 서브에이전트 폭주 시 update_event 가 초당 수십 번 set 되는데,
        # 그걸 그대로 push 하면 클라이언트가 풀-DOM 재구축을 반복해 버벅임.
        DEBOUNCE_S = 0.25
        async def gen():
            yield {"event": "snapshot", "data": json.dumps(store.snapshot())}
            while True:
                if await request.is_disconnected():
                    break
                try:
                    await asyncio.wait_for(update_event.wait(), timeout=15.0)
                    update_event.clear()
                    # 윈도우 내에 도착한 후속 set 들을 흡수 — 마지막 상태만 보냄.
                    await asyncio.sleep(DEBOUNCE_S)
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
