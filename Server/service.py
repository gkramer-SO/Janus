"""Safe filesystem-backed run discovery for the local dashboard."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from Core.report_builder import build_report_model
from Core.report_model import ReportModel


class RunNotFoundError(LookupError):
    """Raised when a requested run does not exist below the output root."""


class RunArtifactError(RuntimeError):
    """Raised when a run exists but its report model cannot be loaded."""


@dataclass(frozen=True)
class RunRecord:
    run_id: str
    path: Path
    model: ReportModel

    def summary(self) -> dict[str, Any]:
        return {
            "run_id": self.run_id,
            "operation_name": self.model.run.operation_name,
            "run_kind": self.model.run.run_kind.value,
            "analysis_completed_at": self.model.run.analysis_completed_at.isoformat(),
            "task_count": self.model.run.task_count,
            "result_count": self.model.run.result_count,
            "revision": self.model.revision,
        }


class RunService:
    """Discover and validate reportable runs below one configured root."""

    def __init__(self, output_root: Path, selected_run: Path | None = None) -> None:
        self.output_root = output_root.resolve()
        self.selected_run = self._resolve_selected(selected_run)

    def _resolve_selected(self, selected_run: Path | None) -> Path | None:
        if selected_run is None:
            return None
        candidate = selected_run.resolve()
        self._require_below_root(candidate)
        if not candidate.is_dir():
            raise RunNotFoundError(f"Run directory does not exist: {selected_run}")
        return candidate

    def _require_below_root(self, candidate: Path) -> None:
        try:
            candidate.relative_to(self.output_root)
        except ValueError as exc:
            raise RunNotFoundError("Requested run is outside the configured output root.") from exc

    def _candidate_dirs(self) -> list[Path]:
        if not self.output_root.is_dir():
            return []
        if self.selected_run is not None:
            return [self.selected_run]
        candidates: set[Path] = set()
        for bundle in self.output_root.rglob("bundle.json"):
            parent = bundle.parent.resolve()
            self._require_below_root(parent)
            if any(part.startswith(".") or part.endswith(".tmp") for part in parent.relative_to(self.output_root).parts):
                continue
            candidates.add(parent)
        return sorted(candidates)

    def _load_model(self, run_dir: Path) -> ReportModel:
        model_path = run_dir / "report-model.json"
        if model_path.is_file():
            try:
                return ReportModel.model_validate_json(model_path.read_text(encoding="utf-8-sig"))
            except (OSError, ValueError) as exc:
                raise RunArtifactError(f"Invalid report-model.json in {run_dir.name}.") from exc
        result = build_report_model(run_dir, revision=1)
        if result.model is None:
            message = result.errors[0].message if result.errors else "Report model construction failed."
            raise RunArtifactError(message)
        return result.model

    def records(self) -> list[RunRecord]:
        records: list[RunRecord] = []
        seen: set[str] = set()
        for run_dir in self._candidate_dirs():
            try:
                model = self._load_model(run_dir)
            except RunArtifactError:
                continue
            if model.run_id in seen:
                continue
            seen.add(model.run_id)
            records.append(RunRecord(model.run_id, run_dir, model))
        records.sort(key=lambda item: item.model.run.analysis_completed_at, reverse=True)
        return records

    def get(self, run_id: str) -> RunRecord:
        if not run_id or "\x00" in run_id or "/" in run_id or "\\" in run_id:
            raise RunNotFoundError("Invalid run identifier.")
        for record in self.records():
            if record.run_id == run_id:
                return record
        raise RunNotFoundError(f"Run not found: {run_id}")

    def latest(self) -> RunRecord:
        records = self.records()
        if not records:
            raise RunNotFoundError("No reportable Janus runs were found.")
        return records[0]

    @staticmethod
    def etag(model: ReportModel) -> str:
        payload = model.model_dump_json(exclude_none=True).encode("utf-8")
        return '"' + hashlib.sha256(payload).hexdigest() + '"'
