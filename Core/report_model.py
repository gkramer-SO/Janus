"""Stable, presentation-independent report model for Janus.

The models in this module are the contract between Janus report construction
and every report presentation (served dashboard and static export).  Analyzer
output dictionaries must be adapted to these types rather than exposed to a UI
directly.
"""

from __future__ import annotations

from datetime import datetime, timezone
from enum import StrEnum
import re
from typing import Annotated, Literal, TypeAlias

from pydantic import (
    AfterValidator,
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    PlainSerializer,
    StringConstraints,
    field_validator,
    model_validator,
)


REPORT_MODEL_VERSION = "1.1.0"
ReportId = Annotated[str, StringConstraints(min_length=1, pattern=r"^[A-Za-z0-9._:-]+$")]
JsonScalar: TypeAlias = str | int | float | bool | None


def _as_utc(value: datetime) -> datetime:
    return value.astimezone(timezone.utc)


def _utc_json(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


UtcDatetime = Annotated[
    AwareDatetime,
    AfterValidator(_as_utc),
    PlainSerializer(_utc_json, return_type=str, when_used="json"),
]


class StrictModel(BaseModel):
    """Base class for stable contract models."""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)


class RunKind(StrEnum):
    OPERATION = "operation"
    MULTI_OPERATION = "multi-operation"
    DIFF = "diff"


class SourceKind(StrEnum):
    MYTHIC = "mythic"
    GHOSTWRITER = "ghostwriter"
    COBALT_STRIKE = "cobaltstrike"
    OUTFLANK = "outflank"
    MULTI_OPERATION = "multi-operation"
    MIXED = "mixed"
    UNKNOWN = "unknown"


class RetentionRule(StrEnum):
    ALL = "all"
    NONE = "none"
    DROP = "drop"
    HASH = "hash"
    FEATURES_ONLY = "features_only"
    ERRORS_ONLY = "errors_only"
    MIXED = "mixed"
    UNKNOWN = "unknown"


class SectionStatus(StrEnum):
    AVAILABLE = "available"
    SUPPRESSED = "suppressed"
    MISSING = "missing"
    ERROR = "error"


class ConfidenceLevel(StrEnum):
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    UNKNOWN = "unknown"


class ComparabilityStatus(StrEnum):
    COMPARABLE = "comparable"
    COMPARABLE_WITH_WARNINGS = "comparable-with-warnings"
    NOT_COMPARABLE = "not-comparable"
    UNKNOWN = "unknown"


class WarningCategory(StrEnum):
    SOURCE_LIMITATION = "source-limitation"
    RETENTION_LIMITATION = "retention-limitation"
    PROCESSING_ERROR = "processing-error"
    COMPARABILITY = "comparability"
    ANALYZER_CONFIDENCE = "analyzer-confidence"


class Capability(StrEnum):
    TABLE_SEARCH = "table-search"
    TABLE_SORT = "table-sort"
    TABLE_FILTER = "table-filter"
    EXPANDABLE_ROWS = "expandable-rows"
    SAFE_EXTERNAL_LINKS = "safe-external-links"
    PREVIOUS_RUNS = "previous-runs"
    RUN_DIFF = "run-diff"
    LIVE_REVISIONS = "live-revisions"


class LinkKind(StrEnum):
    CALLBACK = "callback"
    TASK = "task"
    REPORT = "report"
    SOURCE = "source"


class DiffClassification(StrEnum):
    IMPROVEMENT = "improvement"
    REGRESSION = "regression"
    LOW_CONFIDENCE_CHANGE = "low-confidence-change"
    NOT_COMPARABLE = "not-comparable"
    UNCHANGED = "unchanged"


class ReportWarning(StrictModel):
    code: ReportId
    category: WarningCategory
    message: str = Field(min_length=1)
    source: SourceKind | None = None
    section_id: ReportId | None = None


