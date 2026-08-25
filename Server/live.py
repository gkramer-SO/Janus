"""Bounded live-ingest orchestration for the local Janus dashboard.

The worker deliberately knows nothing about individual C2 APIs.  Source adapters
return already-normalized events, while the worker owns the durable checkpoint,
deduplication, debounce, retry, and notification behaviour shared by every
source.  This keeps live mode on the same artifact contract as one-shot runs.
"""

from __future__ import annotations

import hashlib
import json
import threading
import time
from collections import deque
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from enum import StrEnum
from pathlib import Path
from typing import Any, Callable, Iterator


MAX_DEDUP_KEYS = 20_000
MAX_EVENT_HISTORY = 256


class LiveRunPhase(StrEnum):
    STARTING = "starting"
    INGESTING = "ingesting"
    ANALYZING = "analyzing"
    READY = "ready"
    DEGRADED = "degraded"
    STOPPED = "stopped"
    ERROR = "error"


@dataclass(frozen=True)
class PollResult:
    """Normalized source data returned by a source adapter.

    ``checkpoint`` must contain source progress only.  Credentials and complete
    source configuration are intentionally not persisted by this module.
    """

    events: list[dict[str, Any]]
    checkpoint: dict[str, Any] | None = None
    snapshot: bool = False
    bundle: dict[str, Any] | None = None


@dataclass
class LiveRunState:
    run_id: str
    source: str
    phase: LiveRunPhase = LiveRunPhase.STARTING
    revision: int | None = None
    checkpoint: dict[str, Any] | None = None
    newly_observed_events: int = 0
    total_events: int = 0
    last_successful_ingest_at: str | None = None
    last_successful_analysis_at: str | None = None
    next_poll_at: str | None = None
    refresh_queued: bool = False
    stale: bool = False
    error: str | None = None
    consecutive_failures: int = 0

    def public(self) -> dict[str, Any]:
        """Return only safe fields suitable for the dashboard API."""
        return asdict(self)


@dataclass(frozen=True)
class StreamEvent:
    id: int
    name: str
    data: dict[str, Any]

    def encode(self) -> str:
        payload = json.dumps(self.data, separators=(",", ":"), ensure_ascii=False)
        return f"id: {self.id}\nevent: {self.name}\ndata: {payload}\n\n"


class LiveEventBroker:
    """A bounded replay buffer for SSE clients.

    A stream never holds a per-client unbounded queue.  Clients that reconnect
    after the buffer has rolled over receive ``resync`` and refetch status/model.
    """

    def __init__(self, history_size: int = MAX_EVENT_HISTORY) -> None:
        self._history: deque[StreamEvent] = deque(maxlen=history_size)
        self._next_id = 1
        self._condition = threading.Condition()

    def publish(self, name: str, data: dict[str, Any]) -> StreamEvent:
        with self._condition:
            event = StreamEvent(self._next_id, name, data)
            self._next_id += 1
            self._history.append(event)
            self._condition.notify_all()
            return event

    def events_after(self, event_id: int | None) -> tuple[bool, list[StreamEvent]]:
        """Return ``(requires_resync, events)`` without retaining client state."""
        with self._condition:
            if not self._history:
                return False, []
            if event_id is not None and event_id < self._history[0].id - 1:
                return True, []
            return False, [item for item in self._history if event_id is None or item.id > event_id]

    def wait_for_events(self, event_id: int | None, timeout: float) -> tuple[bool, list[StreamEvent]]:
        with self._condition:
            self._condition.wait_for(
                lambda: bool(self._history) and (event_id is None or self._history[-1].id > event_id),
                timeout=timeout,
            )
        return self.events_after(event_id)


Poller = Callable[[dict[str, Any] | None], PollResult]
Analyzer = Callable[[Path], int | None]
RevisionLoader = Callable[[], int | None]


