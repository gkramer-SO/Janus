"""Adapters that turn existing Janus ingest commands into live snapshots."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

from Server.live import PollResult


class SourceIngestError(RuntimeError):
    """Raised when an existing source ingestor cannot produce a safe snapshot."""


Ingest = Callable[[Path], int]


class ArtifactSnapshotPoller:
    """Use an existing source ingestor to produce complete normalized snapshots.

    Source clients retain their own authentication, TLS, pagination, retention,
    and normalization implementations.  The staging directory is only promoted
    into a live run after a successful complete pull, so a transient source
    failure cannot corrupt the currently served artifacts.
    """

    def __init__(self, *, staging_dir: Path, run_id: str, ingest: Ingest) -> None:
        self.staging_dir = staging_dir
        self.run_id = run_id
        self.ingest = ingest

    def __call__(self, _checkpoint: dict[str, Any] | None) -> PollResult:
        self.staging_dir.mkdir(parents=True, exist_ok=True)
        if self.ingest(self.staging_dir) != 0:
            raise SourceIngestError("The source ingest command did not complete successfully.")

        events_path = self.staging_dir / "events.ndjson"
        bundle_path = self.staging_dir / "bundle.json"
        if not events_path.is_file() or not bundle_path.is_file():
            raise SourceIngestError("The source ingest command did not produce required Janus artifacts.")
        try:
            events = [json.loads(line) for line in events_path.read_text(encoding="utf-8").splitlines() if line.strip()]
            if not all(isinstance(event, dict) for event in events):
                raise ValueError("events must be JSON objects")
            bundle = json.loads(bundle_path.read_text(encoding="utf-8"))
            if not isinstance(bundle, dict):
                raise ValueError("bundle must be a JSON object")
        except (OSError, ValueError, json.JSONDecodeError) as exc:
            raise SourceIngestError("The source ingest artifacts are malformed.") from exc

        # A live run is one continuously refreshed report, not a new run for
        # each source snapshot. Keep its report-model identity stable.
        bundle["run_id"] = self.run_id
        digest = hashlib.sha256(events_path.read_bytes()).hexdigest()
        timestamps = [str(event.get("timestamp", "")) for event in events]
        checkpoint = {
            "mode": "full_snapshot",
            "event_count": len(events),
            "latest_timestamp": max(timestamps, default=""),
            "snapshot_sha256": digest,
        }
        return PollResult(events=events, checkpoint=checkpoint, snapshot=True, bundle=bundle)
