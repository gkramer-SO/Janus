#!/usr/bin/env python3
"""Generate compact, representative Phase 1 report-model fixtures."""

from __future__ import annotations

import copy
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "Tests/fixtures/reports"
STAMP = "2026-07-27T16:00:00Z"


def quality(source: str, *, unknown: int = 0, warnings: list[str] | None = None) -> dict:
    total = 6
    return {
        "source": source,
        "events_parsed": 12,
        "skipped_entries": 0,
        "malformed_records": 0,
        "invalid_timestamps": 0,
        "fallback_task_ids": 0,
        "status_distribution": {
            "success": total - unknown - 1,
            "error": 1,
            "unknown": unknown,
            "other": 0,
        },
        "unknown_status_percent": unknown / total * 100,
        "retention_limitations": [],
        "analyzer_confidence_warnings": warnings or [],
        "suppression_reasons": {},
        "source_limitations": [],
        "processing_errors": [],
        "invalid_record_counts": {},
    }


def section(kind: str, title: str, **data: object) -> dict:
    return {
        "kind": kind,
        "id": kind,
        "title": title,
        "status": "available",
        "warnings": [],
        "sources": ["mythic"],
        "confidence": "high",
        **data,
    }


def task(task_id: str = "101") -> dict:
    return {
        "task_id": task_id,
        "display_id": task_id,
        "callback_id": "7",
        "command_name": "execute-assembly",
        "timestamp": "2026-07-27T15:00:00Z",
        "link": {
            "label": f"Task {task_id}",
            "url": f"https://mythic.local/new/task/{task_id}",
            "kind": "task",
        },
    }