class SafeLink(StrictModel):
    """A link already approved by the report builder.

    Absolute links are restricted to HTTP(S); report links may be a simple
    relative path.  Analyzer-controlled URI schemes are rejected.
    """

    label: str = Field(min_length=1)
    url: str = Field(min_length=1)
    kind: LinkKind

    @model_validator(mode="after")
    def _validate_url(self) -> SafeLink:
        from urllib.parse import urlsplit

        parsed = urlsplit(self.url)
        if parsed.scheme:
            if parsed.scheme not in {"http", "https"} or not parsed.netloc:
                raise ValueError("absolute links must use HTTP or HTTPS")
            return self
        if self.kind == LinkKind.REPORT and re.fullmatch(
            r"\.\./[A-Za-z0-9._-]+/report\.html", self.url
        ):
            return self
        if "\\" in self.url or self.url.startswith("/") or ".." in self.url.split("/"):
            raise ValueError("relative report links may not escape the report root")
        return self


class TextPreview(StrictModel):
    """Retention-aware display text prepared by the report builder."""

    text: str | None = None
    decoded: bool = False
    binary: bool = False
    truncated: bool = False
    original_length: int = Field(default=0, ge=0)
    retention: RetentionRule = RetentionRule.UNKNOWN

    @model_validator(mode="after")
    def _binary_has_no_text(self) -> TextPreview:
        if self.binary and self.text is not None:
            raise ValueError("binary previews may not embed text")
        return self


class RetentionSettings(StrictModel):
    arguments: RetentionRule = RetentionRule.UNKNOWN
    output: RetentionRule = RetentionRule.UNKNOWN
    observed_argument_rules: list[RetentionRule] = Field(default_factory=list)
    observed_output_rules: list[RetentionRule] = Field(default_factory=list)
    limitations: list[str] = Field(default_factory=list)


class SourceInfo(StrictModel):
    kind: SourceKind
    subtype: str | None = None
    endpoint_label: str | None = None
    parser_version: str | None = None


class OperationRef(StrictModel):
    operation_id: str | None = None
    operation_name: str = Field(min_length=1)
    operation_slug: str | None = None
    task_count: int = Field(default=0, ge=0)
    result_count: int = Field(default=0, ge=0)


class StatusDistribution(StrictModel):
    success: int = Field(default=0, ge=0)
    error: int = Field(default=0, ge=0)
    unknown: int = Field(default=0, ge=0)
    other: int = Field(default=0, ge=0)

    @property
    def total(self) -> int:
        return self.success + self.error + self.unknown + self.other


class RunMetadata(StrictModel):
    run_kind: RunKind
    operation_name: str = Field(min_length=1)
    operation_id: str | None = None
    operation_slug: str | None = None
    operations: list[OperationRef] = Field(default_factory=list)
    analysis_started_at: UtcDatetime | None = None
    analysis_completed_at: UtcDatetime
    task_count: int = Field(ge=0)
    result_count: int = Field(ge=0)
    status_distribution: StatusDistribution = Field(default_factory=StatusDistribution)
    parser_version: str | None = None
    janus_version: str = Field(min_length=1)
    retention: RetentionSettings


class DataQualityEntry(StrictModel):
    source: SourceKind
    events_parsed: int = Field(ge=0)
    skipped_entries: int = Field(default=0, ge=0)
    malformed_records: int = Field(default=0, ge=0)
    invalid_timestamps: int = Field(default=0, ge=0)
    fallback_task_ids: int = Field(default=0, ge=0)
    status_distribution: StatusDistribution = Field(default_factory=StatusDistribution)
    unknown_status_percent: float = Field(default=0, ge=0, le=100)
    retention_limitations: list[str] = Field(default_factory=list)
    analyzer_confidence_warnings: list[str] = Field(default_factory=list)
    suppression_reasons: dict[ReportId, str] = Field(default_factory=dict)
    source_limitations: list[str] = Field(default_factory=list)
    processing_errors: list[str] = Field(default_factory=list)
    invalid_record_counts: dict[str, int] = Field(default_factory=dict)


class SummaryMetrics(StrictModel):
    task_count: int = Field(ge=0)
    result_count: int = Field(ge=0)
    status_distribution: StatusDistribution = Field(default_factory=StatusDistribution)
    operation_count: int = Field(default=1, ge=1)
    callback_count: int | None = Field(default=None, ge=0)
    span_seconds: float | None = Field(default=None, ge=0)


class TimelineBucket(StrictModel):
    starts_at: UtcDatetime
    count: int = Field(ge=0)


class RetryTransition(StrictModel):
    from_attempt: int = Field(ge=1)
    to_attempt: int = Field(ge=2)
    changes: list[str] = Field(default_factory=list)
    note: str | None = None


