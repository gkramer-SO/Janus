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

function compareValues(left: unknown, right: unknown): number {
  if (typeof left === "number" && typeof right === "number") return left - right;
  return sortableText(left as ComponentChildren).localeCompare(sortableText(right as ComponentChildren), undefined, { numeric: true });
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

function Empty({ children }: { children: ComponentChildren }) {
  return <p class="empty">{children}</p>;
}

function TaskList({ tasks, empty }: { tasks: TaskRef[] | null | undefined; empty: string }) {
  if (!tasks?.length) return <Empty>{empty}</Empty>;
  return <ul class="task-list">{tasks.map((task, index) => <li key={`${task.task_id}-${index}`}><Task task={task} />{task.argument_preview?.text && <code>{task.argument_preview.text}</code>}</li>)}</ul>;
}

function Detail({ label, children }: { label: string; children: ComponentChildren }) {
  return <details class="row-detail"><summary>{label}</summary><div>{children}</div></details>;
}

function Table({
  label,
  headers,
  rows,
  searching,
}: {
  label: string;
  headers: string[];
  rows: Array<{ key: string; values: ComponentChildren[]; sortValues?: unknown[] }>;
  searching: boolean;
}) {
  const [direction, setDirection] = useState<SortDirection>("ascending");
  const [sortColumn, setSortColumn] = useState(0);
  const ordered = useMemo(() => [...rows].sort((left, right) => {
    const a = left.sortValues?.[sortColumn] ?? left.values[sortColumn];
    const b = right.sortValues?.[sortColumn] ?? right.values[sortColumn];
    const comparison = compareValues(a, b);
    return direction === "ascending" ? comparison : -comparison;
  }), [rows, direction, sortColumn]);
  return <div class="table-wrap"><table aria-label={label}>
    <thead><tr>{headers.map((header, index) => <th key={header} scope="col">
      <button type="button" onClick={() => {
        if (sortColumn === index) setDirection(direction === "ascending" ? "descending" : "ascending");
        else { setSortColumn(index); setDirection("ascending"); }
      }}>{header}{sortColumn === index ? (direction === "ascending" ? " ↑" : " ↓") : ""}</button>
    </th>)}</tr></thead>
    <tbody>{ordered.map((row) => <tr key={row.key} data-search-match={searching ? "true" : undefined} tabIndex={searching ? -1 : undefined}>{row.values.map((value, index) => <td key={index}>{value}</td>)}</tr>)}</tbody>
  </table>{ordered.length === 0 && <p class="empty">No rows match the active filter.</p>}</div>;
}

function DataQuality({ entry }: { entry: DataQualityEntry }) {
  const limitations = [...(entry.retention_limitations ?? []), ...(entry.source_limitations ?? []), ...(entry.processing_errors ?? []), ...(entry.analyzer_confidence_warnings ?? [])];
  return <article class="quality-card"><h3>{entry.source}</h3><dl>
    <dt>Events parsed</dt><dd>{entry.events_parsed}</dd><dt>Unknown status</dt><dd>{entry.unknown_status_percent?.toFixed(1)}%</dd>
    <dt>Skipped</dt><dd>{entry.skipped_entries ?? 0}</dd><dt>Malformed</dt><dd>{entry.malformed_records ?? 0}</dd>
    <dt>Invalid timestamps</dt><dd>{entry.invalid_timestamps ?? 0}</dd><dt>Fallback task IDs</dt><dd>{entry.fallback_task_ids ?? 0}</dd>
    {Object.entries(entry.status_distribution ?? {}).map(([name, value]) => <><dt key={`${name}-label`}>{name} results</dt><dd key={name}>{value ?? 0}</dd></>)}
  </dl>
  {Object.keys(entry.invalid_record_counts ?? {}).length > 0 && <Detail label="Invalid record counts"><dl>{Object.entries(entry.invalid_record_counts ?? {}).map(([name, value]) => <><dt key={`${name}-label`}>{name}</dt><dd key={name}>{value}</dd></>)}</dl></Detail>}
  {Object.keys(entry.suppression_reasons ?? {}).length > 0 && <Detail label="Suppressed analyses"><ul>{Object.entries(entry.suppression_reasons ?? {}).map(([name, reason]) => <li key={name}><strong>{name}:</strong> {reason}</li>)}</ul></Detail>}
  {limitations.length > 0 && <ul>{limitations.map((value) => <li key={value}>{value}</li>)}</ul>}</article>;
}

function SummaryChart({ section }: { section: Extract<ReportSection, { kind: "summary-visualization" }> }) {
  const status = section.status_distribution ?? {};
  const total = Object.values(status).reduce<number>((sum, value) => sum + (value ?? 0), 0);
  return <div class="summary-chart" aria-label="Status distribution">
    {(Object.entries(status) as Array<[string, number | undefined]>).map(([name, value]) => <div class={`chart-row ${name}`} key={name}>
      <span>{name}</span><div aria-hidden="true"><i style={{ width: `${total ? ((value ?? 0) / total) * 100 : 0}%` }} /></div><strong>{value ?? 0}</strong>
    </div>)}
    {section.timeline && section.timeline.length > 0 ? <Detail label={`${section.timeline.length} activity bucket(s) across ${duration(section.span_seconds)}`}><ol class="timeline-list">{section.timeline.map((bucket) => <li key={bucket.starts_at}><time dateTime={bucket.starts_at}>{new Date(bucket.starts_at).toLocaleString()}</time><strong>{bucket.count}</strong></li>)}</ol></Detail> : <Empty>No timeline activity was available.</Empty>}
  </div>;
}

export function SectionPanel({ section, query }: { section: ReportSection; query: string }) {
  const [open, setOpen] = useState(section.kind === "summary-visualization" || section.kind === "data-quality");
  const forcedOpen = Boolean(query && matches(section, query));
  const expanded = open || forcedOpen;
  const warningMessages = section.warnings?.map((warning) => warning.message) ?? [];
  return <details class={`report-section ${section.status}`} open={expanded} onToggle={(event) => {
    if (!forcedOpen) setOpen((event.currentTarget as HTMLDetailsElement).open);
  }}>
    <summary class="section-toggle">
      <span><span id={`heading-${section.id}`} role="heading" aria-level={2}>{section.title}</span>{section.confidence && <small class={`confidence ${section.confidence}`}>{section.confidence} confidence</small>}</span>
      <span class={`status ${section.status}`}>{section.status} {expanded ? "−" : "+"}</span>
    </summary>
    <div class="section-content">
      {section.status !== "available" ? <p class="empty">{section.status_reason}</p> : <SectionBody section={section} query={query} />}
      {warningMessages.map((warning) => <p class="section-warning" key={warning}>{warning}</p>)}
    </div>
  </details>;
}

function SectionBody({ section, query }: { section: ReportSection; query: string }) {
  switch (section.kind) {
    case "summary-visualization": return <SummaryChart section={section} />;
    case "command-failure-summary": {
      const commands = (section.commands ?? []).filter((row) => matches(row, query));
      return <><Table searching={Boolean(query)} label={section.title} headers={["Command", "Runs", "Success", "Errors", "Unknown", "Failure rate", "Callbacks"]} rows={commands.map((row) => ({ key: row.command_name, values: [row.command_name, row.execution_count, row.success_count, row.error_count, row.unknown_count ?? 0, percent(row.failure_rate), row.affected_callbacks ?? 0], sortValues: [row.command_name, row.execution_count, row.success_count, row.error_count, row.unknown_count ?? 0, row.failure_rate, row.affected_callbacks ?? 0] }))} />
        <div class="detail-list">{commands.filter((row) => row.failures?.length).map((row) => <Detail key={row.command_name} label={`${row.command_name}: ${row.failures?.length} failure detail(s)`}><ul class="event-list">{row.failures?.map((failure, index) => <li key={`${failure.task.task_id}-${index}`}><Task task={failure.task} /><span>{failure.dispatch_failed ? "Dispatch failed" : failure.status ?? "Error"}</span>{failure.output_preview?.text && <pre>{failure.output_preview.text}</pre>}{failure.output_preview?.binary && <small>Binary output withheld.</small>}</li>)}</ul></Detail>)}</div></>;
    }
    case "command-duration": {
      const commands = (section.commands ?? []).filter((row) => matches(row, query));
      return <><Table searching={Boolean(query)} label={section.title} headers={["Command", "Runs", "Min", "Mean", "Median", "P95", "Max", "Outliers"]} rows={commands.map((row) => ({ key: row.command_name, values: [row.command_name, row.execution_count, duration(row.min_seconds), duration(row.mean_seconds), duration(row.median_seconds), duration(row.p95_seconds), duration(row.max_seconds), row.outlier_count ?? 0], sortValues: [row.command_name, row.execution_count, row.min_seconds, row.mean_seconds, row.median_seconds, row.p95_seconds, row.max_seconds, row.outlier_count ?? 0] }))} />
        <div class="detail-list">{commands.filter((row) => row.slowest_task || row.outlier_tasks?.length).map((row) => <Detail key={row.command_name} label={`${row.command_name} task context`}>
          {row.slowest_task && <p><strong>Slowest:</strong> <Task task={row.slowest_task} /></p>}<TaskList tasks={row.outlier_tasks} empty="No outlier tasks." />
        </Detail>)}</div></>;
    }
    case "command-retry-success": {
      const sequences = (section.sequences ?? []).filter((row) => matches(row, query));
      return <><Table searching={Boolean(query)} label={section.title} headers={["Command", "Attempts", "Outcome", "Final status", "Duration"]} rows={sequences.map((row, index) => ({ key: `${row.command_name}-${index}`, values: [row.command_name, row.attempts, row.succeeded ? "Recovered" : "Unresolved", text(row.final_status), duration(row.duration_seconds)], sortValues: [row.command_name, row.attempts, row.succeeded ? 1 : 0, row.final_status, row.duration_seconds] }))} />
        <div class="detail-list">{sequences.map((row, index) => <Detail key={`${row.command_name}-${index}`} label={`${row.command_name}: attempt context`}><h3>Attempts</h3><TaskList tasks={row.tasks} empty="No attempt task references." /><h3>Argument changes</h3>{row.transitions?.length ? <ul>{row.transitions.map((transition) => <li key={`${transition.from_attempt}-${transition.to_attempt}`}>Attempt {transition.from_attempt} → {transition.to_attempt}: {(transition.changes ?? []).join(", ") || transition.note || "No recorded change"}</li>)}</ul> : <Empty>No structured argument changes.</Empty>}<h3>Intervening tasks</h3><TaskList tasks={row.intervening_tasks} empty="No intervening tasks." /></Detail>)}</div></>;
    }
    case "friction-score": {
      const candidates = (section.candidates ?? []).filter((row) => matches(row, query));
      if (!candidates.length) return <Empty>No friction candidates match the active filter.</Empty>;
      return <div class="card-grid">{candidates.map((row) => <article class="finding-card" key={row.command_name} data-search-match={query ? "true" : undefined} tabIndex={query ? -1 : undefined}><h3>{row.command_name}</h3><strong>{row.score.toFixed(1)}</strong><p>{row.recommended_action}</p><small>{row.sample_size} samples · {row.confidence} confidence{row.suppressed ? " · action suppressed" : ""}</small><Detail label="Score evidence"><dl>{Object.entries(row.components ?? {}).map(([name, value]) => <><dt key={`${name}-label`}>{name}</dt><dd key={name}>{text(value)}</dd></>)}</dl>{row.drivers?.length ? <ul>{row.drivers.map((driver) => <li key={driver.component}><strong>{driver.label}:</strong> {text(driver.value)} ({text(driver.impact)} impact)</li>)}</ul> : <Empty>No score drivers.</Empty>}{[...(row.confidence_reasons ?? []), ...(row.limitations ?? [])].map((reason) => <p key={reason}>{reason}</p>)}</Detail></article>)}</div>;
    }
    case "callback-health": {
      const callbacks = (section.callbacks ?? []).filter((row) => matches(row, query));
      return <><Table searching={Boolean(query)} label={section.title} headers={["Callback", "Tasks", "Success", "Errors", "Unknown", "Completion", "Consecutive failures"]} rows={callbacks.map((row) => ({ key: row.callback_id, values: [row.link ? <SafeAnchor link={row.link} /> : row.callback_id, row.task_count, row.success_count ?? 0, row.error_count ?? 0, row.unknown_count ?? 0, percent(row.completion_rate), row.consecutive_failure_count ?? 0], sortValues: [row.callback_display_id ?? row.callback_id, row.task_count, row.success_count ?? 0, row.error_count ?? 0, row.unknown_count ?? 0, row.completion_rate, row.consecutive_failure_count ?? 0] }))} />
        <div class="detail-list">{callbacks.filter((row) => row.trailing_failures?.length || row.last_successful_task).map((row) => <Detail key={row.callback_id} label={`Callback ${row.callback_display_id ?? row.callback_id} context`}><p>{row.first_task_at ? new Date(row.first_task_at).toLocaleString() : "Unknown start"} → {row.last_task_at ? new Date(row.last_task_at).toLocaleString() : "unknown end"}</p>{row.last_successful_task && <p><strong>Last success:</strong> <Task task={row.last_successful_task} /></p>}<TaskList tasks={row.trailing_failures} empty="No trailing failures." /></Detail>)}</div></>;
    }
    case "av-tracker": {
      const detections = (section.detections ?? []).filter((row) => matches(row, query));
      return <><p class="section-summary">Scanned {section.scanned_task_count ?? 0} process-list task(s); found {section.detections?.length ?? 0} detection row(s).</p><Table searching={Boolean(query)} label={section.title} headers={["Vendor", "Executables", "Occurrences", "Status", "Task"]} rows={detections.map((row, index) => ({ key: `${row.vendor}-${index}`, values: [row.vendor, (row.matched_executables ?? []).join(", "), row.occurrence_count, text(row.status), <Task task={row.task} />], sortValues: [row.vendor, (row.matched_executables ?? []).join(", "), row.occurrence_count, row.status, row.task.display_id ?? row.task.task_id] }))} /></>;
    }
    case "dwell-time": return <><dl class="inline-metrics"><dt>Median</dt><dd>{duration(section.median_seconds)}</dd><dt>P95</dt><dd>{duration(section.p95_seconds)}</dd><dt>Maximum</dt><dd>{duration(section.max_seconds)}</dd></dl><Table searching={Boolean(query)} label={section.title} headers={["From", "To", "Dwell"]} rows={(section.measurements ?? []).filter((row) => matches(row, query)).map((row, index) => ({ key: String(index), values: [<Task task={row.from_task} />, <Task task={row.to_task} />, duration(row.dwell_seconds)], sortValues: [row.from_task.display_id ?? row.from_task.task_id, row.to_task.display_id ?? row.to_task.task_id, row.dwell_seconds] }))} /></>;
    case "parameter-entropy": {
      const findings = (section.findings ?? []).filter((row) => matches(row, query));
      const repeated = (section.repeated_tokens ?? []).filter((row) => matches(row, query));
      return <><Table searching={Boolean(query)} label={section.title} headers={["Task", "Finding", "Entropy", "Detail"]} rows={findings.map((row, index) => ({ key: String(index), values: [<Task task={row.task} />, row.finding_type, text(row.token_entropy), row.detail], sortValues: [row.task.display_id ?? row.task.task_id, row.finding_type, row.token_entropy, row.detail] }))} /><Detail label={`${section.repeated_token_count ?? repeated.length} repeated high-entropy token(s)`}>{repeated.length ? <Table searching={Boolean(query)} label="Repeated high-entropy tokens" headers={["Prefix", "Mean entropy", "Occurrences", "Commands", "Detail"]} rows={repeated.map((row) => ({ key: row.token_prefix, values: [row.token_prefix, text(row.entropy_mean), row.occurrences, (row.commands ?? []).join(", "), row.detail], sortValues: [row.token_prefix, row.entropy_mean, row.occurrences, (row.commands ?? []).join(", "), row.detail] }))} /> : <Empty>No repeated high-entropy tokens.</Empty>}</Detail></>;
    }
    case "argument-position-profile": {
      const findings = (section.findings ?? []).filter((row) => matches(row, query));
      return <><p class="section-summary">Profiled {section.commands_profiled ?? 0} command(s), maximum argument depth {section.max_depth ?? 0}.</p><Table searching={Boolean(query)} label={section.title} headers={["Command", "Position", "Finding", "Occurrences", "Sample", "Ratio", "Detail"]} rows={findings.map((row, index) => ({ key: `${row.command_name}-${index}`, values: [row.command_name, text(row.position), row.finding_type, row.occurrences ?? 0, row.sample_size ?? 0, percent(row.ratio), row.detail], sortValues: [row.command_name, row.position, row.finding_type, row.occurrences ?? 0, row.sample_size ?? 0, row.ratio, row.detail] }))} /><Detail label="Depth distribution"><Table searching={false} label="Argument depth distribution" headers={["Command", "Tasks", "Minimum", "Maximum", "Mean"]} rows={(section.depth_distribution ?? []).map((row) => ({ key: row.command_name, values: [row.command_name, row.task_count ?? 0, row.min_depth ?? 0, row.max_depth ?? 0, text(row.mean_depth)], sortValues: [row.command_name, row.task_count, row.min_depth, row.max_depth, row.mean_depth] }))} /></Detail><Detail label="Per-command profiles"><Table searching={false} label="Per-command argument profiles" headers={["Command", "Tasks", "Positions"]} rows={(section.command_profiles ?? []).map((row) => ({ key: row.command_name, values: [row.command_name, row.task_count ?? 0, row.positions ?? 0] }))} /></Detail></>;
    }
    case "tool-dump": {
      const groups = (section.groups ?? []).filter((row) => matches(row, query));
      if (!groups.length) return <Empty>No tool-dump groups match the active filter.</Empty>;
      return <div class="card-grid">{groups.map((row) => <article class="finding-card" key={row.id} data-search-match={query ? "true" : undefined} tabIndex={query ? -1 : undefined}><h3>{row.name}</h3><strong>{row.match_count}</strong><p>{row.description}</p><small>{row.unique_command_count ?? 0} unique commands{row.artifact_path ? ` · ${row.artifact_path}` : ""}</small><Detail label="Matched tasks"><TaskList tasks={row.entries} empty="No task entries were retained for this group." /></Detail></article>)}</div>;
    }
    case "data-quality": return <div class="quality-grid">{(section.entries ?? []).filter((row) => matches(row, query)).map((entry) => <div key={entry.source} data-search-match={query ? "true" : undefined} tabIndex={query ? -1 : undefined}><DataQuality entry={entry} /></div>)}</div>;
    case "run-diff": {
      const findings = (section.findings ?? []).filter((row) => matches(row, query));
      const summary = section.summary;
      return <><p class={`comparability ${section.comparability_status}`}>Comparability: {section.comparability_status}</p>{summary && <dl class="inline-metrics"><dt>Regressions</dt><dd>{summary.likely_regressions ?? 0}</dd><dt>Improvements</dt><dd>{summary.likely_improvements ?? 0}</dd><dt>Low confidence</dt><dd>{summary.low_confidence_changes ?? 0}</dd><dt>Not comparable</dt><dd>{summary.not_comparable ?? 0}</dd></dl>}<Table searching={Boolean(query)} label={section.title} headers={["Metric", "Entity", "Classification", "Confidence", "Baseline", "Candidate", "Delta", "Explanation"]} rows={findings.map((row) => ({ key: `${row.metric_id}-${row.entity_id}`, values: [row.metric_id, row.entity_id, row.classification, row.confidence, text(row.baseline_value), text(row.candidate_value), text(row.delta), row.explanation], sortValues: [row.metric_id, row.entity_id, row.classification, row.confidence, row.baseline_value, row.candidate_value, row.delta, row.explanation] }))} /><Detail label="Entity presence changes"><Table searching={false} label="New and removed entities" headers={["Change", "Type", "Entity", "Count"]} rows={[...(section.new_entities ?? []).map((row) => ({ key: `new-${row.entity_type}-${row.entity_id}`, values: ["New", row.entity_type, row.entity_id, row.count ?? 0] })), ...(section.removed_entities ?? []).map((row) => ({ key: `removed-${row.entity_type}-${row.entity_id}`, values: ["Removed", row.entity_type, row.entity_id, row.count ?? 0] }))]} /></Detail></>;
    }
    case "outlier-context": {
      const outliers = (section.outliers ?? []).filter((row) => matches(row, query));
      return <><Table searching={Boolean(query)} label={section.title} headers={["Task", "Duration", "Signature"]} rows={outliers.map((row, index) => ({ key: String(index), values: [<Task task={row.task} />, duration(row.duration_seconds), text(row.sequence_signature)], sortValues: [row.task.display_id ?? row.task.task_id, row.duration_seconds, row.sequence_signature] }))} /><div class="detail-list">{outliers.map((row, index) => <Detail key={`${row.task.task_id}-${index}`} label={`Context for task ${row.task.display_id ?? row.task.task_id}`}><h3>Preceding tasks</h3><TaskList tasks={row.preceding} empty="No preceding task context." /><h3>Following tasks</h3><TaskList tasks={row.following} empty="No following task context." /></Detail>)}</div></>;
    }
    case "unknown": return <p class="empty">{section.fallback_message}</p>;
  }
}