def complete_mythic() -> dict:
    q = quality("mythic")
    sections = [
        section(
            "summary-visualization",
            "Summary Analysis",
            status_distribution=q["status_distribution"],
            timeline=[{"starts_at": "2026-07-27T15:00:00Z", "count": 6}],
            span_seconds=3600,
        ),
        section(
            "command-failure-summary",
            "Command Failure Summary",
            commands=[
                {
                    "command_name": "execute-assembly",
                    "execution_count": 6,
                    "success_count": 5,
                    "error_count": 1,
                    "unknown_count": 0,
                    "failure_rate": 1 / 6,
                    "affected_callbacks": 1,
                }
            ],
        ),
        section(
            "command-retry-success",
            "Command Retry Success",
            sequences=[
                {
                    "command_name": "execute-assembly",
                    "attempts": 2,
                    "succeeded": True,
                    "duration_seconds": 4.25,
                    "tasks": [task("100"), task("101")],
                }
            ],
        ),
        section(
            "command-duration",
            "Command Duration",
            commands=[
                {
                    "command_name": "execute-assembly",
                    "execution_count": 6,
                    "median_seconds": 2.5,
                    "p95_seconds": 4.1,
                    "max_seconds": 4.25,
                    "outlier_count": 1,
                    "slowest_task": task(),
                }
            ],
        ),
        section(
            "friction-score",
            "Top Friction Candidates",
            candidates=[
                {
                    "command_name": "execute-assembly",
                    "score": 42.5,
                    "confidence": "high",
                    "sample_size": 6,
                    "recommended_action": "investigate",
                    "components": {"failure_rate": 16.67, "duration": 25.83},
                }
            ],
        ),
        section(
            "outlier-context",
            "Outlier Context",
            outliers=[
                {
                    "task": task(),
                    "duration_seconds": 4.25,
                    "preceding": [task("100")],
                    "following": [],
                    "sequence_signature": "sleep>execute-assembly",
                }
            ],
        ),
        section(
            "callback-health",
            "Callback Health",
            callbacks=[
                {
                    "callback_id": "7",
                    "callback_display_id": "7",
                    "task_count": 6,
                    "consecutive_failure_count": 1,
                    "has_consecutive_failures": False,
                    "first_task_at": "2026-07-27T15:00:00Z",
                    "last_task_at": "2026-07-27T16:00:00Z",
                    "trailing_failures": [],
                    "link": {
                        "label": "Callback 7",
                        "url": "https://mythic.local/new/callbacks/7",
                        "kind": "callback",
                    },
                }
            ],
        ),
        section(
            "av-tracker",
            "AV Tracker",
            scanned_task_count=2,
            detections=[
                {
                    "vendor": "Example EDR",
                    "matched_executables": ["sensor.exe"],
                    "occurrence_count": 1,
                    "task": task(),
                    "status": "observed",
                }
            ],
        ),
        section(
            "dwell-time",
            "Dwell Time",
            measurements=[
                {
                    "from_task": task("100"),
                    "to_task": task("101"),
                    "dwell_seconds": 12.5,
                }
            ],
            median_seconds=12.5,
            p95_seconds=12.5,
            max_seconds=12.5,
        ),
        section(
            "parameter-entropy",
            "Parameter Entropy",
            findings=[
                {
                    "task": task(),
                    "finding_type": "high-entropy-token",
                    "token_entropy": 4.2,
                    "detail": "An uncommon token structure was observed.",
                }
            ],
            repeated_token_count=0,
        ),
        section(
            "argument-position-profile",
            "Argument Position Profile",
            findings=[
                {
                    "command_name": "execute-assembly",
                    "position": 0,
                    "finding_type": "static-argument",
                    "occurrences": 6,
                    "sample_size": 6,
                    "ratio": 1,
                    "detail": "Position 0 was constant.",
                    "tasks": [task()],
                }
            ],
            commands_profiled=1,
            max_depth=2,
        ),
        section(
            "tool-dump",
            "Tool Dump",
            groups=[
                {
                    "id": "assembly-tools",
                    "name": "Assembly tools",
                    "description": "Registry-selected assembly execution tasks.",
                    "match_count": 6,
                    "unique_command_count": 1,
                    "artifact_path": "tool-dump/assembly-tools.ndjson",
                }
            ],
        ),
        section("data-quality", "Data Quality", entries=[q]),
    ]
    return {
        "report_model_version": "1.0.0",
        "revision": 1,
        "generated_at": STAMP,
        "janus_version": "1.5.0-dev",
        "run_id": "mythic-complete-42",
        "run": {
            "run_kind": "operation",
            "operation_name": "Operation Complete",
            "operation_id": "42",
            "operation_slug": "operation-complete",
            "analysis_started_at": "2026-07-27T15:59:00Z",
            "analysis_completed_at": STAMP,
            "task_count": 6,
            "result_count": 6,
            "status_distribution": q["status_distribution"],
            "parser_version": "mythic-v1",
            "janus_version": "1.5.0-dev",
            "retention": {"arguments": "all", "output": "all"},
        },
        "sources": [
            {
                "kind": "mythic",
                "subtype": "graphql",
                "endpoint_label": "mythic.local",
                "parser_version": "mythic-v1",
            }
        ],
        "retention": {"arguments": "all", "output": "all"},
        "data_quality": [q],
        "warnings": [],
        "summary": {
            "task_count": 6,
            "result_count": 6,
            "status_distribution": q["status_distribution"],
            "operation_count": 1,
            "callback_count": 1,
            "span_seconds": 3600,
        },
        "sections": sections,
        "capabilities": [
            "table-search",
            "table-sort",
            "table-filter",
            "expandable-rows",
            "safe-external-links",
            "previous-runs",
        ],
        "previous_runs": [
            {
                "run_id": "mythic-previous-41",
                "generated_at": "2026-07-26T16:00:00Z",
                "label": "Previous run",
                "link": {
                    "label": "Previous report",
                    "url": "operation-complete_20260726/report.html",
                    "kind": "report",
                },
            }
        ],
    }