class FrictionDriver(StrictModel):
    component: str
    value: float
    impact: float
    label: str


class RepeatedEntropyToken(StrictModel):
    token_prefix: str
    entropy_mean: float | None = Field(default=None, ge=0)
    occurrences: int = Field(ge=0)
    task_ids: list[str] = Field(default_factory=list)
    commands: list[str] = Field(default_factory=list)
    detail: str


class ArgumentDepthRow(StrictModel):
    command_name: str
    task_count: int = Field(default=0, ge=0)
    min_depth: int = Field(default=0, ge=0)
    max_depth: int = Field(default=0, ge=0)
    mean_depth: float = Field(default=0, ge=0)


class ArgumentCommandProfile(StrictModel):
    command_name: str
    task_count: int = Field(default=0, ge=0)
    positions: int = Field(default=0, ge=0)


class DiffSummary(StrictModel):
    likely_regressions: int = Field(default=0, ge=0)
    likely_improvements: int = Field(default=0, ge=0)
    low_confidence_changes: int = Field(default=0, ge=0)
    not_comparable: int = Field(default=0, ge=0)


class DiffEntityPresence(StrictModel):
    entity_type: str
    entity_id: str
    count: int = Field(default=0, ge=0)


class TaskRef(StrictModel):
    task_id: str
    display_id: str | None = None
    callback_id: str | None = None
    command_name: str | None = None
    arguments: str | None = None
    argument_preview: TextPreview | None = None
    timestamp: UtcDatetime | None = None
    link: SafeLink | None = None


class FailureDetail(StrictModel):
    task: TaskRef
    status: str = "unknown"
    dispatch_failed: bool = False
    output_preview: TextPreview | None = None


class CommandFailureRow(StrictModel):
    command_name: str
    execution_count: int = Field(ge=0)
    success_count: int = Field(ge=0)
    error_count: int = Field(ge=0)
    unknown_count: int = Field(default=0, ge=0)
    failure_rate: float | None = Field(default=None, ge=0, le=1)
    affected_callbacks: int = Field(default=0, ge=0)
    failures: list[FailureDetail] = Field(default_factory=list)


class RetrySequence(StrictModel):
    command_name: str
    attempts: int = Field(ge=1)
    succeeded: bool
    duration_seconds: float | None = Field(default=None, ge=0)
    tasks: list[TaskRef] = Field(default_factory=list)
    final_status: str | None = None
    transitions: list[RetryTransition] = Field(default_factory=list)
    intervening_tasks: list[TaskRef] = Field(default_factory=list)


class CommandDurationRow(StrictModel):
    command_name: str
    execution_count: int = Field(ge=0)
    median_seconds: float | None = Field(default=None, ge=0)
    p95_seconds: float | None = Field(default=None, ge=0)
    max_seconds: float | None = Field(default=None, ge=0)
    mean_seconds: float | None = Field(default=None, ge=0)
    min_seconds: float | None = Field(default=None, ge=0)
    outlier_count: int = Field(default=0, ge=0)
    slowest_task: TaskRef | None = None
    outlier_tasks: list[TaskRef] = Field(default_factory=list)


class FrictionCandidate(StrictModel):
    command_name: str
    score: float = Field(ge=0)
    confidence: ConfidenceLevel
    sample_size: int = Field(ge=0)
    recommended_action: str
    suppressed: bool = False
    components: dict[str, float] = Field(default_factory=dict)
    confidence_reasons: list[str] = Field(default_factory=list)
    limitations: list[str] = Field(default_factory=list)
    drivers: list[FrictionDriver] = Field(default_factory=list)


class OutlierContextRow(StrictModel):
    task: TaskRef
    duration_seconds: float = Field(ge=0)
    preceding: list[TaskRef] = Field(default_factory=list)
    following: list[TaskRef] = Field(default_factory=list)
    sequence_signature: str | None = None


