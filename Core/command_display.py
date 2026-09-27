"""Operator-facing command and argument display helpers."""

from __future__ import annotations

import json
from typing import Any


def format_argument_preview(arguments_raw: object, *, max_length: int = 120) -> str:
    """Return a compact argument string for report UI (no command name prefix).

    Mythic-style JSON argument bags are flattened into an operator-readable form
    (for example ``Rubeus.exe triage`` or ``path=/tmp``). Plain strings pass
    through. Empty or unreadable input returns an empty string.
    """
    text = str(arguments_raw or "").strip()
    if not text:
        return ""
    try:
        parsed: Any = json.loads(text)
    except (json.JSONDecodeError, TypeError, ValueError):
        return text if len(text) <= max_length else text[: max_length - 1] + "…"

    if isinstance(parsed, str):
        return parsed if len(parsed) <= max_length else parsed[: max_length - 1] + "…"
    if not isinstance(parsed, dict) or not parsed:
        return text if len(text) <= max_length else text[: max_length - 1] + "…"

    assembly = parsed.get("assembly_file") or parsed.get("coff_name") or parsed.get("file")
    path = parsed.get("path")
    primary = assembly if isinstance(assembly, str) and assembly else path if isinstance(path, str) and path else None
    trailing = parsed.get("arguments") or parsed.get("args") or parsed.get("command") or parsed.get("cmd")
    if primary:
        if isinstance(trailing, str) and trailing.strip():
            display = f"{primary} {trailing.strip()}"
        else:
            display = primary
        return display if len(display) <= max_length else display[: max_length - 1] + "…"

    if len(parsed) == 1:
        value = next(iter(parsed.values()))
        if isinstance(value, str) and value:
            return value if len(value) <= max_length else value[: max_length - 1] + "…"

    parts: list[str] = []
    for key, value in parsed.items():
        if value is None:
            continue
        if isinstance(value, str) and len(value) > 40:
            value = value[:40] + "..."
        parts.append(f"{key}={value}")
    display = " ".join(parts)
    return display if len(display) <= max_length else display[: max_length - 1] + "…"
