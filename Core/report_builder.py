"""Build the stable Janus report model from durable run artifacts."""

from __future__ import annotations

import base64
import json
import os
import re
import tempfile
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlsplit, urlunsplit

from Core.analyzer_registry import ANALYZER_OUTPUTS
from Core.data_quality import build_data_quality
from Core.report_model import REPORT_MODEL_VERSION, ReportModel


MAX_PREVIEW_CHARS = 4096
_SOURCE_MAP = {
    "mythic": "mythic", "ghostwriter": "ghostwriter", "cobaltstrike": "cobaltstrike",
    "cobalt-strike": "cobaltstrike", "outflank": "outflank",
    "multi-operation": "multi-operation", "mixed": "mixed",
}
_TITLES = {
    "summary-visualization": "Summary Analysis", "command-failure-summary": "Command Failure Summary",
    "command-retry-success": "Command Retry Success", "command-duration": "Command Duration",
    "friction-score": "Top Friction Candidates", "outlier-context": "Outlier Context",
    "callback-health": "Callback Health", "av-tracker": "AV Tracker", "dwell-time": "Dwell Time",
    "parameter-entropy": "Parameter Entropy", "argument-position-profile": "Argument Position Profile",
    "tool-dump": "Tool Dump", "data-quality": "Data Quality", "run-diff": "Run Diff",
}


@dataclass(frozen=True)
class ReportBuildError:
    code: str
    message: str
    artifact: str | None = None
    section_id: str | None = None


@dataclass
class ReportBuildResult:
    model: ReportModel | None = None
    errors: list[ReportBuildError] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return self.model is not None and not self.errors


def build_report_model(
    run_dir: Path,
    *,
    generated_at: datetime | None = None,
    revision: int | None = None,
    include_previous_runs: bool = True,
) -> ReportBuildResult:
    """Load one completed run directory and construct its validated report model."""
    run_dir = run_dir.resolve()
    bundle, error = _load_object(run_dir / "bundle.json", required=True)
    if error:
        return ReportBuildResult(errors=[error])
    assert bundle is not None

    diff_path = run_dir / "diff.json"
    is_diff = diff_path.exists() or bundle.get("run_kind") == "diff"
    diff: dict[str, Any] | None = None
    if is_diff:
        diff, error = _load_object(diff_path, required=True)
        if error:
            return ReportBuildResult(errors=[error])

    analyzer_data: dict[str, dict[str, Any]] = {}
    section_errors: dict[str, ReportBuildError] = {}
    if not is_diff:
        for key, filename in ANALYZER_OUTPUTS.items():
            payload, load_error = _load_object(run_dir / filename, required=False)
            if load_error:
                section_errors[key] = load_error
            elif payload is not None:
                analyzer_data[key] = payload

    tasks: list[dict[str, Any]] | None = None
    results: list[dict[str, Any]] | None = None
    malformed_events = 0
    if not isinstance(bundle.get("data_quality"), list) or not bundle.get("data_quality"):
        tasks, results, malformed_events = _load_events(run_dir / "events.ndjson")
    quality = build_data_quality(bundle, tasks, results)
    if malformed_events:
        for item in quality:
            item.setdefault("invalid_record_counts", {})["malformed_ndjson_lines"] = malformed_events
            item.setdefault("warnings", []).append(
                f"{malformed_events} malformed events.ndjson line(s) were ignored during compatibility loading."
            )

    generated_at = _aware(generated_at) or _aware(bundle.get("analysis_timestamp")) or datetime.now(timezone.utc)
    source = _source(bundle.get("source"))
    run_kind = "diff" if is_diff else ("multi-operation" if source == "multi-operation" else "operation")
    run_id = _run_id(bundle, diff, run_dir)
    model_revision = revision if revision is not None else _next_revision(run_dir, run_id)
    retention = _retention(bundle, analyzer_data)
    data_quality = [_quality_entry(item) for item in quality]
    warnings = _report_warnings(data_quality, section_errors)

    model_data: dict[str, Any] = {
        "report_model_version": REPORT_MODEL_VERSION,
        "revision": model_revision,
        "generated_at": generated_at,
        "janus_version": str(bundle.get("janus_version") or "unknown"),
        "run_id": run_id,
        "run": _run_metadata(bundle, run_kind, retention, generated_at),
        "sources": _sources(bundle, data_quality),
        "retention": retention,
        "data_quality": data_quality,
        "warnings": warnings,
        "summary": _summary(bundle, analyzer_data, quality),
        "sections": _diff_sections(diff or {}, source) if is_diff else _sections(
            analyzer_data, section_errors, bundle, source, quality
        ),
        "capabilities": _capabilities(is_diff, include_previous_runs),
        "previous_runs": _previous_runs(run_dir, bundle) if include_previous_runs and not is_diff else [],
        "diff": _diff_metadata(diff or {}) if is_diff else None,
    }
    try:
        return ReportBuildResult(model=ReportModel.model_validate(model_data))
    except Exception as exc:
        return ReportBuildResult(errors=[ReportBuildError("model-validation-failed", "Report model validation failed.", str(run_dir))])