class CallbackHealthRow(StrictModel):
    callback_id: str
    callback_display_id: str | None = None
    task_count: int = Field(ge=0)
    success_count: int = Field(default=0, ge=0)
    error_count: int = Field(default=0, ge=0)
    unknown_count: int = Field(default=0, ge=0)
    completion_rate: float | None = Field(default=None, ge=0, le=1)
    consecutive_failure_count: int = Field(default=0, ge=0)
    has_consecutive_failures: bool = False
    first_task_at: UtcDatetime | None = None
    last_task_at: UtcDatetime | None = None
    trailing_failures: list[TaskRef] = Field(default_factory=list)
    last_successful_task: TaskRef | None = None
    link: SafeLink | None = None


class AvDetectionRow(StrictModel):
    vendor: str
    matched_executables: list[str] = Field(default_factory=list)
    occurrence_count: int = Field(ge=1)
    task: TaskRef
    status: str | None = None


class DwellRow(StrictModel):
    from_task: TaskRef
    to_task: TaskRef
    dwell_seconds: float = Field(ge=0)


class DwellDistributionBucket(StrictModel):
    label: str
    min_seconds: float = Field(ge=0)
    max_seconds: float = Field(gt=0)
    count: int = Field(default=0, ge=0)


class EntropyFinding(StrictModel):
    task: TaskRef
    finding_type: str
    token_entropy: float | None = Field(default=None, ge=0)
    token: str | None = None
    detail: str


class ArgumentProfileFinding(StrictModel):
    command_name: str
    position: int | None = Field(default=None, ge=0)
    finding_type: str
    occurrences: int = Field(default=0, ge=0)
    sample_size: int = Field(default=0, ge=0)
    ratio: float | None = Field(default=None, ge=0, le=1)
    detail: str
    tasks: list[TaskRef] = Field(default_factory=list)


class ToolDumpGroup(StrictModel):
    id: ReportId
    name: str
    description: str | None = None
    match_count: int = Field(ge=0)
    unique_command_count: int = Field(default=0, ge=0)
    artifact_path: str | None = None
    entries: list[TaskRef] = Field(default_factory=list)


class DiffFinding(StrictModel):
    metric_id: ReportId
    entity_id: str
    classification: DiffClassification
    confidence: ConfidenceLevel
    baseline_value: JsonScalar = None
    candidate_value: JsonScalar = None
    delta: float | None = None
    explanation: str


class SectionBase(StrictModel):
    id: ReportId
    title: str = Field(min_length=1)
    status: SectionStatus
    status_reason: str | None = None
    warnings: list[ReportWarning] = Field(default_factory=list)
    sources: list[SourceKind] = Field(default_factory=list)
    confidence: ConfidenceLevel | None = None

    @model_validator(mode="after")
    def _require_status_reason(self) -> SectionBase:
        if self.status != SectionStatus.AVAILABLE and not self.status_reason:
            raise ValueError("non-available sections require status_reason")
        return self


class SummaryVisualizationSection(SectionBase):
    kind: Literal["summary-visualization"]
    status_distribution: StatusDistribution = Field(default_factory=StatusDistribution)
    timeline: list[TimelineBucket] = Field(default_factory=list)
    span_seconds: float | None = Field(default=None, ge=0)


class CommandFailureSection(SectionBase):
    kind: Literal["command-failure-summary"]
    commands: list[CommandFailureRow] = Field(default_factory=list)


class CommandRetrySection(SectionBase):
    kind: Literal["command-retry-success"]
    sequences: list[RetrySequence] = Field(default_factory=list)


class CommandDurationSection(SectionBase):
    kind: Literal["command-duration"]
    commands: list[CommandDurationRow] = Field(default_factory=list)


class FrictionScoreSection(SectionBase):
    kind: Literal["friction-score"]
    candidates: list[FrictionCandidate] = Field(default_factory=list)


class OutlierContextSection(SectionBase):
    kind: Literal["outlier-context"]
    outliers: list[OutlierContextRow] = Field(default_factory=list)


class CallbackHealthSection(SectionBase):
    kind: Literal["callback-health"]
    callbacks: list[CallbackHealthRow] = Field(default_factory=list)


class AvTrackerSection(SectionBase):
    kind: Literal["av-tracker"]
    detections: list[AvDetectionRow] = Field(default_factory=list)
    scanned_task_count: int = Field(default=0, ge=0)


