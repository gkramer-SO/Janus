"""Package the compiled Janus dashboard and one report model into portable HTML."""

from __future__ import annotations

import html
import json
import re
from pathlib import Path

from Core.report_model import ReportModel


DEFAULT_ASSET_DIR = Path(__file__).resolve().parent.parent / "Server" / "assets"
SOURCE_ASSET_DIR = Path(__file__).resolve().parent.parent / "dashboard" / "dist"
_SCRIPT_RE = re.compile(r'<script[^>]+src="([^"]+)"[^>]*></script>')
_STYLE_RE = re.compile(r'<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"[^>]*>')


def _asset_path(asset_dir: Path, reference: str) -> Path:
    relative = reference.split("?", 1)[0].lstrip("/")
    candidate = (asset_dir / relative).resolve()
    try:
        candidate.relative_to(asset_dir.resolve())
    except ValueError as exc:
        raise ValueError("Dashboard asset reference escaped the asset directory.") from exc
    if not candidate.is_file():
        raise FileNotFoundError(f"Compiled dashboard asset is missing: {relative}")
    return candidate


def package_static_report(
    model: ReportModel,
    output_path: Path,
    *,
    asset_dir: Path = DEFAULT_ASSET_DIR,
) -> None:
    """Write one self-contained report that boots the same dashboard in static mode."""
    if asset_dir == DEFAULT_ASSET_DIR and not (asset_dir / "index.html").is_file() and (SOURCE_ASSET_DIR / "index.html").is_file():
        asset_dir = SOURCE_ASSET_DIR
    index_path = asset_dir / "index.html"
    if not index_path.is_file():
        raise FileNotFoundError("Compiled dashboard index.html is missing. Run the dashboard build first.")
    document = index_path.read_text(encoding="utf-8")
    scripts = _SCRIPT_RE.findall(document)
    styles = _STYLE_RE.findall(document)
    if len(scripts) != 1 or len(styles) != 1:
        raise ValueError("Compiled dashboard index must reference exactly one script and one stylesheet.")
    script = _asset_path(asset_dir, scripts[0]).read_text(encoding="utf-8")
    style = _asset_path(asset_dir, styles[0]).read_text(encoding="utf-8")
    model_json = model.model_dump_json(exclude_none=True).replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")
    document = _STYLE_RE.sub(lambda _match: f"<style>{style}</style>", document, count=1)
    document = _SCRIPT_RE.sub(
        lambda _match: (
            '<script id="janus-report-model" type="application/json">'
            + model_json
            + "</script><script>"
            + script.replace("</script", "<\\/script")
            + "</script>"
        ),
        document,
        count=1,
    )
    document = document.replace("<title>Janus</title>", f"<title>Janus — {html.escape(model.run.operation_name)}</title>")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(document, encoding="utf-8")
