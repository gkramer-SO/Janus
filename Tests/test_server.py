from __future__ import annotations

import json
import re
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from Server.app import create_app
from Server.service import RunNotFoundError, RunService


ROOT = Path(__file__).resolve().parents[1]


def _output_root(tmp_path: Path) -> tuple[Path, str]:
    run_dir = tmp_path / "complete" / "fixture"
    run_dir.mkdir(parents=True)
    (run_dir / "bundle.json").write_text("{}", encoding="utf-8")
    model_text = (ROOT / "Tests" / "fixtures" / "reports" / "complete-mythic.json").read_text(encoding="utf-8")
    (run_dir / "report-model.json").write_text(model_text, encoding="utf-8")
    return tmp_path, json.loads(model_text)["run_id"]


def test_read_only_api_lists_serves_and_caches_runs(tmp_path) -> None:
    output_root, run_id = _output_root(tmp_path)
    client = TestClient(create_app(output_root=output_root, asset_dir=ROOT / "dashboard" / "dist"))

    health = client.get("/api/v1/health")
    assert health.json() == {"status": "ok"}
    assert health.headers["x-content-type-options"] == "nosniff"
    assert "frame-ancestors 'none'" in health.headers["content-security-policy"]

    listing = client.get("/api/v1/runs")
    assert listing.json()["runs"][0]["run_id"] == run_id
    assert listing.json()["runs"][0]["live"] is False
    assert client.get(f"/api/v1/runs/{run_id}/status").json()["live"] is False
    assert client.get(f"/api/v1/runs/{run_id}/stream").status_code == 404

    report = client.get(f"/api/v1/runs/{run_id}/report")
    assert report.status_code == 200
    assert report.json()["run_id"] == run_id
    assert report.headers["etag"]
    cached = client.get(f"/api/v1/runs/{run_id}/report", headers={"If-None-Match": report.headers["etag"]})
    assert cached.status_code == 304

    index = client.get("/")
    assert index.status_code == 200
    asset_path = re.search(r'src="([^"]+)"', index.text).group(1)
    assert client.get(asset_path).status_code == 200


def test_run_service_rejects_paths_and_invalid_identifiers(tmp_path) -> None:
    output_root, _ = _output_root(tmp_path)
    with pytest.raises(RunNotFoundError):
        RunService(output_root, output_root.parent)

    service = RunService(output_root)
    with pytest.raises(RunNotFoundError):
        service.get("../fixture")


def test_api_returns_safe_structured_errors(tmp_path) -> None:
    output_root, _ = _output_root(tmp_path)
    client = TestClient(create_app(output_root=output_root, asset_dir=ROOT / "dashboard" / "dist"))

    response = client.get("/api/v1/runs/not-a-run")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "run-not-found"
    assert response.json()["error"]["request_id"]
    assert "traceback" not in response.text.lower()


def test_live_run_metadata_and_lifespan_are_explicit(tmp_path) -> None:
    output_root, run_id = _output_root(tmp_path)

    class Worker:
        started = 0
        stopped = 0

        def start(self) -> None:
            self.started += 1

        def stop(self) -> None:
            self.stopped += 1

        def snapshot(self) -> dict:
            return {"run_id": run_id, "phase": "ready", "revision": 1, "stale": False}

    worker = Worker()
    app = create_app(output_root=output_root, asset_dir=ROOT / "dashboard" / "dist", live_workers={run_id: worker})
    with TestClient(app) as client:
        assert client.get("/api/v1/runs").json()["runs"][0]["live"] is True
        assert client.get(f"/api/v1/runs/{run_id}/status").json()["live"] is True
        assert "live-revisions" in client.get(f"/api/v1/runs/{run_id}/report").json()["capabilities"]
        assert worker.started == 1

    assert worker.stopped == 1
