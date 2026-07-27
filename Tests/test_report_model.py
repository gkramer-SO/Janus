from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from Core.report_model import (
    CommandDurationSection,
    DiffMetadata,
    ReportModel,
    RunKind,
    SectionStatus,
    UnknownSection,
)


FIXTURES = Path(__file__).parent / "fixtures" / "reports"


def _fixture(name: str = "complete-mythic.json") -> dict:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def test_report_model_rejects_missing_required_fields() -> None:
    payload = _fixture()
    del payload["run_id"]
    with pytest.raises(ValidationError, match="run_id"):
        ReportModel.model_validate(payload)


def test_report_model_rejects_extra_fields() -> None:
    payload = _fixture()
    payload["raw_analyzer_json"] = {}
    with pytest.raises(ValidationError, match="Extra inputs are not permitted"):
        ReportModel.model_validate(payload)


def test_timestamps_must_be_timezone_aware_and_serialize_as_utc() -> None:
    payload = _fixture()
    payload["generated_at"] = "2026-07-27T12:00:00-04:00"
    model = ReportModel.model_validate(payload)
    assert json.loads(model.model_dump_json())["generated_at"] == "2026-07-27T16:00:00Z"

    payload["generated_at"] = "2026-07-27T16:00:00"
    with pytest.raises(ValidationError, match="timezone"):
        ReportModel.model_validate(payload)


def test_report_model_version_is_semver() -> None:
    payload = _fixture()
    payload["report_model_version"] = "v1"
    with pytest.raises(ValidationError, match="report_model_version"):
        ReportModel.model_validate(payload)


@pytest.mark.parametrize(
    "url",
    [
        "javascript:alert(1)",
        "file:///etc/passwd",
        "../other-run/report.html",
        "/absolute/report.html",
        r"..\\other-run\\report.html",
    ],
)
def test_links_reject_unsafe_urls(url: str) -> None:
    payload = _fixture()
    payload["previous_runs"][0]["link"]["url"] = url
    with pytest.raises(ValidationError, match="link|url|HTTP|escape|relative"):
        ReportModel.model_validate(payload)


def test_unknown_section_requires_explicit_fallback() -> None:
    payload = _fixture()
    payload["sections"][0]["kind"] = "future-chart"
    with pytest.raises(ValidationError, match="union_tag_invalid"):
        ReportModel.model_validate(payload)

    fallback = UnknownSection(
        kind="unknown",
        id="future-chart",
        title="Future Chart",
        status=SectionStatus.AVAILABLE,
        original_kind="future-chart",
        fallback_message="Upgrade the dashboard to view this section.",
    )
    assert fallback.original_kind == "future-chart"


@pytest.mark.parametrize("status", ["suppressed", "missing", "error"])
def test_unavailable_section_requires_reason(status: str) -> None:
    with pytest.raises(ValidationError, match="status_reason"):
        CommandDurationSection(
            kind="command-duration",
            id="duration",
            title="Duration",
            status=status,
        )


def test_section_ids_are_unique() -> None:
    payload = _fixture()
    payload["sections"][1]["id"] = payload["sections"][0]["id"]
    with pytest.raises(ValidationError, match="section ids must be unique"):
        ReportModel.model_validate(payload)


def test_diff_metadata_matches_run_kind() -> None:
    payload = _fixture()
    payload["diff"] = {
        "baseline_run_id": "base",
        "candidate_run_id": "candidate",
        "comparability_status": "comparable",
    }
    with pytest.raises(ValidationError, match="only valid for diff reports"):
        ReportModel.model_validate(payload)

    diff_payload = _fixture("diff-report.json")
    del diff_payload["diff"]
    with pytest.raises(ValidationError, match="required for diff reports"):
        ReportModel.model_validate(diff_payload)


def test_numeric_zero_and_boolean_values_survive_json_round_trip() -> None:
    model = ReportModel.model_validate(_fixture())
    payload = json.loads(model.model_dump_json(exclude_none=False))
    first_quality = payload["data_quality"][0]
    assert first_quality["skipped_entries"] == 0
    assert first_quality["unknown_status_percent"] == 0
    friction = next(section for section in payload["sections"] if section["kind"] == "friction-score")
    assert friction["candidates"][0]["suppressed"] is False


def test_serialization_is_deterministic() -> None:
    model = ReportModel.model_validate(_fixture())
    first = model.model_dump_json()
    second = ReportModel.model_validate_json(first).model_dump_json()
    assert first == second


def test_bounded_enums_reject_unknown_values() -> None:
    payload = _fixture()
    payload["run"]["run_kind"] = "aggregate"
    with pytest.raises(ValidationError, match="run_kind"):
        ReportModel.model_validate(payload)


def test_malformed_optional_fields_are_rejected_when_present() -> None:
    payload = _fixture("malformed-optional-fields.json")
    payload["sources"][0]["subtype"] = 42
    with pytest.raises(ValidationError, match="subtype"):
        ReportModel.model_validate(payload)


def test_diff_helpers_expose_typed_enums() -> None:
    metadata = DiffMetadata(
        baseline_run_id="base",
        candidate_run_id="candidate",
        comparability_status="comparable",
    )
    assert metadata.baseline_run_id == "base"
    assert RunKind.DIFF.value == "diff"