class DwellTimeSection(SectionBase):
    kind: Literal["dwell-time"]
    measurements: list[DwellRow] = Field(default_factory=list)
    distribution: list[DwellDistributionBucket] = Field(default_factory=list)
    measurement_count: int = Field(default=0, ge=0)
    median_seconds: float | None = Field(default=None, ge=0)
    p95_seconds: float | None = Field(default=None, ge=0)
    max_seconds: float | None = Field(default=None, ge=0)


class ParameterEntropySection(SectionBase):
    kind: Literal["parameter-entropy"]
    findings: list[EntropyFinding] = Field(default_factory=list)
    repeated_token_count: int = Field(default=0, ge=0)
    repeated_tokens: list[RepeatedEntropyToken] = Field(default_factory=list)


class ArgumentPositionProfileSection(SectionBase):
    kind: Literal["argument-position-profile"]
    findings: list[ArgumentProfileFinding] = Field(default_factory=list)
    commands_profiled: int = Field(default=0, ge=0)
    max_depth: int = Field(default=0, ge=0)
    depth_distribution: list[ArgumentDepthRow] = Field(default_factory=list)
    command_profiles: list[ArgumentCommandProfile] = Field(default_factory=list)


class ToolDumpSection(SectionBase):
    kind: Literal["tool-dump"]
    groups: list[ToolDumpGroup] = Field(default_factory=list)


class DataQualitySection(SectionBase):
    kind: Literal["data-quality"]
    entries: list[DataQualityEntry] = Field(default_factory=list)


class RunDiffSection(SectionBase):
    kind: Literal["run-diff"]
    findings: list[DiffFinding] = Field(default_factory=list)
    comparability_status: ComparabilityStatus
    summary: DiffSummary | None = None
    new_entities: list[DiffEntityPresence] = Field(default_factory=list)
    removed_entities: list[DiffEntityPresence] = Field(default_factory=list)


class UnknownSection(SectionBase):
    """Lossless-enough fallback envelope for a section kind unknown to a UI."""

    kind: Literal["unknown"]
    original_kind: str = Field(min_length=1)
    fallback_message: str = Field(min_length=1)


ReportSection = Annotated[
    SummaryVisualizationSection
    | CommandFailureSection
    | CommandRetrySection
    | CommandDurationSection
    | FrictionScoreSection
    | OutlierContextSection
    | CallbackHealthSection
    | AvTrackerSection
    | DwellTimeSection
    | ParameterEntropySection
    | ArgumentPositionProfileSection
    | ToolDumpSection
    | DataQualitySection
    | RunDiffSection
    | UnknownSection,
    Field(discriminator="kind"),
]


class PreviousRunReference(StrictModel):
    run_id: ReportId
    generated_at: UtcDatetime
    label: str
    link: SafeLink


class DiffMetadata(StrictModel):
    baseline_run_id: ReportId
    candidate_run_id: ReportId
    comparability_status: ComparabilityStatus
    warnings: list[str] = Field(default_factory=list)


class ReportModel(StrictModel):
    report_model_version: str = Field(
        default=REPORT_MODEL_VERSION,
        pattern=r"^\d+\.\d+\.\d+$",
    )
    revision: int = Field(ge=1)
    generated_at: UtcDatetime
    janus_version: str = Field(min_length=1)
    run_id: ReportId
    run: RunMetadata
    sources: list[SourceInfo] = Field(min_length=1)
    retention: RetentionSettings
    data_quality: list[DataQualityEntry] = Field(default_factory=list)
    warnings: list[ReportWarning] = Field(default_factory=list)
    summary: SummaryMetrics
    sections: list[ReportSection] = Field(default_factory=list)
    capabilities: list[Capability] = Field(default_factory=list)
    previous_runs: list[PreviousRunReference] = Field(default_factory=list)
    diff: DiffMetadata | None = None

    @field_validator("sections")
    @classmethod
    def _unique_section_ids(cls, value: list[ReportSection]) -> list[ReportSection]:
        ids = [section.id for section in value]
        if len(ids) != len(set(ids)):
            raise ValueError("section ids must be unique")
        return value

    @model_validator(mode="after")
    def _diff_matches_run_kind(self) -> ReportModel:
        if self.run.run_kind == RunKind.DIFF and self.diff is None:
            raise ValueError("diff metadata is required for diff reports")
        if self.run.run_kind != RunKind.DIFF and self.diff is not None:
            raise ValueError("diff metadata is only valid for diff reports")
        return self
