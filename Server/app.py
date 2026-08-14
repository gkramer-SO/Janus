"""FastAPI application and Uvicorn runner for the local Janus dashboard."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from uuid import uuid4

import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse

from Core.io import get_janus_version
from Core.report_model import ReportModel
from Server.live import LiveRunWorker
from Server.service import RunArtifactError, RunNotFoundError, RunService


PACKAGE_ROOT = Path(__file__).resolve().parent
DEFAULT_ASSET_DIR = PACKAGE_ROOT / "assets"


def _error(status: int, code: str, message: str, request_id: str | None = None) -> JSONResponse:
    return JSONResponse(
        status_code=status,
        content={"error": {"code": code, "message": message, "request_id": request_id or str(uuid4())}},
    )


def create_app(
    *,
    output_root: Path = Path("/data/out"),
    selected_run: Path | None = None,
    asset_dir: Path = DEFAULT_ASSET_DIR,
    live_workers: dict[str, LiveRunWorker] | None = None,
) -> FastAPI:
    service = RunService(output_root, selected_run)
    assets = asset_dir.resolve()
    app = FastAPI(title="Janus Local Dashboard", version=get_janus_version(), docs_url=None, redoc_url=None)
    app.state.run_service = service
    app.state.asset_dir = assets
    app.state.live_workers = live_workers or {}

    @app.on_event("startup")
    def start_live_workers() -> None:
        for worker in app.state.live_workers.values():
            worker.start()

    @app.on_event("shutdown")
    def stop_live_workers() -> None:
        for worker in app.state.live_workers.values():
            worker.stop()

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        request_id = str(uuid4())
        request.state.request_id = request_id
        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; script-src 'self'; style-src 'self'; "
            "img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'"
        )
        return response

    @app.exception_handler(RunNotFoundError)
    async def run_not_found(request: Request, exc: RunNotFoundError):
        return _error(404, "run-not-found", str(exc), request.state.request_id)

    @app.exception_handler(RunArtifactError)
    async def run_artifact_error(request: Request, exc: RunArtifactError):
        return _error(422, "run-artifact-invalid", str(exc), request.state.request_id)

    @app.exception_handler(Exception)
    async def unexpected_error(request: Request, exc: Exception):
        # Do not let local source implementation details or credentials reach a
        # browser response. Uvicorn retains the exception in its local log.
        return _error(
            500,
            "internal-error",
            "Janus could not complete this request.",
            getattr(request.state, "request_id", None),
        )

    @app.get("/api/v1/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/api/v1/version")
    def version() -> dict[str, str]:
        return {"janus_version": get_janus_version(), "api_version": "v1"}

    @app.get("/api/v1/runs")
    def runs() -> dict[str, Any]:
        return {"runs": [record.summary() for record in service.records()]}

    @app.get("/api/v1/runs/{run_id}")
    def run_metadata(run_id: str) -> dict[str, Any]:
        return service.get(run_id).summary()

    @app.get("/api/v1/runs/{run_id}/report", response_model=ReportModel)
    def report(run_id: str, request: Request) -> Response:
        record = service.get(run_id)
        etag = service.etag(record.model)
        if request.headers.get("if-none-match") == etag:
            return Response(status_code=304, headers={"ETag": etag})
        payload = record.model.model_dump(mode="json", exclude_none=True)
        return JSONResponse(payload, headers={"ETag": etag, "Cache-Control": "no-cache"})

    @app.get("/api/v1/runs/{run_id}/status")
    def run_status(run_id: str) -> dict[str, Any]:
        record = service.get(run_id)
        worker = app.state.live_workers.get(run_id)
        if worker is not None:
            return worker.snapshot()
        return {"run_id": run_id, "phase": "complete", "revision": record.model.revision, "stale": False}

    @app.get("/api/v1/runs/{run_id}/stream")
    def run_stream(run_id: str, request: Request) -> StreamingResponse:
        service.get(run_id)
        worker = app.state.live_workers.get(run_id)
        if worker is None:
            raise RunNotFoundError("Live updates are not enabled for this run.")
        header = request.headers.get("last-event-id")
        try:
            last_event_id = int(header) if header else None
        except ValueError:
            last_event_id = None
        return StreamingResponse(
            worker.stream(last_event_id),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    @app.get("/api/v1/schema/report-model")
    def report_schema() -> dict[str, Any]:
        return ReportModel.model_json_schema()

    def dashboard_shell() -> FileResponse:
        index = assets / "index.html"
        if not index.is_file():
            raise RunArtifactError("Compiled dashboard assets are missing from the Janus image.")
        return FileResponse(index)

    @app.get("/")
    def index() -> FileResponse:
        return dashboard_shell()

    @app.get("/runs/{run_id}")
    def selected_index(run_id: str) -> FileResponse:
        service.get(run_id)
        return dashboard_shell()

    @app.get("/assets/{asset_name}")
    def asset(asset_name: str) -> FileResponse:
        if not asset_name or asset_name != Path(asset_name).name:
            raise RunNotFoundError("Asset not found.")
        path = (assets / "assets" / asset_name).resolve()
        try:
            path.relative_to(assets / "assets")
        except ValueError as exc:
            raise RunNotFoundError("Asset not found.") from exc
        if not path.is_file():
            raise RunNotFoundError("Asset not found.")
        return FileResponse(path, headers={"Cache-Control": "public, max-age=31536000, immutable"})

    return app


def run_server(
    *,
    output_root: Path,
    selected_run: Path | None,
    host: str,
    port: int,
    debug: bool = False,
    live_workers: dict[str, LiveRunWorker] | None = None,
) -> None:
    app = create_app(output_root=output_root, selected_run=selected_run, live_workers=live_workers)
    uvicorn.run(app, host=host, port=port, log_level="debug" if debug else "info")
