from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import jsonschema
import pytest

from Core.analyzer_registry import ALL_ANALYZERS
from Core.report_model import ReportModel


ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "Tests" / "fixtures" / "reports"
SCHEMA_PATH = ROOT / "docs" / "schema" / "report-model-v1.schema.json"
EXPECTED_FIXTURES = {
    "complete-mythic.json",
    "partial-mythic.json",
    "ghostwriter-high-unknown.json",
    "cobalt-strike-rest.json",
    "outflank.json",
    "multi-operation.json",
    "diff-report.json",
    "retention-enabled.json",
    "missing-analyzers.json",
    "malformed-optional-fields.json",
}


def _documents() -> list[tuple[Path, dict]]:
    return [
        (path, json.loads(path.read_text(encoding="utf-8")))
        for path in sorted(FIXTURES.glob("*.json"))
    ]


def test_fixture_matrix_is_complete() -> None:
    assert {path.name for path in FIXTURES.glob("*.json")} == EXPECTED_FIXTURES


@pytest.mark.parametrize(("path", "document"), _documents(), ids=lambda value: getattr(value, "name", None))
def test_fixture_validates_with_pydantic(path: Path, document: dict) -> None:
    model = ReportModel.model_validate(document)
    assert model.run_id
    assert model.report_model_version == "1.0.0"


@pytest.mark.parametrize(("path", "document"), _documents(), ids=lambda value: getattr(value, "name", None))
def test_fixture_validates_with_checked_in_json_schema(path: Path, document: dict) -> None:
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    jsonschema.Draft202012Validator(
        schema,
        format_checker=jsonschema.FormatChecker(),
    ).validate(document)


def test_complete_fixture_covers_every_non_diff_section_kind() -> None:
    document = json.loads((FIXTURES / "complete-mythic.json").read_text(encoding="utf-8"))
    kinds = {section["kind"] for section in document["sections"]}
    assert kinds == {*ALL_ANALYZERS, "data-quality"}


def test_high_unknown_fixture_suppresses_failure_driven_sections() -> None:
    document = json.loads(
        (FIXTURES / "ghostwriter-high-unknown.json").read_text(encoding="utf-8")
    )
    assert document["data_quality"][0]["unknown_status_percent"] == 100
    statuses = {section["kind"]: section["status"] for section in document["sections"]}
    assert statuses["command-failure-summary"] == "suppressed"
    assert statuses["command-retry-success"] == "suppressed"
    assert statuses["callback-health"] == "suppressed"


def test_retention_fixture_does_not_add_raw_sensitive_contract_fields() -> None:
    document = json.loads(
        (FIXTURES / "retention-enabled.json").read_text(encoding="utf-8")
    )
    serialized = json.dumps(document)
    assert '"arguments_raw"' not in serialized
    assert '"output_text"' not in serialized
    assert document["retention"]["arguments"] == "hash"
    assert document["retention"]["output"] == "errors_only"


def test_generated_schema_and_types_are_current() -> None:
    result = subprocess.run(
        [sys.executable, "scripts/generate_report_schema.py", "--check"],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stdout + result.stderr
