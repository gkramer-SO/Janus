from __future__ import annotations

import re
from pathlib import Path

from Core.report_model import ReportModel
from Core.static_report import package_static_report


ROOT = Path(__file__).resolve().parents[1]


def _model() -> ReportModel:
    source = ROOT / "Tests" / "fixtures" / "reports" / "complete-mythic.json"
    return ReportModel.model_validate_json(source.read_text(encoding="utf-8"))


def test_static_report_embeds_model_script_and_styles(tmp_path) -> None:
    output = tmp_path / "report.html"
    package_static_report(_model(), output, asset_dir=ROOT / "dashboard" / "dist")

    document = output.read_text(encoding="utf-8")
    assert 'id="janus-report-model" type="application/json"' in document
    assert "Static snapshot" in document
    assert "<style>" in document
    assert not re.search(r'<script[^>]+src=', document)
    assert not re.search(r'<link[^>]+rel="stylesheet"', document)


def test_static_report_escapes_script_termination_in_model(tmp_path) -> None:
    payload = _model().model_dump(mode="json")
    payload["run"]["operation_name"] = "hostile </script><script>alert(1)</script>"
    output = tmp_path / "report.html"

    package_static_report(ReportModel.model_validate(payload), output, asset_dir=ROOT / "dashboard" / "dist")

    document = output.read_text(encoding="utf-8")
    embedded = document.split('id="janus-report-model" type="application/json">', 1)[1].split("</script>", 1)[0]
    assert "</script>" not in embedded.lower()
    assert "\\u003c/script\\u003e" in embedded
