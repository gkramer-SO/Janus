from Core.command_display import format_argument_preview


def test_format_argument_preview_flattens_execute_assembly_json() -> None:
    raw = '{"assembly_file": "Rubeus.exe", "arguments": "triage"}'
    assert format_argument_preview(raw) == "Rubeus.exe triage"


def test_format_argument_preview_keeps_plain_strings() -> None:
    assert format_argument_preview("Seatbelt.exe -group=all") == "Seatbelt.exe -group=all"


def test_format_argument_preview_empty() -> None:
    assert format_argument_preview("") == ""
    assert format_argument_preview(None) == ""
