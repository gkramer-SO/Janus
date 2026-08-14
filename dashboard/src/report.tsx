import type { ComponentChildren } from "preact";
import { useMemo, useState } from "preact/hooks";
import type {
  DataQualityEntry,
  ReportModel,
  SafeLink,
  TaskRef,
} from "./generated/report-model";

type ReportSection = NonNullable<ReportModel["sections"]>[number];
type SortDirection = "ascending" | "descending";

function text(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(2);
  return String(value);
}

function percent(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `${(value * 100).toFixed(1)}%`;
}

function duration(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  if (value < 60) return `${value.toFixed(1)}s`;
  return `${(value / 60).toFixed(1)}m`;
}

function matches(value: unknown, query: string): boolean {
  return !query || JSON.stringify(value).toLocaleLowerCase().includes(query.toLocaleLowerCase());
}

function sortableText(value: ComponentChildren): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

export function SafeAnchor({ link }: { link: SafeLink | null | undefined }) {
  if (!link) return null;
  return <a href={link.url} target="_blank" rel="noreferrer noopener">{link.label}</a>;
}

export function Task({ task }: { task: TaskRef | null | undefined }) {
  if (!task) return <span>—</span>;
  const label = task.command_name ? `${task.command_name} #${task.display_id ?? task.task_id}` : `Task #${task.display_id ?? task.task_id}`;
  return <span class="task-ref"><SafeAnchor link={task.link} />{task.link ? "" : label}{task.timestamp && <small>{new Date(task.timestamp).toLocaleString()}</small>}</span>;
}

function Table({
  label,
  headers,
  rows,
}: {
  label: string;
  headers: string[];
  rows: Array<{ key: string; values: ComponentChildren[]; search: unknown }>;
}) {
  const [direction, setDirection] = useState<SortDirection>("ascending");
  const [sortColumn, setSortColumn] = useState(0);
  const ordered = useMemo(() => [...rows].sort((left, right) => {
    const a = sortableText(left.values[sortColumn]).toLocaleLowerCase();
    const b = sortableText(right.values[sortColumn]).toLocaleLowerCase();
    const comparison = a.localeCompare(b, undefined, { numeric: true });
    return direction === "ascending" ? comparison : -comparison;
  }), [rows, direction, sortColumn]);
  return <div class="table-wrap"><table aria-label={label}>
    <thead><tr>{headers.map((header, index) => <th key={header} scope="col">
      <button type="button" onClick={() => {
        if (sortColumn === index) setDirection(direction === "ascending" ? "descending" : "ascending");
        else { setSortColumn(index); setDirection("ascending"); }
      }}>{header}{sortColumn === index ? (direction === "ascending" ? " ↑" : " ↓") : ""}</button>
    </th>)}</tr></thead>
    <tbody>{ordered.map((row) => <tr key={row.key}>{row.values.map((value, index) => <td key={index}>{value}</td>)}</tr>)}</tbody>
  </table>{ordered.length === 0 && <p class="empty">No rows match the active filter.</p>}</div>;
}

function DataQuality({ entry }: { entry: DataQualityEntry }) {
  const limitations = [...(entry.retention_limitations ?? []), ...(entry.source_limitations ?? []), ...(entry.processing_errors ?? [])];
  return <article class="quality-card"><h3>{entry.source}</h3><dl>
    <dt>Events parsed</dt><dd>{entry.events_parsed}</dd><dt>Unknown status</dt><dd>{entry.unknown_status_percent?.toFixed(1)}%</dd>
    <dt>Skipped</dt><dd>{entry.skipped_entries ?? 0}</dd><dt>Malformed</dt><dd>{entry.malformed_records ?? 0}</dd>
  </dl>{limitations.length > 0 && <ul>{limitations.map((value) => <li key={value}>{value}</li>)}</ul>}</article>;
}

function SummaryChart({ section }: { section: Extract<ReportSection, { kind: "summary-visualization" }> }) {
  const status = section.status_distribution ?? {};
  const total = Object.values(status).reduce<number>((sum, value) => sum + (value ?? 0), 0);
  return <div class="summary-chart" aria-label="Status distribution">
    {(Object.entries(status) as Array<[string, number | undefined]>).map(([name, value]) => <div class={`chart-row ${name}`} key={name}>
      <span>{name}</span><div aria-hidden="true"><i style={{ width: `${total ? ((value ?? 0) / total) * 100 : 0}%` }} /></div><strong>{value ?? 0}</strong>
    </div>)}
    {section.timeline && section.timeline.length > 0 && <p class="timeline-summary">{section.timeline.length} activity bucket(s) across {duration(section.span_seconds)}</p>}
  </div>;
}

export function SectionPanel({ section, query }: { section: ReportSection; query: string }) {
  const [open, setOpen] = useState(section.kind === "summary-visualization" || section.kind === "data-quality");
  const warningMessages = section.warnings?.map((warning) => warning.message) ?? [];
  return <section class={`report-section ${section.status}`} aria-labelledby={`heading-${section.id}`}>
    <button class="section-toggle" type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
      <span><span id={`heading-${section.id}`} role="heading" aria-level={2}>{section.title}</span>{section.confidence && <small class={`confidence ${section.confidence}`}>{section.confidence} confidence</small>}</span>
      <span class={`status ${section.status}`}>{section.status} {open ? "−" : "+"}</span>
    </button>
    {open && <div class="section-content">
      {section.status !== "available" ? <p class="empty">{section.status_reason}</p> : <SectionBody section={section} query={query} />}
      {warningMessages.map((warning) => <p class="section-warning" key={warning}>{warning}</p>)}
    </div>}
  </section>;
}