def unavailable(kind: str, title: str, status: str, reason: str) -> dict:
    result = section(kind, title)
    result.update({"status": status, "status_reason": reason, "confidence": "unknown"})
    payload_key = {
        "command-failure-summary": "commands",
        "command-retry-success": "sequences",
        "callback-health": "callbacks",
        "command-duration": "commands",
    }.get(kind)
    if payload_key:
        result[payload_key] = []
    return result


def scenarios() -> dict[str, dict]:
    complete = complete_mythic()

    partial = copy.deepcopy(complete)
    partial["run_id"] = "mythic-partial-42"
    partial["run"]["operation_name"] = "Operation Partial"
    partial["warnings"] = [
        {
            "code": "partial-export",
            "category": "source-limitation",
            "message": "The Mythic export is partial.",
            "source": "mythic",
        }
    ]
    partial["data_quality"][0]["source_limitations"] = ["Partial task history."]
    partial["data_quality"][0]["analyzer_confidence_warnings"] = ["Duration coverage is partial."]
    partial["sections"] = partial["sections"][:4] + [partial["sections"][-1]]

    ghost = copy.deepcopy(complete)
    ghost["run_id"] = "ghostwriter-high-unknown"
    ghost["run"]["operation_name"] = "Ghostwriter Export"
    ghost["run"]["status_distribution"] = {"success": 0, "error": 0, "unknown": 6, "other": 0}
    ghost["sources"] = [{"kind": "ghostwriter", "subtype": "graphql", "parser_version": "ghostwriter-v1"}]
    ghost["summary"]["status_distribution"] = ghost["run"]["status_distribution"]
    ghost_q = quality("ghostwriter", unknown=6, warnings=["Result status is unavailable."])
    ghost_q["status_distribution"] = ghost["run"]["status_distribution"]
    ghost_q["unknown_status_percent"] = 100
    ghost_q["source_limitations"] = ["Ghostwriter does not reliably preserve result status."]
    ghost_q["suppression_reasons"] = {
        "command-failure-summary": "No resolved statuses.",
        "command-retry-success": "No error-to-success transitions.",
        "callback-health": "Callback health requires resolved statuses.",
    }
    ghost["data_quality"] = [ghost_q]
    ghost["warnings"] = [
        {
            "code": "unknown-status",
            "category": "source-limitation",
            "message": "All result statuses are unknown.",
            "source": "ghostwriter",
        }
    ]
    ghost["sections"] = [
        unavailable("command-failure-summary", "Command Failure Summary", "suppressed", "No resolved statuses."),
        unavailable("command-retry-success", "Command Retry Success", "suppressed", "No error-to-success transitions."),
        unavailable("callback-health", "Callback Health", "suppressed", "Callback health requires resolved statuses."),
        section("data-quality", "Data Quality", entries=[ghost_q]),
    ]
    for item in ghost["sections"]:
        item["sources"] = ["ghostwriter"]

    cobalt = copy.deepcopy(partial)
    cobalt["run_id"] = "cobalt-strike-rest"
    cobalt["run"]["operation_name"] = "Cobalt Strike Teamserver"
    cobalt["sources"] = [{"kind": "cobaltstrike", "subtype": "rest-api", "parser_version": "cobaltstrike-rest-v1"}]
    cobalt["data_quality"][0]["source"] = "cobaltstrike"
    for item in cobalt["sections"]:
        item["sources"] = ["cobaltstrike"]

    outflank = copy.deepcopy(partial)
    outflank["run_id"] = "outflank-local-log"
    outflank["run"]["operation_name"] = "Outflank Implant Log"
    outflank["sources"] = [{"kind": "outflank", "subtype": "local-file", "parser_version": "outflank-v1"}]
    outflank["data_quality"][0]["source"] = "outflank"
    for item in outflank["sections"]:
        item["sources"] = ["outflank"]

    multi = copy.deepcopy(partial)
    multi["run_id"] = "multi-operation-combined"
    multi["run"]["run_kind"] = "multi-operation"
    multi["run"]["operation_name"] = "Combined Operations"
    multi["run"]["operation_id"] = None
    multi["run"]["operation_slug"] = None
    multi["run"]["operations"] = [
        {"operation_id": "42", "operation_name": "Alpha", "operation_slug": "alpha", "task_count": 3, "result_count": 3},
        {"operation_id": "43", "operation_name": "Bravo", "operation_slug": "bravo", "task_count": 3, "result_count": 3},
    ]
    multi["run"]["retention"] = {"arguments": "mixed", "output": "mixed"}
    multi["sources"] = [{"kind": "mixed", "subtype": "multi-operation"}]
    multi["retention"] = {
        "arguments": "mixed",
        "output": "mixed",
        "observed_argument_rules": ["all", "hash"],
        "observed_output_rules": ["all", "none"],
        "limitations": ["Input runs used different retention rules."],
    }
    multi["summary"]["operation_count"] = 2
    for item in multi["sections"]:
        item["sources"] = ["mixed"]

    diff = copy.deepcopy(partial)
    diff["run_id"] = "baseline-vs-candidate"
    diff["run"]["run_kind"] = "diff"
    diff["run"]["operation_name"] = "Baseline vs Candidate"
    diff["sources"] = [{"kind": "mixed", "subtype": "run-comparison"}]
    diff["sections"] = [
        section(
            "run-diff",
            "Run Diff",
            findings=[
                {
                    "metric_id": "failure-rate",
                    "entity_id": "execute-assembly",
                    "classification": "regression",
                    "confidence": "high",
                    "baseline_value": 0.1,
                    "candidate_value": 0.2,
                    "delta": 0.1,
                    "explanation": "Failure rate increased.",
                }
            ],
            comparability_status="comparable",
        )
    ]
    diff["sections"][0]["sources"] = ["mixed"]
    diff["capabilities"] = ["table-search", "table-sort", "run-diff"]
    diff["previous_runs"] = []
    diff["diff"] = {
        "baseline_run_id": "baseline",
        "candidate_run_id": "candidate",
        "comparability_status": "comparable",
        "warnings": [],
    }

    retained = copy.deepcopy(partial)
    retained["run_id"] = "retention-enabled"
    retained["run"]["retention"] = {
        "arguments": "hash",
        "output": "errors_only",
        "limitations": ["Task arguments are represented only by hashes."],
    }
    retained["retention"] = copy.deepcopy(retained["run"]["retention"])
    retained["data_quality"][0]["retention_limitations"] = ["Successful output was not retained."]
    for item in retained["sections"]:
        if item["kind"] not in {"summary-visualization", "data-quality"}:
            item["status"] = "suppressed"
            item["status_reason"] = "Required raw values were removed by retention policy."

    missing = copy.deepcopy(partial)
    missing["run_id"] = "missing-analyzers"
    missing["sections"] = [
        unavailable("command-duration", "Command Duration", "missing", "command-duration.json was not found."),
        unavailable("callback-health", "Callback Health", "missing", "callback-health.json was not found."),
    ]

    optional = copy.deepcopy(partial)
    optional["run_id"] = "optional-fields-omitted"
    optional["run"].pop("analysis_started_at", None)
    optional["run"].pop("operation_id", None)
    optional["run"].pop("operation_slug", None)
    optional["sources"] = [{"kind": "mythic"}]
    optional["summary"].pop("callback_count", None)
    optional["summary"].pop("span_seconds", None)
    optional["previous_runs"] = []

    return {
        "complete-mythic.json": complete,
        "partial-mythic.json": partial,
        "ghostwriter-high-unknown.json": ghost,
        "cobalt-strike-rest.json": cobalt,
        "outflank.json": outflank,
        "multi-operation.json": multi,
        "diff-report.json": diff,
        "retention-enabled.json": retained,
        "missing-analyzers.json": missing,
        "malformed-optional-fields.json": optional,
    }


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, payload in scenarios().items():
        path = OUT / name
        path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        print(f"Wrote {path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