class LiveRunWorker:
    """One serial worker for one live run.

    Synchronous source and analyzer operations run on this dedicated thread,
    never in a FastAPI request handler.  A new analysis is scheduled only after
    changes have settled for ``analysis_debounce_seconds``.
    """

    def __init__(
        self,
        *,
        run_dir: Path,
        run_id: str,
        source: str,
        poller: Poller,
        analyzer: Analyzer,
        revision_loader: RevisionLoader | None = None,
        poll_interval_seconds: float = 30.0,
        analysis_debounce_seconds: float = 2.0,
        max_backoff_seconds: float = 300.0,
    ) -> None:
        if poll_interval_seconds <= 0 or analysis_debounce_seconds < 0 or max_backoff_seconds <= 0:
            raise ValueError("Live polling intervals must be positive (debounce may be zero).")
        self.run_dir = run_dir
        self.events_path = run_dir / "events.ndjson"
        self.state_path = run_dir / "live-state.json"
        self.poller = poller
        self.analyzer = analyzer
        self.revision_loader = revision_loader
        self.poll_interval_seconds = poll_interval_seconds
        self.analysis_debounce_seconds = analysis_debounce_seconds
        self.max_backoff_seconds = max_backoff_seconds
        self.broker = LiveEventBroker()
        self._lock = threading.RLock()
        self._stop = threading.Event()
        self._wake = threading.Event()
        self._thread: threading.Thread | None = None
        self._dedup_order: deque[str] = deque(maxlen=MAX_DEDUP_KEYS)
        self._dedup_keys: set[str] = set()
        self._analysis_due_at: float | None = None
        self.state = LiveRunState(run_id=run_id, source=source)
        self._restore_state()
        self._load_existing_keys()

    @staticmethod
    def _utc_now() -> str:
        return datetime.now(UTC).isoformat()

    @staticmethod
    def _safe_error(exc: Exception) -> str:
        name = type(exc).__name__.lower()
        if "auth" in name or "permission" in name or "unauthor" in str(exc).lower():
            return "Source authentication failed. Verify the configured credentials."
        return "Source or analysis operation failed; the previous report remains available."

    @staticmethod
    def event_key(event: dict[str, Any], run_id: str) -> str:
        """Build a stable key without treating a result as a duplicate of its task."""
        operation = str(event.get("operation_id") or event.get("operation") or run_id)
        event_type = str(event.get("event_type") or event.get("type") or "unknown")
        identifiers = (
            event.get("result_id") if event_type == "result" else None,
            event.get("task_id") if event_type == "task" else None,
            event.get("event_id"),
            event.get("uuid"),
            event.get("id"),
        )
        identifier = next((str(value) for value in identifiers if value not in (None, "")), None)
        if identifier is not None:
            return f"id:{operation}:{event_type}:{identifier}"
        canonical = json.dumps(event, sort_keys=True, separators=(",", ":"), default=str)
        return f"hash:{operation}:{event_type}:{hashlib.sha256(canonical.encode()).hexdigest()}"

    def _remember_key(self, key: str) -> None:
        if key in self._dedup_keys:
            return
        if len(self._dedup_order) == self._dedup_order.maxlen:
            expired = self._dedup_order.popleft()
            self._dedup_keys.discard(expired)
        self._dedup_order.append(key)
        self._dedup_keys.add(key)

    def _load_existing_keys(self) -> None:
        if not self.events_path.is_file():
            return
        try:
            lines = self.events_path.read_text(encoding="utf-8").splitlines()
            self.state.total_events = len(lines)
            for line in lines[-MAX_DEDUP_KEYS:]:
                event = json.loads(line)
                if isinstance(event, dict):
                    self._remember_key(self.event_key(event, self.state.run_id))
        except (OSError, ValueError, json.JSONDecodeError):
            # The existing one-shot artifact will be surfaced by normal run
            # validation; live mode must not overwrite it on a bad read.
            self.state.phase = LiveRunPhase.DEGRADED
            self.state.stale = True
            self.state.error = "Existing events could not be read safely."

    def _restore_state(self) -> None:
        if not self.state_path.is_file():
            return
        try:
            raw = json.loads(self.state_path.read_text(encoding="utf-8"))
            if raw.get("run_id") != self.state.run_id or raw.get("source") != self.state.source:
                return
            checkpoint = raw.get("checkpoint")
            if isinstance(checkpoint, dict):
                self.state.checkpoint = checkpoint
            for key in raw.get("dedup_keys", []):
                if isinstance(key, str):
                    self._remember_key(key)
        except (OSError, ValueError, json.JSONDecodeError):
            self.state.phase = LiveRunPhase.DEGRADED
            self.state.stale = True
            self.state.error = "Live checkpoint could not be restored; a full refresh will be used."

    def _persist_state(self) -> None:
        self.run_dir.mkdir(parents=True, exist_ok=True)
        document = self.state.public() | {"dedup_keys": list(self._dedup_order)}
        temporary = self.state_path.with_suffix(".tmp")
        temporary.write_text(json.dumps(document, sort_keys=True, indent=2) + "\n", encoding="utf-8")
        temporary.replace(self.state_path)

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            return self.state.public()

    def _publish(self, name: str, **extra: Any) -> None:
        self.broker.publish(name, {"run_id": self.state.run_id, "revision": self.state.revision, **extra})

    def start(self) -> None:
        with self._lock:
            if self._thread is not None and self._thread.is_alive():
                return
            self._stop.clear()
            self._thread = threading.Thread(target=self._run, name=f"janus-live-{self.state.run_id}", daemon=True)
            self._thread.start()

    def stop(self, timeout: float = 10.0) -> None:
        self._stop.set()
        self._wake.set()
        thread = self._thread
        if thread is not None:
            thread.join(timeout)
        with self._lock:
            self.state.phase = LiveRunPhase.STOPPED
            self.state.refresh_queued = False
            self.state.next_poll_at = None
            self._persist_state()
            self._publish("run.stopped")

    def request_refresh(self) -> None:
        self._wake.set()

    def _append_new_events(self, events: list[dict[str, Any]]) -> int:
        fresh: list[dict[str, Any]] = []
        for event in events:
            key = self.event_key(event, self.state.run_id)
            if key not in self._dedup_keys:
                self._remember_key(key)
                fresh.append(event)
        if fresh:
            self.run_dir.mkdir(parents=True, exist_ok=True)
            with self.events_path.open("a", encoding="utf-8", newline="\n") as handle:
                for event in fresh:
                    handle.write(json.dumps(event, separators=(",", ":"), ensure_ascii=False, default=str) + "\n")
        self.state.total_events += len(fresh)
        return len(fresh)

    def _replace_snapshot(self, events: list[dict[str, Any]]) -> int:
        """Atomically replace a complete normalized source snapshot.

        Snapshot mode avoids leaving obsolete result values behind when a source
        updates an existing task/result in a later API response.  The amount of
        change is still based on canonical event identities so it can drive the
        usual analysis debounce.
        """
        def keyed(documents: list[dict[str, Any]]) -> dict[str, str]:
            return {
                self.event_key(event, self.state.run_id): json.dumps(
                    event, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str
                )
                for event in documents
            }

        existing: list[dict[str, Any]] = []
        if self.events_path.is_file():
            try:
                existing = [
                    event
                    for line in self.events_path.read_text(encoding="utf-8").splitlines()
                    if line.strip() and isinstance((event := json.loads(line)), dict)
                ]
            except (OSError, ValueError, json.JSONDecodeError):
                existing = []
        incoming = keyed(events)
        previous = keyed(existing)
        changed_count = len(incoming.keys() ^ previous.keys())
        changed_count += sum(incoming[key] != previous[key] for key in incoming.keys() & previous.keys())
        changed = changed_count > 0
        if changed:
            self.run_dir.mkdir(parents=True, exist_ok=True)
            temporary = self.events_path.with_suffix(".tmp")
            ordered = sorted(events, key=lambda event: str(event.get("timestamp", "")))
            with temporary.open("w", encoding="utf-8", newline="\n") as handle:
                for event in ordered:
                    handle.write(json.dumps(event, separators=(",", ":"), ensure_ascii=False, default=str) + "\n")
            temporary.replace(self.events_path)
        self._dedup_order.clear()
        self._dedup_keys.clear()
        for event in events[-MAX_DEDUP_KEYS:]:
            self._remember_key(self.event_key(event, self.state.run_id))
        self.state.total_events = len(events)
        return changed_count

    def _write_bundle(self, bundle: dict[str, Any]) -> None:
        target = self.run_dir / "bundle.json"
        temporary = target.with_suffix(".tmp")
        temporary.write_text(json.dumps(bundle, sort_keys=True, indent=2) + "\n", encoding="utf-8")
        temporary.replace(target)

    def _run_analysis(self) -> None:
        self.state.phase = LiveRunPhase.ANALYZING
        self.state.refresh_queued = False
        self._publish("analysis.started")
        try:
            result = self.analyzer(self.run_dir)
            if result not in (None, 0):
                raise RuntimeError("Analyzer returned a non-zero status.")
            self.state.revision = self.revision_loader() if self.revision_loader else self.state.revision
            self.state.phase = LiveRunPhase.READY
            self.state.stale = False
            self.state.error = None
            self.state.last_successful_analysis_at = self._utc_now()
            self._persist_state()
            self._publish("report.updated")
        except Exception as exc:  # Preserve last known-good model and report failure in state.
            self.state.phase = LiveRunPhase.DEGRADED
            self.state.stale = True
            self.state.error = self._safe_error(exc)
            self._persist_state()
            self._publish("run.degraded", error=self.state.error)

    def _run(self) -> None:
        self._publish("connected", status=self.snapshot())
        next_poll = time.monotonic()
        while not self._stop.is_set():
            now = time.monotonic()
            if now >= next_poll:
                with self._lock:
                    self.state.phase = LiveRunPhase.INGESTING
                    self.state.next_poll_at = None
                    self._publish("ingest.started")
                try:
                    result = self.poller(self.state.checkpoint)
                    if not isinstance(result, PollResult):
                        raise TypeError("Live source adapter must return PollResult.")
                    with self._lock:
                        new_count = self._replace_snapshot(result.events) if result.snapshot else self._append_new_events(result.events)
                        if result.bundle is not None:
                            self._write_bundle(result.bundle)
                        self.state.checkpoint = result.checkpoint
                        self.state.newly_observed_events = new_count
                        self.state.last_successful_ingest_at = self._utc_now()
                        self.state.consecutive_failures = 0
                        self.state.error = None
                        if new_count or (result.snapshot and not (self.run_dir / "report-model.json").is_file()):
                            self._analysis_due_at = time.monotonic() + self.analysis_debounce_seconds
                            self.state.refresh_queued = True
                        elif self._analysis_due_at is None:
                            self.state.phase = LiveRunPhase.READY
                        self._persist_state()
                        self._publish("ingest.completed", new_events=new_count, total_events=self.state.total_events)
                    next_poll = time.monotonic() + self.poll_interval_seconds
                except Exception as exc:
                    with self._lock:
                        self.state.consecutive_failures += 1
                        self.state.phase = LiveRunPhase.DEGRADED
                        self.state.stale = True
                        self.state.error = self._safe_error(exc)
                        delay = min(self.poll_interval_seconds * (2 ** (self.state.consecutive_failures - 1)), self.max_backoff_seconds)
                        next_poll = time.monotonic() + delay
                        self._persist_state()
                        self._publish("run.degraded", error=self.state.error)
            with self._lock:
                due = self._analysis_due_at
                if due is not None and time.monotonic() >= due:
                    self._analysis_due_at = None
                    self._run_analysis()
                wait_until = min(next_poll, due) if due is not None else next_poll
                delay = max(0.01, wait_until - time.monotonic())
                self.state.next_poll_at = datetime.fromtimestamp(time.time() + delay, UTC).isoformat()
            self._wake.wait(delay)
            self._wake.clear()

    def stream(self, last_event_id: int | None = None, keepalive_seconds: float = 15.0) -> Iterator[str]:
        """Yield SSE records with bounded replay and periodic keepalives."""
        current = last_event_id
        yield StreamEvent(0, "connected", {"run_id": self.state.run_id, "status": self.snapshot()}).encode()
        while not self._stop.is_set():
            resync, events = self.broker.wait_for_events(current, keepalive_seconds)
            if resync:
                yield StreamEvent(0, "resync", {"run_id": self.state.run_id, "status": self.snapshot()}).encode()
                current = None
                continue
            if not events:
                yield ": keepalive\n\n"
                continue
            for event in events:
                current = event.id
                yield event.encode()
