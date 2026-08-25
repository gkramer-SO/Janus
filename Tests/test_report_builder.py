from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import pytest

from Core.report_builder import _map_section, _preview, build_report_model, write_report_model_atomically


ROOT = Path(__file__).resolve().parents[1]
ADAPTER_CASES = json.loads((ROOT / "Tests" / "fixtures" / "report-adapters.json").read_text(encoding="utf-8"))


def _write_json(path, value) -> None:
    path.write_text(json.dumps(value), encoding="utf-8")


def _bundle() -> dict:
    return {
        "source": "mythic",
        "operation_id": 42,
        "operation_name": "Test operation",
        "operation_slug": "test-operation",
        "analysis_version": "20260803_120000",
        "analysis_timestamp": "2026-08-03T12:00:00Z",
        "janus_version": "1.5.0",
        "task_count": 2,
        "result_count": 2,
        "status_counts": {"success": 1, "error": 1},
        "arguments_rule": "all",
        "output_rule": "all",
        "mythic_endpoint": "https://mythic.example/graphql",
        "data_quality": [{
            "source": "mythic",
            "events_parsed": 4,
            "skipped_entries": 0,
            "invalid_timestamps": 0,
            "fallback_task_ids": 0,
            "status_distribution": {"success": 1, "error": 1},
            "unknown_status_percent": 0,
            "argument_retention": "all",
            "output_retention": "all",
            "warnings": [],
            "invalid_record_counts": {},
        }],
    }


def test_builder_shapes_sections_decodes_output_and_marks_missing(tmp_path) -> None:
    _write_json(tmp_path / "bundle.json", _bundle())
    _write_json(tmp_path / "summary_visualization.json", {
        "status_distribution": {"success": 1, "error": 1, "unknown": 0},
        "timeline": {"buckets": [{"label": "2026-08-03 12:00", "count": 2}]},
        "summary": {"total_tasks": 2, "total_results": 2, "span_hours": 1},
    })
    _write_json(tmp_path / "command_failure_summary.json", {
        "commands": {"whoami": {"execution_count": 2, "success_count": 1, "error_count": 1, "unknown_count": 0, "failure_rate": 0.5, "failures": [{"task_id": 7, "display_id": 9, "command_name": "whoami", "timestamp": "2026-08-03T12:00:00Z", "error_message": "aGVsbG8=", "arguments_raw": "/all"}]}}
    })

    result = build_report_model(tmp_path, generated_at=datetime(2026, 8, 3, tzinfo=timezone.utc), revision=7)

    assert result.ok
    assert result.model is not None
    document = result.model.model_dump(mode="json")
    assert document["report_model_version"] == "1.1.0"
    assert document["revision"] == 7
    failure = next(section for section in document["sections"] if section["kind"] == "command-failure-summary")
    assert failure["commands"][0]["failures"][0]["output_preview"]["text"] == "hello"
    assert failure["commands"][0]["failures"][0]["task"]["link"]["url"] == "https://mythic.example/new/task/9"
    missing = next(section for section in document["sections"] if section["kind"] == "av-tracker")
    assert missing["status"] == "missing"


def test_builder_returns_structured_errors_and_uses_events_only_for_quality_fallback(tmp_path) -> None:
    missing = build_report_model(tmp_path)
    assert missing.model is None
    assert missing.errors[0].code == "artifact-missing"

    bundle = _bundle()
    bundle.pop("data_quality")
    _write_json(tmp_path / "bundle.json", bundle)
    (tmp_path / "events.ndjson").write_text('{"event_type":"task","task_id":1}\nnot json\n', encoding="utf-8")
    result = build_report_model(tmp_path)
    assert result.ok
    assert result.model is not None
    assert result.model.data_quality[0].invalid_record_counts["malformed_ndjson_lines"] == 1


def test_atomic_writer_keeps_last_known_good_model(tmp_path, monkeypatch) -> None:
    _write_json(tmp_path / "bundle.json", _bundle())
    result = build_report_model(tmp_path)
    assert result.model is not None
    output = tmp_path / "report-model.json"
    write_report_model_atomically(result.model, output)
    original = output.read_text(encoding="utf-8")
    rebuilt = build_report_model(tmp_path)
    assert rebuilt.model is not None
    assert rebuilt.model.revision == 2

    def fail_replace(source, target):
        raise OSError("simulated replace failure")

    monkeypatch.setattr("Core.report_builder.os.replace", fail_replace)
    with pytest.raises(OSError):
        write_report_model_atomically(result.model, output)
    assert output.read_text(encoding="utf-8") == original


def test_builder_shapes_a_diff_run(tmp_path) -> None:
    bundle = _bundle()
    bundle.update({"run_kind": "diff", "source": "mixed", "source_subtype": "run-comparison"})
    _write_json(tmp_path / "bundle.json", bundle)
    _write_json(tmp_path / "diff.json", {
        "baseline": {"run_id": "base", "total_tasks": 10},
        "candidate": {"run_id": "candidate", "total_tasks": 12},
        "comparability": {"status": "comparable_with_warnings", "warnings": ["Task volume differs."]},
        "summary": {"likely_regressions": 1, "likely_improvements": 0, "low_confidence_changes": 0, "not_comparable": 0},
        "findings": [{"metric": "failure_rate", "entity": "whoami", "classification": "regression", "confidence": "high", "baseline_value": 0.1, "candidate_value": 0.4, "absolute_delta": 0.3, "reason": "Failure rate increased."}],
        "new_entities": [{"entity_type": "command", "entity": "execute", "candidate_count": 2}],
        "removed_entities": [],
    })

    result = build_report_model(tmp_path)

    assert result.ok
    assert result.model is not None
    assert result.model.run.run_kind == "diff"
    section = result.model.sections[0]
    assert section.kind == "run-diff"
    assert section.findings[0].delta == 0.3


@pytest.mark.parametrize("source", ["mythic", "ghostwriter", "cobaltstrike", "outflank"])
def test_builder_preserves_supported_source_provenance(tmp_path, source) -> None:
    bundle = _bundle()
    bundle["source"] = source
    _write_json(tmp_path / "bundle.json", bundle)

    result = build_report_model(tmp_path)

    assert result.ok
    assert result.model is not None
    assert result.model.sources[0].kind.value == source


def test_output_preview_keeps_malformed_text_and_excludes_binary() -> None:
    malformed = _preview("not-base64!", {}, "output", decode=True)
    binary = _preview("AAEC", {}, "output", decode=True)

    assert malformed is not None and malformed["text"] == "not-base64!"
    assert malformed["decoded"] is False
    assert binary is not None and binary["binary"] is True
    assert binary["text"] is None


def _field(document, dotted_path: str):
    value = document
    for part in dotted_path.split("."):
        value = value[int(part)] if isinstance(value, list) else value[part]
    return value


@pytest.mark.parametrize("kind", sorted(ADAPTER_CASES))
def test_analyzer_adapter_field_parity(kind: str) -> None:
    case = ADAPTER_CASES[kind]

    section = _map_section(kind, case["payload"], "mythic", "https://mythic.example")

    assert section["kind"] == kind
    assert section["status"] == "available"
    for path, expected in case["expected"].items():
        assert _field(section, path) == expected, f"{kind}: {path}"