def write_report_model_atomically(model: ReportModel, output_path: Path) -> None:
    """Publish a fully validated model without exposing a partial JSON file."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    payload = model.model_dump_json(indent=2, exclude_none=True) + "\n"
    fd, temporary_name = tempfile.mkstemp(prefix=f".{output_path.name}.", suffix=".tmp", dir=output_path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_name, output_path)
        try:
            directory_fd = os.open(output_path.parent, os.O_DIRECTORY)
        except (AttributeError, OSError):
            return
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    except Exception:
        try:
            os.unlink(temporary_name)
        except FileNotFoundError:
            pass
        raise


def _load_object(path: Path, *, required: bool) -> tuple[dict[str, Any] | None, ReportBuildError | None]:
    if not path.exists():
        return (None, ReportBuildError("artifact-missing", f"Required artifact {path.name} is missing.", str(path))) if required else (None, None)
    try:
        with path.open(encoding="utf-8-sig") as handle:
            payload = json.load(handle)
    except (OSError, json.JSONDecodeError):
        return None, ReportBuildError("artifact-invalid", f"Artifact {path.name} is not valid JSON.", str(path))
    if not isinstance(payload, dict):
        return None, ReportBuildError("artifact-invalid", f"Artifact {path.name} must be a JSON object.", str(path))
    return payload, None


def _load_events(path: Path) -> tuple[list[dict[str, Any]], list[dict[str, Any]], int]:
    tasks: list[dict[str, Any]] = []
    results: list[dict[str, Any]] = []
    bad = 0
    if not path.exists():
        return tasks, results, bad
    with path.open(encoding="utf-8-sig") as handle:
        for line in handle:
            if not line.strip():
                continue
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                bad += 1
                continue
            if not isinstance(event, dict):
                bad += 1
            elif event.get("event_type") == "task":
                tasks.append(event)
            elif event.get("event_type") == "result":
                results.append(event)
    return tasks, results, bad


def _source(value: object) -> str:
    return _SOURCE_MAP.get(str(value or "").lower(), "unknown")


def _int(value: object, default: int = 0) -> int:
    try:
        return max(0, int(value))
    except (TypeError, ValueError):
        return default


def _number(value: object) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number >= 0 else None


def _aware(value: object) -> datetime | None:
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc) if value.tzinfo else None
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed.astimezone(timezone.utc) if parsed.tzinfo else None


def _retention(bundle: dict[str, Any], analyses: dict[str, dict[str, Any]]) -> dict[str, Any]:
    args = str(bundle.get("arguments_rule") or "unknown")
    output = str(bundle.get("output_rule") or "unknown")
    observed_args = list(bundle.get("observed_arguments_rules") or [])
    observed_output = list(bundle.get("observed_output_rules") or [])
    if args == "unknown" or output == "unknown":
        for payload in analyses.values():
            metadata = payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {}
            data = metadata.get("retention") if isinstance(metadata.get("retention"), dict) else {}
            observed_args.extend(data.get("observed_arguments_rules") or [])
            observed_output.extend(data.get("observed_output_rules") or [])
    return {
        "arguments": args if args in {"all", "none", "drop", "hash", "features_only", "mixed"} else "unknown",
        "output": output if output in {"all", "none", "drop", "hash", "features_only", "errors_only", "mixed"} else "unknown",
        "observed_argument_rules": sorted({str(item) for item in observed_args if str(item)}),
        "observed_output_rules": sorted({str(item) for item in observed_output if str(item)}),
        "limitations": _retention_limitations(args, output),
    }


def _retention_limitations(arguments: str, output: str) -> list[str]:
    values = []
    if arguments not in {"", "all", "unknown"}:
        values.append(f"Raw task arguments are limited by the {arguments} retention policy.")
    if output not in {"", "all", "unknown"}:
        values.append(f"Result output is limited by the {output} retention policy.")
    return values


def _run_id(bundle: dict[str, Any], diff: dict[str, Any] | None, run_dir: Path) -> str:
    if diff:
        baseline = (diff.get("baseline") or {}).get("run_id")
        candidate = (diff.get("candidate") or {}).get("run_id")
        if baseline and candidate:
            return _safe_id(f"{baseline}-vs-{candidate}")
    explicit = bundle.get("run_id")
    if explicit:
        return _safe_id(str(explicit))
    base = bundle.get("operation_slug") or bundle.get("operation_id") or run_dir.name
    version = bundle.get("analysis_version") or bundle.get("analysis_timestamp")
    return _safe_id(f"{base}:{version}" if version else str(base))


def _safe_id(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9._:-]+", "-", value).strip("-") or "unknown-run"


def _next_revision(run_dir: Path, run_id: str) -> int:
    previous, error = _load_object(run_dir / "report-model.json", required=False)
    if error is None and previous and previous.get("run_id") == run_id:
        return _int(previous.get("revision"), 0) + 1
    return 1


def _run_metadata(bundle: dict[str, Any], kind: str, retention: dict[str, Any], generated_at: datetime) -> dict[str, Any]:
    status = _status(bundle.get("status_counts"))
    operations = []
    for operation in bundle.get("operations") or []:
        if isinstance(operation, dict):
            operations.append({"operation_id": _text(operation.get("operation_id")), "operation_name": str(operation.get("operation_name") or "Unknown operation"), "operation_slug": _text(operation.get("operation_slug")), "task_count": _int(operation.get("task_count")), "result_count": _int(operation.get("result_count"))})
    return {"run_kind": kind, "operation_name": str(bundle.get("operation_name") or "Unknown operation"), "operation_id": _text(bundle.get("operation_id")), "operation_slug": _text(bundle.get("operation_slug")), "operations": operations, "analysis_completed_at": _aware(bundle.get("analysis_timestamp")) or generated_at, "task_count": _int(bundle.get("task_count")), "result_count": _int(bundle.get("result_count")), "status_distribution": status, "parser_version": _text(bundle.get("parser_version")), "janus_version": str(bundle.get("janus_version") or "unknown"), "retention": retention}


def _text(value: object) -> str | None:
    return str(value) if value not in (None, "") else None


def _status(value: object) -> dict[str, int]:
    raw = value if isinstance(value, dict) else {}
    return {"success": _int(raw.get("success")), "error": _int(raw.get("error")), "unknown": _int(raw.get("unknown")), "other": sum(_int(v) for k, v in raw.items() if k not in {"success", "error", "unknown", "total"})}


def _quality_entry(item: dict[str, Any]) -> dict[str, Any]:
    invalid = item.get("invalid_record_counts") if isinstance(item.get("invalid_record_counts"), dict) else {}
    return {"source": _source(item.get("source")), "events_parsed": _int(item.get("events_parsed")), "skipped_entries": _int(item.get("skipped_entries")), "malformed_records": sum(_int(v) for v in invalid.values()), "invalid_timestamps": _int(item.get("invalid_timestamps")), "fallback_task_ids": _int(item.get("fallback_task_ids")), "status_distribution": _status(item.get("status_distribution")), "unknown_status_percent": min(100.0, float(item.get("unknown_status_percent") or 0.0)), "retention_limitations": _retention_limitations(str(item.get("argument_retention") or "unknown"), str(item.get("output_retention") or "unknown")), "analyzer_confidence_warnings": [str(w) for w in item.get("warnings") or []], "suppression_reasons": {}, "source_limitations": [], "processing_errors": [], "invalid_record_counts": {str(k): _int(v) for k, v in invalid.items()}}


def _sources(bundle: dict[str, Any], quality: list[dict[str, Any]]) -> list[dict[str, Any]]:
    source = _source(bundle.get("source"))
    if source == "multi-operation":
        return [{"kind": "multi-operation", "subtype": "merged"}]
    endpoint = next((bundle.get(k) for k in ("mythic_endpoint", "ghostwriter_endpoint", "cobaltstrike_rest_endpoint") if bundle.get(k)), None)
    parsed = urlsplit(str(endpoint)) if endpoint else None
    return [{"kind": source, "subtype": _text(bundle.get("source_subtype")), "endpoint_label": parsed.netloc if parsed and parsed.netloc else None, "parser_version": _text(bundle.get("parser_version"))}]


def _summary(bundle: dict[str, Any], analyses: dict[str, dict[str, Any]], quality: list[dict[str, Any]]) -> dict[str, Any]:
    visual = analyses.get("summary-visualization", {})
    status = _status(visual.get("status_distribution") or bundle.get("status_counts"))
    span_hours = _number((visual.get("summary") or {}).get("span_hours"))
    callbacks = (analyses.get("callback-health", {}).get("summary") or {}).get("total_callbacks")
    return {"task_count": _int(bundle.get("task_count") or (visual.get("summary") or {}).get("total_tasks")), "result_count": _int(bundle.get("result_count") or (visual.get("summary") or {}).get("total_results")), "status_distribution": status, "operation_count": max(1, _int(bundle.get("operation_count"), 1)), "callback_count": _int(callbacks) if callbacks is not None else None, "span_seconds": span_hours * 3600 if span_hours is not None else None}


def _report_warnings(quality: list[dict[str, Any]], errors: dict[str, ReportBuildError]) -> list[dict[str, Any]]:
    warnings = []
    for item in quality:
        for message in item["analyzer_confidence_warnings"]:
            warnings.append({"code": "data-quality", "category": "analyzer-confidence", "message": message, "source": item["source"]})
    for section_id in sorted(errors):
        warnings.append({"code": "analyzer-artifact-invalid", "category": "processing-error", "message": f"{_TITLES[section_id]} could not be loaded.", "section_id": section_id})
    return warnings


def _capabilities(is_diff: bool, has_previous: bool) -> list[str]:
    values = ["table-search", "table-sort", "table-filter", "expandable-rows", "safe-external-links"]
    if has_previous:
        values.append("previous-runs")
    if is_diff:
        values.append("run-diff")
    return values


def _sections(analyses: dict[str, dict[str, Any]], errors: dict[str, ReportBuildError], bundle: dict[str, Any], source: str, quality: list[dict[str, Any]]) -> list[dict[str, Any]]:
    resolved = sum(entry["status_distribution"][key] for entry in quality for key in ("success", "error"))
    result_count = sum(sum(entry["status_distribution"].values()) for entry in quality)
    suppressed = set()
    if result_count and not resolved:
        suppressed = {"command-failure-summary", "command-retry-success", "callback-health"}
    sections = []
    for kind in ANALYZER_OUTPUTS:
        if kind in errors:
            sections.append(_envelope(kind, source, "error", "Analyzer artifact could not be loaded."))
        elif kind in suppressed:
            reason = "Reliable result statuses are unavailable, so this failure-driven analysis is suppressed."
            sections.append(_envelope(kind, source, "suppressed", reason))
        elif kind not in analyses:
            sections.append(_envelope(kind, source, "missing", "Analyzer output is not present in this run."))
        else:
            try:
                sections.append(_map_section(kind, analyses[kind], source, _mythic_base(bundle)))
            except (KeyError, TypeError, ValueError):
                sections.append(_envelope(kind, source, "error", "Analyzer output could not be adapted."))
    sections.append({**_envelope("data-quality", source, "available"), "entries": [_quality_entry(item) for item in quality]})
    return sections


def _envelope(kind: str, source: str, status: str, reason: str | None = None) -> dict[str, Any]:
    value: dict[str, Any] = {"kind": kind, "id": kind, "title": _TITLES[kind], "status": status, "warnings": [], "sources": [source], "confidence": "unknown"}
    if reason:
        value["status_reason"] = reason
    return value


def _map_section(kind: str, data: dict[str, Any], source: str, endpoint: str | None) -> dict[str, Any]:
    section = _envelope(kind, source, "available")
    if kind == "summary-visualization":
        timeline = []
        for bucket in (data.get("timeline") or {}).get("buckets") or []:
            timestamp = _bucket_timestamp(bucket.get("label"))
            if timestamp:
                timeline.append({"starts_at": timestamp, "count": _int(bucket.get("count"))})
        section.update(status_distribution=_status(data.get("status_distribution")), timeline=timeline, span_seconds=(_number((data.get("summary") or {}).get("span_hours")) or 0) * 3600)
    elif kind == "command-failure-summary":
        commands = []
        for name, value in sorted((data.get("commands") or {}).items()):
            failures = [{"task": _task_ref(row, endpoint), "status": "error", "dispatch_failed": bool(row.get("dispatch_failed")), "output_preview": _preview(row.get("error_message"), row, "output", decode=True)} for row in value.get("failures") or []]
            commands.append({"command_name": name, "execution_count": _int(value.get("execution_count")), "success_count": _int(value.get("success_count")), "error_count": _int(value.get("error_count")), "unknown_count": _int(value.get("unknown_count")), "failure_rate": _number(value.get("failure_rate")), "affected_callbacks": len(value.get("callback_breakdown") or {}), "failures": failures})
        section["commands"] = commands
    elif kind == "command-retry-success":
        sequences = []
        for value in data.get("retry_patterns") or []:
            transitions = [{"from_attempt": _int(row.get("from_attempt"), 1), "to_attempt": _int(row.get("to_attempt"), 2), "changes": [str(c) for c in row.get("changes") or []], "note": None} for row in value.get("argument_changes_structured") or []]
            sequences.append({"command_name": str(value.get("command_name") or "unknown"), "attempts": max(1, _int(value.get("attempt_count"), 1)), "succeeded": value.get("final_status") == "success", "duration_seconds": _number(value.get("time_span_seconds")), "tasks": [_task_ref(row, endpoint) for row in value.get("attempts") or []], "final_status": _text(value.get("final_status")), "transitions": transitions, "intervening_tasks": [_task_ref(row, endpoint) for row in value.get("intervening_commands") or []]})
        section["sequences"] = sequences
    elif kind == "command-duration":
        commands = []
        for name, value in sorted((data.get("durations") or {}).items()):
            commands.append({"command_name": name, "execution_count": _int(value.get("execution_count")), "mean_seconds": _number(value.get("mean_seconds")), "median_seconds": _number(value.get("median_seconds")), "p95_seconds": _number(value.get("p95_seconds")), "max_seconds": _number(value.get("max_seconds")), "min_seconds": _number(value.get("min_seconds")), "outlier_count": _int(value.get("outlier_count")), "slowest_task": _task_ref(value["max_event"], endpoint) if isinstance(value.get("max_event"), dict) else None, "outlier_tasks": [_task_ref(row, endpoint) for row in value.get("outlier_events") or []]})
        section["commands"] = commands
    elif kind == "friction-score":
        section["candidates"] = [{"command_name": str(row.get("command_name") or "unknown"), "score": _number(row.get("score")) or 0, "confidence": str(row.get("confidence") or "unknown"), "sample_size": _int(row.get("total_executions")), "recommended_action": str(row.get("recommended_action") or "none"), "suppressed": bool(row.get("action_override")), "components": {str(k): float(v) for k, v in row.items() if k in {"failure_rate", "retry_density", "retry_to_success_rate", "median_duration_seconds", "p95_duration_seconds", "callback_health_penalty", "argument_anomaly_rate"} and _number(v) is not None}, "confidence_reasons": [str(v) for v in row.get("confidence_reasons") or []], "limitations": [str(v) for v in row.get("limitations") or []], "drivers": [{"component": str(v.get("component") or "unknown"), "value": _number(v.get("value")) or 0, "impact": _number(v.get("impact")) or 0, "label": str(v.get("label") or "")} for v in row.get("drivers") or []]} for row in data.get("commands") or []]
    elif kind == "outlier-context":
        section["outliers"] = [{"task": _task_ref(row, endpoint), "duration_seconds": _number(row.get("duration_seconds")) or 0, "preceding": [_task_ref(v, endpoint) for v in (row.get("preceding") or row.get("preceding_context") or [])], "following": [_task_ref(v, endpoint) for v in (row.get("following") or row.get("following_context") or [])], "sequence_signature": _text(row.get("sequence_signature"))} for row in data.get("outliers") or []]
    elif kind == "callback-health":
        rows = []
        for callback_id, value in sorted((data.get("callbacks") or {}).items()):
            rows.append({"callback_id": str(value.get("callback_id") or callback_id), "callback_display_id": _text(value.get("callback_display_id")), "task_count": _int(value.get("task_count")), "success_count": _int(value.get("success_count")), "error_count": _int(value.get("error_count")), "unknown_count": _int(value.get("unknown_count")), "completion_rate": _number(value.get("completion_rate")), "consecutive_failure_count": _int(value.get("consecutive_failure_count")), "has_consecutive_failures": bool(value.get("has_consecutive_failures")), "first_task_at": _aware(value.get("first_task_timestamp")), "last_task_at": _aware(value.get("last_task_timestamp")), "trailing_failures": [_task_ref(row, endpoint) for row in value.get("trailing_failures") or []], "last_successful_task": _task_ref(value["last_successful_task"], endpoint) if isinstance(value.get("last_successful_task"), dict) else None, "link": _callback_link(value.get("callback_id") or callback_id, value.get("callback_display_id"), endpoint)})
        section["callbacks"] = rows
    elif kind == "av-tracker":
        section.update(scanned_task_count=_int((data.get("summary") or {}).get("ps_tasks_scanned")), detections=[{"vendor": str(row.get("vendor_name") or row.get("vendor") or "unknown"), "matched_executables": [str(v) for v in row.get("matched_executables") or []], "occurrence_count": max(1, _int(row.get("occurrence_count"), 1)), "task": _task_ref(row, endpoint), "status": _text(row.get("status"))} for row in data.get("detections") or []])
    elif kind == "dwell-time":
        stats = data.get("global_statistics") or {}
        rows = data.get("measurements") or stats.get("outlier_events") or []
        section.update(median_seconds=_number(stats.get("median_seconds")), p95_seconds=_number(stats.get("p95_seconds")), max_seconds=_number(stats.get("max_seconds")), measurement_count=_int((data.get("metadata") or {}).get("dwell_count"), len(rows)), distribution=[{"label": str(row.get("label") or ""), "min_seconds": _number(row.get("min_seconds")) or 0, "max_seconds": _number(row.get("max_seconds")) or 0, "count": _int(row.get("count"))} for row in data.get("distribution") or []], measurements=[{"from_task": _task_ref({"task_id": row.get("from_task_id"), "display_id": row.get("from_display_id"), "command_name": row.get("from_command"), "timestamp": row.get("from_timestamp"), "arguments_raw": row.get("from_arguments_raw"), "arguments_retained": row.get("from_arguments_retained")}, endpoint), "to_task": _task_ref({"task_id": row.get("to_task_id"), "display_id": row.get("to_display_id"), "command_name": row.get("to_command"), "timestamp": row.get("to_timestamp"), "arguments_raw": row.get("to_arguments_raw"), "arguments_retained": row.get("to_arguments_retained")}, endpoint), "dwell_seconds": _number(row.get("dwell_seconds")) or 0} for row in rows])
    elif kind == "parameter-entropy":
        summary = data.get("summary") or {}
        section.update(findings=[{"task": _task_ref(row, endpoint), "finding_type": str(row.get("finding_type") or "unknown"), "token_entropy": _number(row.get("token_entropy")), "detail": str(row.get("detail") or "")} for row in data.get("findings") or []], repeated_token_count=_int(summary.get("repeated_high_entropy_tokens")), repeated_tokens=[{"token_prefix": str(row.get("token_prefix") or ""), "entropy_mean": _number(row.get("entropy_mean")), "occurrences": _int(row.get("occurrences")), "task_ids": [str(v) for v in row.get("task_ids") or []], "commands": [str(v) for v in row.get("commands") or []], "detail": str(row.get("detail") or "")} for row in data.get("repeated_high_entropy") or []])
    elif kind == "argument-position-profile":
        summary = data.get("summary") or {}
        section.update(findings=[_argument_finding(row, endpoint) for row in data.get("findings") or []], commands_profiled=_int(summary.get("commands_profiled")), max_depth=_int(summary.get("max_depth_observed")), depth_distribution=[{"command_name": str(row.get("command_name") or "unknown"), "task_count": _int(row.get("task_count")), "min_depth": _int(row.get("min_depth")), "max_depth": _int(row.get("max_depth")), "mean_depth": _number(row.get("mean_depth")) or 0} for row in data.get("depth_distribution") or []], command_profiles=[{"command_name": str(name), "task_count": _int(value.get("task_count")), "positions": len(value.get("positions") or [])} for name, value in (data.get("per_command") or {}).items() if isinstance(value, dict)])
    elif kind == "tool-dump":
        section["groups"] = [{"id": _safe_id(str(row.get("name") or "group")), "name": str(row.get("name") or "Unnamed group"), "description": _text(row.get("description")), "match_count": _int(row.get("match_count")), "unique_command_count": _int(row.get("unique_command_count")), "artifact_path": _relative_artifact(row.get("dump_path")), "entries": [_task_ref(value, endpoint) for value in row.get("entries") or []]} for row in data.get("groups") or []]
    return section


def _argument_finding(row: dict[str, Any], endpoint: str | None) -> dict[str, Any]:
    tasks = [_task_ref(value, endpoint) for value in row.get("task_refs") or []]
    occurrences = row.get("occurrences", row.get("deviation_count", row.get("tasks_at_position", row.get("task_count", 0))))
    sample = row.get("tasks_at_position", row.get("total_command_tasks", row.get("task_count", 0)))
    ratio = row.get("fraction", row.get("diversity_ratio"))
    if ratio is None and row.get("reach_pct") is not None:
        ratio = _number(row.get("reach_pct"))
        ratio = ratio / 100 if ratio is not None else None
    return {"command_name": str(row.get("command_name") or "unknown"), "position": _int(row.get("position")) if row.get("position") is not None else None, "finding_type": str(row.get("type") or "unknown"), "occurrences": _int(occurrences), "sample_size": _int(sample), "ratio": _number(ratio), "detail": json.dumps(row, sort_keys=True, ensure_ascii=False), "tasks": tasks}


def _preview(value: object, record: dict[str, Any], prefix: str, *, decode: bool = False) -> dict[str, Any] | None:
    retention = str(record.get(f"{prefix}_retained") or "all")
    text = str(value or "")
    original_length = _int(record.get(f"{prefix}_length"), len(text))
    if retention in {"none", "drop", "hash", "features_only"}:
        return {"text": None, "original_length": original_length, "retention": retention if retention != "drop" else "drop"}
    decoded, binary = _decode_output(text) if decode else (text, False)
    if binary:
        return {"text": None, "binary": True, "original_length": original_length, "retention": retention}
    return {"text": decoded[:MAX_PREVIEW_CHARS], "decoded": decode and decoded != text, "truncated": len(decoded) > MAX_PREVIEW_CHARS, "original_length": original_length, "retention": retention}


def _decode_output(text: str) -> tuple[str, bool]:
    lines = []
    binary = False
    for line in text.split("\n"):
        stripped = line.strip()
        if not stripped or not re.fullmatch(r"[A-Za-z0-9+/]+={0,2}", stripped):
            lines.append(line)
            continue
        try:
            decoded = base64.b64decode(stripped, validate=True)
            candidate = decoded.decode("utf-8")
        except (ValueError, UnicodeDecodeError):
            lines.append(line)
            continue
        printable = sum(char.isprintable() or char in "\n\r\t" for char in candidate)
        if candidate and printable / len(candidate) < 0.8:
            binary = True
            continue
        lines.append(candidate.rstrip("\r\n"))
    return "\n".join(lines), binary


def _task_ref(row: dict[str, Any], endpoint: str | None) -> dict[str, Any]:
    task_id = str(row.get("task_id") or "unknown")
    display = _text(row.get("display_id"))
    return {"task_id": task_id, "display_id": display, "callback_id": _text(row.get("callback_id")), "command_name": _text(row.get("pty_shell_command") or row.get("command_name")), "argument_preview": _preview(row.get("arguments_raw"), row, "arguments"), "timestamp": _aware(row.get("timestamp")), "link": _task_link(task_id, display, endpoint)}


def _mythic_base(bundle: dict[str, Any]) -> str | None:
    endpoint = bundle.get("mythic_endpoint")
    if not endpoint:
        return None
    try:
        parsed = urlsplit(str(endpoint))
    except ValueError:
        return None
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return None
    path = parsed.path.rsplit("/", 1)[0] if "/" in parsed.path else ""
    return urlunsplit((parsed.scheme, parsed.netloc, path.rstrip("/"), "", ""))


def _task_link(task_id: str, display_id: str | None, base: str | None) -> dict[str, Any] | None:
    if not base:
        return None
    target = display_id or task_id
    return {"label": f"T-{target}" if display_id else f"Task {target}", "url": f"{base}/new/task/{quote(target, safe='')}", "kind": "task"}


def _callback_link(callback_id: object, display_id: object, base: str | None) -> dict[str, Any] | None:
    if not base:
        return None
    target = str(display_id or callback_id)
    return {"label": f"CB {target}", "url": f"{base}/new/callbacks/{quote(target, safe='')}", "kind": "callback"}


def _bucket_timestamp(value: object) -> datetime | None:
    text = str(value or "")
    for candidate in (text.replace(" ", "T") + ":00:00Z", text + "T00:00:00Z"):
        parsed = _aware(candidate)
        if parsed:
            return parsed
    return None


def _relative_artifact(value: object) -> str | None:
    if not value:
        return None
    path = Path(str(value))
    return path.name if path.name else None


def _previous_runs(run_dir: Path, bundle: dict[str, Any]) -> list[dict[str, Any]]:
    slug = str(bundle.get("operation_slug") or "")
    version = str(bundle.get("analysis_version") or "")
    if not slug or not version:
        return []
    pattern = re.compile(rf"^{re.escape(slug)}_(\d{{8}}_\d{{6}})(?:_[a-f0-9]{{8}})?$")
    values = []
    for candidate in run_dir.parent.iterdir():
        match = pattern.match(candidate.name) if candidate.is_dir() else None
        if not match or match.group(1) == version or not (candidate / "report.html").exists():
            continue
        previous, error = _load_object(candidate / "bundle.json", required=False)
        if error or previous is None:
            continue
        generated = _aware(previous.get("analysis_timestamp"))
        if generated is None:
            continue
        values.append({"run_id": _run_id(previous, None, candidate), "generated_at": generated, "label": str(previous.get("analysis_version") or candidate.name), "link": {"label": "Previous report", "url": f"../{candidate.name}/report.html", "kind": "report"}})
    return sorted(values, key=lambda item: item["generated_at"], reverse=True)


def _diff_metadata(diff: dict[str, Any]) -> dict[str, Any]:
    baseline = diff.get("baseline") or {}
    candidate = diff.get("candidate") or {}
    comparability = diff.get("comparability") or {}
    return {"baseline_run_id": _safe_id(str(baseline.get("run_id") or "baseline")), "candidate_run_id": _safe_id(str(candidate.get("run_id") or "candidate")), "comparability_status": _comparability(comparability.get("status")), "warnings": [str(value) for value in comparability.get("warnings") or []]}


def _comparability(value: object) -> str:
    return {"comparable": "comparable", "comparable_with_warnings": "comparable-with-warnings", "not_comparable": "not-comparable"}.get(str(value), "unknown")


def _diff_sections(diff: dict[str, Any], source: str) -> list[dict[str, Any]]:
    comparability = diff.get("comparability") or {}
    findings = []
    for row in diff.get("findings") or []:
        if not isinstance(row, dict):
            continue
        findings.append({"metric_id": _safe_id(str(row.get("metric") or "unknown")), "entity_id": str(row.get("entity") or "all"), "classification": {"improvement": "improvement", "regression": "regression", "low-confidence change": "low-confidence-change", "low_confidence_change": "low-confidence-change", "not_comparable": "not-comparable"}.get(str(row.get("classification")), "unchanged"), "confidence": str(row.get("confidence") or "unknown"), "baseline_value": row.get("baseline_value"), "candidate_value": row.get("candidate_value"), "delta": row.get("absolute_delta") if isinstance(row.get("absolute_delta"), (int, float)) else None, "explanation": str(row.get("reason") or row.get("display") or "")})
    entity = lambda row: {"entity_type": str(row.get("entity_type") or row.get("type") or "entity"), "entity_id": str(row.get("entity") or row.get("name") or "unknown"), "count": _int(row.get("count") or row.get("candidate_count") or row.get("baseline_count"))}
    summary = diff.get("summary") or {}
    return [{**_envelope("run-diff", source, "available"), "comparability_status": _comparability(comparability.get("status")), "findings": findings, "summary": {"likely_regressions": _int(summary.get("likely_regressions")), "likely_improvements": _int(summary.get("likely_improvements")), "low_confidence_changes": _int(summary.get("low_confidence_changes")), "not_comparable": _int(summary.get("not_comparable"))}, "new_entities": [entity(row) for row in diff.get("new_entities") or [] if isinstance(row, dict)], "removed_entities": [entity(row) for row in diff.get("removed_entities") or [] if isinstance(row, dict)]}]