function SectionBody({ section, query }: { section: ReportSection; query: string }) {
  switch (section.kind) {
    case "summary-visualization": return <SummaryChart section={section} />;
    case "command-failure-summary": return <Table label={section.title} headers={["Command", "Runs", "Success", "Errors", "Failure rate"]} rows={(section.commands ?? []).filter((row) => matches(row, query)).map((row) => ({ key: row.command_name, search: row.command_name, values: [row.command_name, row.execution_count, row.success_count, row.error_count, percent(row.failure_rate)] }))} />;
    case "command-duration": return <Table label={section.title} headers={["Command", "Runs", "Median", "P95", "Outliers"]} rows={(section.commands ?? []).filter((row) => matches(row, query)).map((row) => ({ key: row.command_name, search: row.command_name, values: [row.command_name, row.execution_count, duration(row.median_seconds), duration(row.p95_seconds), row.outlier_count ?? 0] }))} />;
    case "command-retry-success": return <Table label={section.title} headers={["Command", "Attempts", "Outcome", "Duration"]} rows={(section.sequences ?? []).filter((row) => matches(row, query)).map((row, index) => ({ key: `${row.command_name}-${index}`, search: row.command_name, values: [row.command_name, row.attempts, row.succeeded ? "Recovered" : "Unresolved", duration(row.duration_seconds)] }))} />;
    case "friction-score": return <div class="card-grid">{(section.candidates ?? []).filter((row) => matches(row, query)).map((row) => <article class="finding-card" key={row.command_name}><h3>{row.command_name}</h3><strong>{row.score.toFixed(1)}</strong><p>{row.recommended_action}</p><small>{row.sample_size} samples · {row.confidence} confidence</small></article>)}</div>;
    case "callback-health": return <Table label={section.title} headers={["Callback", "Tasks", "Completion", "Failures"]} rows={(section.callbacks ?? []).filter((row) => matches(row, query)).map((row) => ({ key: row.callback_id, search: row.callback_id, values: [row.link ? <SafeAnchor link={row.link} /> : row.callback_id, row.task_count, percent(row.completion_rate), row.consecutive_failure_count ?? 0] }))} />;
    case "av-tracker": return <Table label={section.title} headers={["Vendor", "Executables", "Occurrences", "Task"]} rows={(section.detections ?? []).filter((row) => matches(row, query)).map((row, index) => ({ key: `${row.vendor}-${index}`, search: row.vendor, values: [row.vendor, (row.matched_executables ?? []).join(", "), row.occurrence_count, <Task task={row.task} />] }))} />;
    case "dwell-time": return <Table label={section.title} headers={["From", "To", "Dwell"]} rows={(section.measurements ?? []).filter((row) => matches(row, query)).map((row, index) => ({ key: String(index), search: row, values: [<Task task={row.from_task} />, <Task task={row.to_task} />, duration(row.dwell_seconds)] }))} />;
    case "parameter-entropy": return <Table label={section.title} headers={["Task", "Finding", "Entropy", "Detail"]} rows={(section.findings ?? []).filter((row) => matches(row, query)).map((row, index) => ({ key: String(index), search: row, values: [<Task task={row.task} />, row.finding_type, text(row.token_entropy), row.detail] }))} />;
    case "argument-position-profile": return <Table label={section.title} headers={["Command", "Position", "Finding", "Occurrences", "Detail"]} rows={(section.findings ?? []).filter((row) => matches(row, query)).map((row, index) => ({ key: `${row.command_name}-${index}`, search: row, values: [row.command_name, text(row.position), row.finding_type, row.occurrences ?? 0, row.detail] }))} />;
    case "tool-dump": return <div class="card-grid">{(section.groups ?? []).filter((row) => matches(row, query)).map((row) => <article class="finding-card" key={row.id}><h3>{row.name}</h3><strong>{row.match_count}</strong><p>{row.description}</p><small>{row.unique_command_count ?? 0} unique commands</small></article>)}</div>;
    case "data-quality": return <div class="quality-grid">{(section.entries ?? []).filter((row) => matches(row, query)).map((entry) => <DataQuality entry={entry} key={entry.source} />)}</div>;
    case "run-diff": return <Table label={section.title} headers={["Metric", "Entity", "Classification", "Delta", "Explanation"]} rows={(section.findings ?? []).filter((row) => matches(row, query)).map((row) => ({ key: `${row.metric_id}-${row.entity_id}`, search: row, values: [row.metric_id, row.entity_id, row.classification, text(row.delta), row.explanation] }))} />;
    case "outlier-context": return <Table label={section.title} headers={["Task", "Duration", "Signature"]} rows={(section.outliers ?? []).filter((row) => matches(row, query)).map((row, index) => ({ key: String(index), search: row, values: [<Task task={row.task} />, duration(row.duration_seconds), text(row.sequence_signature)] }))} />;
    case "unknown": return <p class="empty">{section.fallback_message}</p>;
  }
}
