# Report Migration Inventory

This document captures the behavior of `Core/html_output.py` before the Janus
v1.5 dashboard migration. It is the Phase 1 parity baseline and is intentionally
about observable behavior, not the future component implementation.

## Global behavior

- `generate_html` loads each configured analyzer JSON file, derives data quality
  from `bundle.json` (or `events.ndjson` as a compatibility fallback), joins
  callback-health details into failure rows, and renders one self-contained
  document.
- The report overview is expanded by default. Analyzer groups and their child
  sections use native `<details>` controls. Summary Analysis is always visible.
- A single debounced search input filters rows in every table. `/` focuses it;
  Enter and Shift+Enter move between visible matches. Tables with `sortable`
  class support client-side column sorting. There are no analyzer-specific
  filters.
- Empty analyzer data renders an analyzer-specific empty message. A configured
  but absent analyzer file renders its path as missing. Outlier Context is the
  exception: it is omitted when absent because it is also an enrichment for
  Command Duration. Summary Visualization is omitted when absent.
- External callback/task links are emitted only for a valid HTTP(S) Mythic base
  URL. Previous-run links are restricted to safe sibling directory names.
- All dynamic text and attributes are HTML escaped. Argument/output previews
  honor retention markers. Base64 output is decoded only when it is valid,
  printable text; malformed or binary-looking values remain unchanged.

## Section inventory

| Current section | Source artifact and fields consumed | Joins, suppression, links, and empty state | Dashboard destination |
|---|---|---|---|
| Report Overview | `bundle.json`: operation/source IDs and names, endpoints, analysis and Janus versions, task/result/status counts, retention rules, operations; analyzer summaries from command failure, friction score, callback health, and argument profile | Data-quality warnings and suppressed-section reasons are promoted here. Previous runs link to safe sibling reports. Multi-operation and diff headers use separate layouts. | `ReportOverview` |
| Data Quality | `bundle.json.data_quality` or derived event quality: source, parsed/skipped/invalid/fallback counts, status distribution, unknown percent, retention, parser counts, warnings | Expanded by default. Warnings are repeated as interpretation callouts. Empty when no quality entries exist. | `DataQualitySection` |
| Summary Visualization | `summary-visualization.json`: `status_distribution`, `timeline.buckets`, `timeline.bucket_unit`, `summary.span_hours` | No cross-join. Missing section is silently omitted. Empty status/timeline charts have explicit messages. | `SummaryVisualizationSection` |
| Command Failure Summary | `command-failure-summary.json`: command execution/success/error/failure rates, callback breakdown, failure events, arguments, retention metadata | Joins callback names/health from `callback-health.json`. Suppressed when no reliable result statuses exist. Task/callback links target Mythic. | `CommandFailureSection` |
| Command Retry Success | `command-retry-success.json`: retry sequences, attempts, task/display/callback IDs, timestamps, argument changes, durations, terminal status | Suppressed when reliable error-to-success transitions are unavailable. Task links target Mythic. Empty sequence list has an explanatory message. | `CommandRetrySection` |
| Command Duration | `command-duration.json`: per-command counts, mean/median/p95/max, max event, outlier count/events, duration and task fields | Enriched with `outlier-context.json` aggregations and task context. PTY shell lines get a nested display label. Task links target Mythic. | `CommandDurationSection` |
| Top Friction Candidates | `friction-score.json`: command, score, confidence/sample data, component metrics, recommendation and suppression metadata | Key top candidate is also promoted into Report Overview. No source-system links. Empty candidates have an explanatory message. | `FrictionScoreSection` |
| Outlier Context | `outlier-context.json`: outliers, preceding/following context, sequence signature, aggregations | Also joined into Command Duration. Missing output is silently omitted. Context task links target Mythic. | `OutlierContextSection` |
| AV Tracker | `av-tracker.json`: summary, registry metadata, vendors, detections, executable matches, task/callback/status/timestamp | Task and callback links target Mythic. Empty vendor/detection sets have explanatory messages. | `AvTrackerSection` |
| Callback Health | `callback-health.json`: callback summary and rows, active period, consecutive/trailing failures, last success, task/callback IDs | Supplies callback context to Command Failure. Suppressed when all result statuses are unknown. Task/callback links target Mythic. | `CallbackHealthSection` |
| Dwell Time | `dwell-time.json`: analyzer metadata, global statistics, outlier transitions and task/command/timestamp/dwell fields | Task links target Mythic. Durations are formatted for humans in HTML. Empty outlier set has an explanatory message. | `DwellTimeSection` |
| Parameter Entropy | `parameter-entropy.json`: summary/by-type, findings, repeated tokens, task/display IDs, entropy, details, arguments | Task links target Mythic. Retention-aware argument display. Empty findings have an explanatory message. | `ParameterEntropySection` |
| Argument Position Profile | `argument-position-profile.json`: summary, findings, depth distribution, per-command positions/top values, task references | PTY buckets get readable nested labels. Task/callback links target Mythic. Tables expose findings, per-command profiles, and depth distribution. | `ArgumentPositionProfileSection` |
| Tool Dump | `tool-dump.json`: summary, registry, groups, artifact paths, entries and task/source/tool/command/argument fields | Task links target Mythic. Detail rows are capped at 25 per group in the static report. Empty groups have an explanatory message. | `ToolDumpSection` |
| Diff Overview | `diff.json`: baseline/candidate run IDs, task counts and sources; comparability; summary counts; findings | Comparability warnings are promoted. No live analyzer joins. | `ReportOverview` with `DiffMetadata` |
| Diff Summary | `diff.json`: summary and aggregate metric values | Numeric values remain distinct internally but are formatted in HTML. | `RunDiffSection` summary |
| Diff Findings | `diff.json.findings`: metric/entity, baseline/candidate/delta, classification, confidence, explanation | Rows receive classification CSS. Empty findings have an explicit message. | `RunDiffSection` findings |
| Diff Entity Presence | `diff.json.entity_presence` | Rendered only when present. | `RunDiffSection` presence panel |
| Raw Diff JSON | Full `diff.json` | Escaped JSON in a collapsed diagnostic block. It is not a normal browser API payload. | Optional diagnostics view |

