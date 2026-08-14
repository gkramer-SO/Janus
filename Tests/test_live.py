from __future__ import annotations

import json
import time
from pathlib import Path

from Server.live import LiveEventBroker, LiveRunPhase, LiveRunWorker, PollResult
from Server.source_pollers import ArtifactSnapshotPoller


def _wait_until(predicate, timeout: float = 1.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(0.01)
    raise AssertionError("condition was not reached before timeout")


def test_live_worker_persists_checkpoint_deduplicates_and_debounces(tmp_path: Path) -> None:
    calls = 0
    analysis_calls: list[Path] = []

    def poller(checkpoint):
        nonlocal calls
        calls += 1
        assert checkpoint in (None, {"cursor": "one"})
        return PollResult(
            events=[
                {"operation_id": "op-1", "event_type": "task", "task_id": "task-1"},
                {"operation_id": "op-1", "event_type": "result", "task_id": "task-1", "result_id": "result-1"},
            ],
            checkpoint={"cursor": "one"},
        )

    def analyze(run_dir: Path) -> int:
        analysis_calls.append(run_dir)
        return 0

    worker = LiveRunWorker(
        run_dir=tmp_path,
        run_id="run-1",
        source="mythic",
        poller=poller,
        analyzer=analyze,
        revision_loader=lambda: 9,
        poll_interval_seconds=0.02,
        analysis_debounce_seconds=0.01,
    )
    worker.start()
    _wait_until(lambda: len(analysis_calls) == 1 and worker.snapshot()["phase"] == LiveRunPhase.READY)
    # At least one duplicate poll follows the first ingest and must not trigger
    # a second analysis.
    _wait_until(lambda: calls >= 2)
    worker.stop()

    assert len(analysis_calls) == 1
    assert (tmp_path / "events.ndjson").read_text(encoding="utf-8").count("\n") == 2
    persisted = json.loads((tmp_path / "live-state.json").read_text(encoding="utf-8"))
    assert persisted["checkpoint"] == {"cursor": "one"}
    assert persisted["total_events"] == 2
    assert persisted["revision"] == 9


def test_live_worker_keeps_previous_report_after_analysis_failure(tmp_path: Path) -> None:
    def poller(_checkpoint):
        return PollResult(events=[{"event_type": "task", "task_id": "task-1"}])

    worker = LiveRunWorker(
        run_dir=tmp_path,
        run_id="run-1",
        source="ghostwriter",
        poller=poller,
        analyzer=lambda _run_dir: 1,
        poll_interval_seconds=0.05,
        analysis_debounce_seconds=0,
    )
    worker.state.revision = 4
    worker.start()
    _wait_until(lambda: worker.snapshot()["phase"] == LiveRunPhase.DEGRADED)
    state = worker.snapshot()
    worker.stop()

    assert state["revision"] == 4
    assert state["stale"] is True
    assert "previous report remains available" in state["error"]


def test_sse_broker_requires_resync_only_after_retained_history() -> None:
    broker = LiveEventBroker(history_size=2)
    first = broker.publish("ingest.started", {"run_id": "run-1"})
    broker.publish("ingest.completed", {"run_id": "run-1"})
    broker.publish("report.updated", {"run_id": "run-1"})

    resync, events = broker.events_after(0)
    assert resync is True
    assert events == []
    resync, events = broker.events_after(first.id)
    assert resync is False
    assert [event.name for event in events] == ["ingest.completed", "report.updated"]


def test_artifact_snapshot_poller_promotes_only_complete_existing_ingest_artifacts(tmp_path: Path) -> None:
    def ingest(staging: Path) -> int:
        (staging / "events.ndjson").write_text(
            '{"event_type":"task","task_id":1,"command_name":"whoami","timestamp":"2026-01-01T00:00:00Z"}\n',
            encoding="utf-8",
        )
        (staging / "bundle.json").write_text('{"operation_id":1,"source":"mythic"}', encoding="utf-8")
        return 0

    result = ArtifactSnapshotPoller(staging_dir=tmp_path / ".live-source", run_id="live:fixture", ingest=ingest)(None)

    assert result.snapshot is True
    assert result.bundle is not None
    assert result.bundle["run_id"] == "live:fixture"
    assert result.checkpoint is not None
    assert result.checkpoint["event_count"] == 1