## Helper classification

The migration boundary is: loading and derivation move to `Core/report_builder.py`
in Phase 3; presentation moves to the Preact frontend; security validation stays
at the model-construction boundary and is independently enforced by the UI.

| Classification | Helpers |
|---|---|
| Load analyzer/event data | `_load_events_for_quality`, `generate_html` (file-loading portion) |
| Derive report values and cross-references | `_retention_metadata_from_analysis`, `_assess_report_quality`, `_render_report_header` (key-finding/retention/previous-run derivation), `_render_diff_report_header` (comparability derivation), `_render_command_duration` (outlier join), `_render_command_failure_summary` (callback join), `_render_task_context` |
| Human formatting | `_decode_base64_output`, `_is_printable_text`, `_fmt_duration`, `_fmt_args_cell`, `_arguments_retention_summary`, `_output_retention_summary`, `_wrap_cell_text`, `_format_retention_rule_list`, `_format_duration_from_timestamps`, `_format_short_timestamp`, `_ts_html`, `_format_attempt_detail`, `_format_full_command`, `_format_duration_row_command`, `_strip_repr_quotes`, `_format_diff_item`, `_format_structured_diff`, `_format_quality_count`, `_format_quality_percent`, `_format_invalid_record_counts`, `_format_diff_count`, `_format_diff_percent`, `_format_diff_source_list`, `_diff_classification_class`, `_format_argument_profile_command_label` |
| HTML generation | `_collapsible_section`, `_render_analyzer_panel`, `_render_report_header`, `_render_diff_report_header`, `_render_diff_report`, `_render_diff_summary`, `_render_diff_findings`, `_render_diff_entity_presence`, `_render_diff_raw_json`, `_summary_visualization_content`, `_render_summary_analysis_static`, `_render_data_quality`, `_render_missing_section`, `_render_suppressed_section`, `_render_command_failure_summary`, `_render_friction_score`, `_render_command_retry_success`, `_render_command_duration`, `_render_outlier_context`, `_render_callback_health`, `_render_av_tracker`, `_render_dwell_time`, `_render_parameter_entropy`, `_render_argument_position_profile`, `_render_tool_dump` |
| CSS/JavaScript generation | `_get_html_template` |
| Security-sensitive escaping/link validation | `_mythic_base_url`, `_safe_external_href`, `_safe_relative_report_href`, `_cb_link`, `_task_link`; every `_render_*` helper also owns contextual `html.escape` calls today |

## Migration parity checklist

- [x] Every current report section has a destination component/model kind.
- [x] Data-quality, comparability, retention, and suppression warnings are
  represented structurally and cannot disappear because an analyzer section is
  unavailable.
- [x] Retention rules and limitations are first-class report fields.
- [x] The model contains normalized summaries and rows, not raw analyzer
  dictionaries, HTML, CSS class names, preformatted percentages, or formatted
  durations.
- [x] Source limitations and Janus processing errors use different warning/data
  quality fields.
- [x] Callback, task, report, and source links are typed and reject unsafe URI
  schemes or escaping relative paths.
- [x] Missing, suppressed, and error sections require a reason.
- [x] Existing search, sorting, row expansion, safe links, previous runs, and
  diff behavior appear in the capabilities contract.
- [x] Unknown future section kinds have an explicit fallback envelope.
- [ ] Phase 3 must prove field-level adapter parity against the fixtures before
  replacing `Core/html_output.py`.
- [ ] The dashboard must preserve keyboard search navigation and accessible
  native expansion behavior.

## Representative fixture matrix

Fixtures under `Tests/fixtures/reports/` are validated as report-model
documents. They deliberately contain normalized display-boundary values rather
than copies of analyzer output, preventing raw sensitive fields from becoming an
accidental public contract.

| Fixture | Required coverage |
|---|---|
| `complete-mythic.json` | All analyzer section kinds, safe task/callback links |
| `partial-mythic.json` | Partial source fidelity and low-confidence warnings |
| `ghostwriter-high-unknown.json` | High unknown status and failure-section suppression |
| `cobalt-strike-rest.json` | Cobalt Strike source/subtype provenance |
| `outflank.json` | Local-file source and parser fidelity |
| `multi-operation.json` | Multiple operation references and mixed source/retention |
| `diff-report.json` | Diff metadata, comparability, and typed findings |
| `retention-enabled.json` | No raw values, explicit retention limitations |
| `missing-analyzers.json` | Missing section statuses and reasons |
| `malformed-optional-fields.json` | Valid absence of optional source fields; paired negative validation tests |

