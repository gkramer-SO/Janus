import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import type {
  CallbackHealthRow,
  DataQualityEntry,
  ReportModel,
  SafeLink,
  TaskRef,
} from "./generated/report-model";

type ReportSection = NonNullable<ReportModel["sections"]>[number];
type SortDirection = "ascending" | "descending";
type OutlierRow = NonNullable<Extract<ReportSection, { kind: "outlier-context" }>["outliers"]>[number];
type ToolDumpGroup = NonNullable<Extract<ReportSection, { kind: "tool-dump" }>["groups"]>[number];

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

function assertNever(value: never): never {
  throw new Error(`Unsupported report section: ${JSON.stringify(value)}`);
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

function ToolInvocation({ task }: { task: TaskRef }) {
  const command = task.command_name ?? "Unknown command";
  const preview = task.argument_preview;
  if (preview?.text) return <code class="tool-invocation">{command} {preview.text}{preview.truncated ? "…" : ""}</code>;
  if (preview?.retention && preview.retention !== "all" && preview.retention !== "unknown") {
    return <code class="tool-invocation">{command} [arguments {preview.retention === "drop" ? "redacted" : preview.retention}]</code>;
  }
  return <code class="tool-invocation">{command}</code>;
}

function ToolGroup({ group }: { group: ToolDumpGroup }) {
  return <span class="tool-group"><strong>{group.name}</strong></span>;
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

type ChartDatum = { label: string; value: number; displayValue?: string };

type ChartSegment = ChartDatum & { tone?: "success" | "error" | "unknown" | "accent" };

function ChartFrame({ title, detail, question, children }: { title: string; detail: string; question?: string; children: ComponentChildren }) {
  return <figure class="data-chart" aria-label={title}>
    <figcaption><span>{title}</span><small>{detail}</small></figcaption>
    {question && <p class="chart-question">{question}</p>}
    {children}
  </figure>;
}

function smoothCurve(points: Array<[number, number]>): string {
  if (points.length < 2) return "";
  return points.slice(1).reduce((path, point, index) => {
    const previous = points[index];
    const midpoint = (previous[0] + point[0]) / 2;
    return `${path} C ${midpoint} ${previous[1]}, ${midpoint} ${point[1]}, ${point[0]} ${point[1]}`;
  }, `M ${points[0][0]} ${points[0][1]}`);
}

function DwellDistribution({ data }: { data: Array<{ label: string; count?: number }> }) {
  const [active, setActive] = useState(0);
  const visible = data.map((bucket) => ({ ...bucket, count: bucket.count ?? 0 })).filter((bucket) => bucket.count > 0);
  const identity = visible.map((bucket) => `${bucket.label}:${bucket.count}`).join("|");
  useEffect(() => setActive(0), [identity]);
  if (!visible.length) return null;
  const total = visible.reduce((sum, bucket) => sum + bucket.count, 0);
  const maximum = Math.max(...visible.map((bucket) => bucket.count));
  const selected = visible[active] ?? visible[0];
  if (visible.length === 1) return <ChartFrame title="Dwell distribution" detail={`${total} interval${total === 1 ? "" : "s"}`} question="How are operator pauses distributed across the engagement?">
    <div class="single-signal"><span>{selected.label}</span><strong>{selected.count} interval{selected.count === 1 ? "" : "s"}</strong></div>
  </ChartFrame>;
  const points = visible.map((bucket, index): [number, number] => [((index + .5) / visible.length) * 100, 88 - (bucket.count / maximum) * 72]);
  return <ChartFrame title="Dwell distribution" detail={`${total} intervals`} question="How are operator pauses distributed across the engagement?">
    <div class="chart-readout" aria-live="polite"><span>{selected.label} operator pause</span><strong>{selected.count} · {percent(selected.count / total)}</strong></div>
    <div class="dwell-plot" style={{ gridTemplateColumns: `repeat(${visible.length}, minmax(54px, 1fr))` }}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d={smoothCurve(points)} /></svg>
      {visible.map((bucket, index) => <button type="button" class={index === active ? "active" : ""} key={bucket.label} onMouseEnter={() => setActive(index)} onFocus={() => setActive(index)} onClick={() => setActive(index)} aria-label={`${bucket.label}: ${bucket.count} intervals`}>
        <span class="dwell-bar-space"><i style={{ height: `${Math.max(4, (bucket.count / maximum) * 82)}%` }} /></span>
        <small>{bucket.label}</small>
      </button>)}
    </div>
  </ChartFrame>;
}

export function DotPlot({ title, question, data, formatValue = text }: { title: string; question: string; data: ChartDatum[]; formatValue?: (value: number) => string }) {
  const [active, setActive] = useState(0);
  const visible = [...data]
    .filter((datum) => Number.isFinite(datum.value))
    .sort((left, right) => right.value - left.value)
    .slice(0, 8);
  const identity = visible.map((datum) => datum.label).join("|");
  useEffect(() => setActive(0), [identity]);
  if (!visible.length) return null;
  const minimum = Math.min(0, ...visible.map((datum) => datum.value));
  const maximum = Math.max(1, ...visible.map((datum) => datum.value));
  const span = maximum - minimum || 1;
  const selected = visible[active] ?? visible[0];
  if (visible.length === 1) return <ChartFrame title={title} detail="1 result" question={question}>
    <div class="single-signal"><span>{selected.label}</span><strong>{selected.displayValue ?? formatValue(selected.value)}</strong></div>
  </ChartFrame>;
  return <ChartFrame title={title} detail={`${visible.length} ranked results`} question={question}>
    <div class="chart-readout" aria-live="polite"><span>{selected.label}</span><strong>{selected.displayValue ?? formatValue(selected.value)}</strong></div>
    <div class="dot-plot">
      <div class="plot-scale"><span>{formatValue(minimum)}</span><span>{formatValue(maximum)}</span></div>
      {visible.map((datum, index) => <button class={`dot-row${index === active ? " active" : ""}`} type="button" key={datum.label} onMouseEnter={() => setActive(index)} onFocus={() => setActive(index)} onClick={() => setActive(index)} aria-label={`${datum.label}: ${datum.displayValue ?? formatValue(datum.value)}`}>
        <span title={datum.label}>{datum.label}</span>
        <i class="dot-track" aria-hidden="true"><b style={{ left: `${((datum.value - minimum) / span) * 100}%` }} /></i>
        <strong>{datum.displayValue ?? formatValue(datum.value)}</strong>
      </button>)}
    </div>
  </ChartFrame>;
}

const ENTROPY_FLAG_THRESHOLD = 4.5;
const ENTROPY_SCALE_MAX = 8;

function entropyKind(findingType: string): "high" | "low" {
  return findingType === "low_entropy_for_expected_high_entropy_command" ? "low" : "high";
}

function entropyKindLabel(findingType: string): string {
  if (findingType === "high_entropy_token") return "High-entropy token";
  if (findingType === "low_entropy_for_expected_high_entropy_command") return "Below expected entropy";
  return findingType.replace(/_/g, " ");
}

export function EntropyPlot({ findings }: { findings: Array<{ label: string; value: number; findingType: string; token?: string | null }> }) {
  const [active, setActive] = useState(0);
  const visible = [...findings]
    .filter((finding) => Number.isFinite(finding.value))
    .sort((left, right) => {
      const leftLow = entropyKind(left.findingType) === "low";
      const rightLow = entropyKind(right.findingType) === "low";
      if (leftLow !== rightLow) return leftLow ? -1 : 1;
      return right.value - left.value;
    })
    .slice(0, 12);
  const identity = visible.map((finding) => `${finding.label}:${finding.value}:${finding.findingType}`).join("|");
  useEffect(() => setActive(0), [identity]);
  if (!visible.length) return null;
  const scaleMax = Math.max(ENTROPY_SCALE_MAX, ...visible.map((finding) => finding.value));
  const selected = visible[active] ?? visible[0];
  const mark = (bits: number) => `${(bits / scaleMax) * 100}%`;
  return <ChartFrame title="Shannon entropy by argument" detail={`${visible.length} scored finding${visible.length === 1 ? "" : "s"} · bits/char vs 4.5 flag`} question="Which arguments look encoded, or too weak for a command that should carry a blob?">
    <div class="chart-readout" aria-live="polite"><span>{selected.token ? <code class="entropy-token">{selected.token}</code> : `${selected.label} · ${entropyKindLabel(selected.findingType)}`}</span><strong>{selected.value.toFixed(2)} bits/char</strong></div>
    <div class="entropy-plot">
      <div class="entropy-scale" aria-hidden="true">
        <span />
        <div class="entropy-track-scale">
          <span class="entropy-tick" style={{ left: "0" }}>0</span>
          <span class="entropy-tick" style={{ left: mark(4) }}>4.0 English</span>
          <span class="entropy-tick flag" style={{ left: mark(ENTROPY_FLAG_THRESHOLD) }}>4.5 flag</span>
          <span class="entropy-tick" style={{ left: mark(6) }}>6.0 base64</span>
          <span class="entropy-tick end" style={{ left: "100%" }}>{scaleMax.toFixed(0)}</span>
        </div>
        <span />
      </div>
      {visible.map((finding, index) => {
        const kind = entropyKind(finding.findingType);
        const overFlag = finding.value >= ENTROPY_FLAG_THRESHOLD;
        return <button type="button" class={`entropy-row${index === active ? " active" : ""}`} key={`${finding.label}-${index}`} onMouseEnter={() => setActive(index)} onFocus={() => setActive(index)} onClick={() => setActive(index)} aria-label={`${finding.label}, ${entropyKindLabel(finding.findingType)}: ${finding.value.toFixed(2)} bits per character${overFlag ? ", at or above the 4.5 flag threshold" : ""}`}>
          <span title={finding.label}><strong>{finding.label}</strong><small>{finding.token || entropyKindLabel(finding.findingType)}</small></span>
          <i class="entropy-track" aria-hidden="true">
            <em class="entropy-english" style={{ width: mark(4) }} />
            <b class={`entropy-bar ${kind}${overFlag ? " flagged" : ""}`} style={{ width: `${(finding.value / scaleMax) * 100}%` }} />
            <i class="entropy-threshold" style={{ left: mark(ENTROPY_FLAG_THRESHOLD) }} />
          </i>
          <strong>{finding.value.toFixed(2)}</strong>
        </button>;
      })}
    </div>
    <div class="inline-legend entropy-legend"><span><i class="entropy-high" />At or above 4.5 flag</span><span><i class="entropy-low" />Below expected for the command</span></div>
  </ChartFrame>;
}

export function DonutChart({ title, question, data }: { title: string; question?: string; data: ChartSegment[] }) {
  const [active, setActive] = useState(0);
  const visible = data.filter((datum) => Number.isFinite(datum.value) && datum.value > 0);
  const identity = visible.map((datum) => datum.label).join("|");
  useEffect(() => setActive(0), [identity]);
  const total = visible.reduce((sum, datum) => sum + datum.value, 0);
  if (!total) return null;
  let offset = 0;
  const arcs = visible.map((datum) => {
    const percentOfTotal = (datum.value / total) * 100;
    const arc = { ...datum, percentOfTotal, offset };
    offset += percentOfTotal;
    return arc;
  });
  const selected = arcs[active] ?? arcs[0];
  return <ChartFrame title={title} detail={`${total.toLocaleString()} result${total === 1 ? "" : "s"}`} question={question}>
    <div class="donut-layout">
      <div class="donut-wrap">
        <svg class="donut-chart" viewBox="0 0 120 120" role="img" aria-label={arcs.map((datum) => `${datum.label}: ${datum.value}`).join(", ")}>
          <circle class="donut-base" cx="60" cy="60" r="46" pathLength="100" />
          {arcs.map((datum, index) => <circle key={datum.label} class={`donut-segment ${datum.tone ?? "accent"}${index === active ? " active" : ""}`} cx="60" cy="60" r="46" pathLength="100" stroke-dasharray={`${datum.percentOfTotal} ${100 - datum.percentOfTotal}`} stroke-dashoffset={-datum.offset} onMouseEnter={() => setActive(index)} onFocus={() => setActive(index)} onClick={() => setActive(index)} tabIndex={0}><title>{datum.label}: {datum.value} ({datum.percentOfTotal.toFixed(1)}%)</title></circle>)}
        </svg>
        <div class="donut-center"><strong>{selected.value.toLocaleString()}</strong><span>{selected.label}</span></div>
      </div>
      <div class="chart-legend">{arcs.map((datum, index) => <button type="button" class={index === active ? "active" : ""} key={datum.label} onMouseEnter={() => setActive(index)} onFocus={() => setActive(index)} onClick={() => setActive(index)} aria-pressed={index === active} aria-label={`${datum.label}: ${datum.value} result${datum.value === 1 ? "" : "s"}, ${datum.percentOfTotal.toFixed(1)}%`}><i class={datum.tone ?? "accent"} /><span>{datum.label}</span><strong>{datum.value.toLocaleString()}</strong><small>{datum.percentOfTotal.toFixed(1)}%</small></button>)}</div>
    </div>
  </ChartFrame>;
}

export function TimelineChart({ title, question, data }: { title: string; question: string; data: ChartDatum[] }) {
  const [active, setActive] = useState(Math.max(0, data.length - 1));
  useEffect(() => setActive(Math.max(0, data.length - 1)), [data.length]);
  if (!data.length) return null;
  const maximum = Math.max(...data.map((datum) => datum.value), 1);
  const selected = data[active] ?? data[data.length - 1];
  const labelEvery = Math.max(1, Math.ceil(data.length / 6));
  const gridColumns = `repeat(${data.length}, minmax(0, 1fr))`;
  const moveFocus = (index: number, key: string, container: HTMLElement) => {
    let next = index;
    if (key === "ArrowLeft") next = Math.max(0, index - 1);
    else if (key === "ArrowRight") next = Math.min(data.length - 1, index + 1);
    else if (key === "Home") next = 0;
    else if (key === "End") next = data.length - 1;
    else return false;
    setActive(next);
    container.querySelectorAll<HTMLButtonElement>(".timeline-bucket")[next]?.focus();
    return true;
  };
  return <ChartFrame title={title} detail={`${data.length} activity intervals · hover, focus, or use arrow keys`} question={question}>
    <div class="chart-readout" aria-live="polite"><span>{new Date(selected.label).toLocaleString()}</span><strong>{selected.displayValue ?? `${selected.value} task${selected.value === 1 ? "" : "s"}`}</strong></div>
    <div class="timeline-chart" role="group" aria-label={`${title}: ${data.length} activity intervals`}>
      <div class="timeline-scale" aria-hidden="true"><span>{maximum}</span><span>{Math.round(maximum / 2)}</span><span>0</span></div>
      <div class="timeline-plot">
        <div class="timeline-bars" style={{ gridTemplateColumns: gridColumns }}>
          {data.map((datum, index) => <button type="button" class={`timeline-bucket${index === active ? " active" : ""}`} key={`${datum.label}-${index}`} onMouseEnter={() => setActive(index)} onFocus={() => setActive(index)} onClick={() => setActive(index)} onKeyDown={(event) => {
            if (moveFocus(index, event.key, event.currentTarget.parentElement!.parentElement!)) event.preventDefault();
          }} aria-pressed={index === active} aria-label={`${new Date(datum.label).toLocaleString()}: ${datum.value} task${datum.value === 1 ? "" : "s"}`}>
            <span class="timeline-bar-space" aria-hidden="true"><i class="timeline-bar" style={{ height: `${datum.value ? Math.max(4, (datum.value / maximum) * 100) : 0}%` }} /></span>
          </button>)}
        </div>
        <div class="timeline-axis" style={{ gridTemplateColumns: gridColumns }} aria-hidden="true">
          {data.map((datum, index) => <span key={`${datum.label}-axis-${index}`}>{index % labelEvery === 0 || index === data.length - 1 ? new Date(datum.label).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric" }) : ""}</span>)}
        </div>
      </div>
    </div>
  </ChartFrame>;
}

function SingleBucketActivity({ bucket, spanSeconds }: { bucket: ChartDatum; spanSeconds: number | null | undefined }) {
  return <ChartFrame title="Command Volume" detail="Only observed activity interval" question="When was task activity concentrated?">
    <div class="single-activity">
      <strong>{bucket.value.toLocaleString()}<span>task{bucket.value === 1 ? "" : "s"}</span></strong>
      <div><span>Bucket started</span><time dateTime={bucket.label}>{new Date(bucket.label).toLocaleString()}</time></div>
      <div><span>Observed span</span><b>{duration(spanSeconds)}</b></div>
    </div>
  </ChartFrame>;
}

function outlierKey(row: OutlierRow): string {
  return `${row.task.task_id}-${row.task.display_id ?? ""}-${row.duration_seconds}`;
}

function ContextStep({ task, phase, selected = false }: { task: TaskRef; phase: "Before" | "Outlier" | "After"; selected?: boolean }) {
  return <article class={`context-step${selected ? " selected" : ""}`}>
    <small>{phase}</small>
    <ToolInvocation task={task} />
    <Task task={task} />
  </article>;
}

function OutlierExplorer({ outliers }: { outliers: OutlierRow[] }) {
  const ranked = [...outliers].sort((left, right) => right.duration_seconds - left.duration_seconds);
  const identity = ranked.map(outlierKey).join("|");
  const [active, setActive] = useState(0);
  useEffect(() => setActive(0), [identity]);
  if (!ranked.length) return <Empty>No duration outliers were detected.</Empty>;
  const selected = ranked[active] ?? ranked[0];
  const commandCount = new Set(ranked.map((row) => row.task.command_name ?? "Unknown command")).size;
  const moveFocus = (index: number, key: string, container: HTMLElement) => {
    let next = index;
    if (key === "ArrowUp") next = Math.max(0, index - 1);
    else if (key === "ArrowDown") next = Math.min(ranked.length - 1, index + 1);
    else if (key === "Home") next = 0;
    else if (key === "End") next = ranked.length - 1;
    else return false;
    setActive(next);
    container.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();
    return true;
  };
  const sequence: Array<{ task: TaskRef; phase: "Before" | "Outlier" | "After"; selected?: boolean }> = [
    ...(selected.preceding ?? []).map((task) => ({ task, phase: "Before" as const })),
    { task: selected.task, phase: "Outlier", selected: true },
    ...(selected.following ?? []).map((task) => ({ task, phase: "After" as const })),
  ];

  return <div class="outlier-explorer">
    <p class="outlier-guidance">Duration marks the unusual task. Neighboring commands provide investigation context, not proof of causation.</p>
    <div class="outlier-overview" aria-label="Outlier summary">
      <div><span>Detected</span><strong>{ranked.length}</strong></div>
      <div><span>Longest</span><strong>{duration(ranked[0].duration_seconds)}</strong></div>
      <div><span>Commands</span><strong>{commandCount}</strong></div>
    </div>
    <div class="outlier-workspace">
      <div class="outlier-picker" role="group" aria-label="Select an outlier task">
        {ranked.map((row, index) => <button type="button" key={outlierKey(row)} class={index === active ? "active" : ""} onMouseEnter={() => setActive(index)} onFocus={() => setActive(index)} onClick={() => setActive(index)} onKeyDown={(event) => {
          if (moveFocus(index, event.key, event.currentTarget.parentElement!)) event.preventDefault();
        }} aria-pressed={index === active}>
          <span><strong>{row.task.command_name ?? "Unknown command"}</strong><small>Task {row.task.display_id ?? row.task.task_id}</small></span>
          <b>{duration(row.duration_seconds)}</b>
        </button>)}
      </div>
      <article class="outlier-inspector" aria-live="polite">
        <header><div><small>Selected outlier</small><ToolInvocation task={selected.task} /><Task task={selected.task} /></div><strong>{duration(selected.duration_seconds)}</strong></header>
        <div class="context-sequence" role="group" aria-label={`Command context for task ${selected.task.display_id ?? selected.task.task_id}`}>
          {sequence.map((step, index) => <div class="context-node" key={`${step.phase}-${step.task.task_id}-${index}`}>{index > 0 && <span class="context-arrow" aria-hidden="true">→</span>}<ContextStep {...step} /></div>)}
        </div>
        {selected.sequence_signature && <p class="sequence-signature"><span>Recorded sequence</span><code>{selected.sequence_signature}</code></p>}
      </article>
    </div>
  </div>;
}

type StackedRow = { label: string; segments: ChartSegment[] };

export function StackedChart({ title, question, rows }: { title: string; question: string; rows: StackedRow[] }) {
  const [active, setActive] = useState({ row: 0, segment: 0 });
  const visible = rows.map((row) => ({ ...row, segments: row.segments.filter((segment) => segment.value > 0) })).filter((row) => row.segments.length).slice(0, 8);
  const identity = visible.map((row) => `${row.label}:${row.segments.map((segment) => `${segment.label}:${segment.value}`).join(",")}`).join("|");
  useEffect(() => setActive({ row: 0, segment: 0 }), [identity]);
  if (!visible.length) return null;
  const legend = Array.from(new Map(visible.flatMap((row) => row.segments).map((segment) => [segment.label, segment])).values());
  const selectedRow = visible[active.row] ?? visible[0];
  const selectedSegment = selectedRow.segments[active.segment] ?? selectedRow.segments[0];
  const selectedTotal = selectedRow.segments.reduce((sum, segment) => sum + segment.value, 0);
  return <ChartFrame title={title} detail="composition, not just rank" question={question}>
    <div class="chart-readout" aria-live="polite"><span>{selectedRow.label} · {selectedSegment.label}</span><strong>{selectedSegment.value.toLocaleString()} · {selectedTotal ? ((selectedSegment.value / selectedTotal) * 100).toFixed(1) : "0.0"}%</strong></div>
    <div class="stacked-chart">{visible.map((row, rowIndex) => {
      const total = row.segments.reduce((sum, segment) => sum + segment.value, 0);
      return <div class="stacked-row" key={row.label}><span title={row.label}>{row.label}</span><div class="stack-track">{row.segments.map((segment, segmentIndex) => segment.value > 0 && <button type="button" key={segment.label} class={segment.tone ?? "accent"} style={{ width: `${(segment.value / total) * 100}%` }} onMouseEnter={() => setActive({ row: rowIndex, segment: segmentIndex })} onFocus={() => setActive({ row: rowIndex, segment: segmentIndex })} onClick={() => setActive({ row: rowIndex, segment: segmentIndex })} aria-label={`${row.label}, ${segment.label}: ${segment.value}`} />)}</div><div class="stack-counts">{row.segments.filter((segment) => segment.value > 0).map((segment) => <span key={segment.label} class={segment.tone ?? "accent"}><strong>{segment.value.toLocaleString()}</strong><small>{segment.label}</small></span>)}</div></div>;
    })}</div>
    <div class="inline-legend">{legend.map((segment) => <span key={segment.label}><i class={segment.tone ?? "accent"} />{segment.label}</span>)}</div>
  </ChartFrame>;
}

function callbackStatus(row: CallbackHealthRow) {
  const success = row.success_count ?? 0;
  const error = row.error_count ?? 0;
  const unknown = row.unknown_count ?? 0;
  const unclassified = Math.max(0, row.task_count - success - error - unknown);
  return {
    success,
    error,
    unknown,
    unclassified,
    segments: [
      { label: "Success", value: success, tone: "success" as const },
      { label: "Error", value: error, tone: "error" as const },
      { label: "Unknown", value: unknown, tone: "unknown" as const },
      { label: "Unclassified", value: unclassified, tone: "unknown" as const },
    ],
  };
}

type RangeDatum = { label: string; min: number; median: number; p95: number; max: number };

export function RangePlot({ title, question, data }: { title: string; question: string; data: RangeDatum[] }) {
  const [active, setActive] = useState(0);
  const visible = data.filter((datum) => [datum.min, datum.median, datum.p95, datum.max].every(Number.isFinite)).sort((a, b) => b.p95 - a.p95).slice(0, 8);
  const identity = visible.map((datum) => datum.label).join("|");
  useEffect(() => setActive(0), [identity]);
  if (!visible.length) return null;
  const maximum = Math.max(1, ...visible.flatMap((datum) => [datum.min, datum.median, datum.p95, datum.max]));
  const selected = visible[active] ?? visible[0];
  return <ChartFrame title={title} detail="minimum · median · P95 · maximum" question={question}>
    <div class="chart-readout" aria-live="polite"><span>{selected.label}</span><strong>{duration(selected.median)} median · {duration(selected.p95)} P95</strong></div>
    <div class="range-plot"><div class="plot-scale"><span>0s</span><span>{duration(maximum)}</span></div>{visible.map((datum, index) => <button type="button" class={`range-row${index === active ? " active" : ""}`} key={datum.label} onMouseEnter={() => setActive(index)} onFocus={() => setActive(index)} onClick={() => setActive(index)} aria-label={`${datum.label}: minimum ${duration(datum.min)}, median ${duration(datum.median)}, P95 ${duration(datum.p95)}, maximum ${duration(datum.max)}`}><span title={datum.label}>{datum.label}</span><i class="range-track" aria-hidden="true"><b style={{ left: `${(datum.min / maximum) * 100}%`, width: `${((datum.max - datum.min) / maximum) * 100}%` }} /><em class="median" style={{ left: `${(datum.median / maximum) * 100}%` }} /><em class="p95" style={{ left: `${(datum.p95 / maximum) * 100}%` }} /></i><strong>{duration(datum.p95)}</strong></button>)}</div>
  </ChartFrame>;
}

function Table({
  label,
  headers,
  rows,
  searching,
  initialSortColumn = 0,
  initialSortDirection = "ascending",
}: {
  label: string;
  headers: string[];
  rows: Array<{ key: string; values: ComponentChildren[]; sortValues?: unknown[] }>;
  searching: boolean;
  initialSortColumn?: number;
  initialSortDirection?: SortDirection;
}) {
  const [direction, setDirection] = useState<SortDirection>(initialSortDirection);
  const [sortColumn, setSortColumn] = useState(initialSortColumn);
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
  </table>{ordered.length === 0 && <p class="empty">{searching ? "No rows match the active filter." : "No analyzer rows were reported."}</p>}</div>;
}

function KeyValueTable({ label, rows }: { label: string; rows: Array<{ label: string; value: ComponentChildren }> }) {
  return <table class="quality-table" aria-label={label}><tbody>{rows.map((row) => <tr key={row.label}><th scope="row">{row.label}</th><td>{row.value}</td></tr>)}</tbody></table>;
}

function DataQuality({ entry }: { entry: DataQualityEntry }) {
  const limitations = [...(entry.retention_limitations ?? []), ...(entry.source_limitations ?? []), ...(entry.processing_errors ?? []), ...(entry.analyzer_confidence_warnings ?? [])];
  const unknownStatus = entry.unknown_status_percent === null || entry.unknown_status_percent === undefined ? "—" : `${entry.unknown_status_percent.toFixed(1)}%`;
  const metrics = [
    { label: "Events parsed", value: entry.events_parsed }, { label: "Unknown status", value: unknownStatus },
    { label: "Skipped", value: entry.skipped_entries ?? 0 }, { label: "Malformed", value: entry.malformed_records ?? 0 },
    { label: "Invalid timestamps", value: entry.invalid_timestamps ?? 0 }, { label: "Fallback task IDs", value: entry.fallback_task_ids ?? 0 },
    ...Object.entries(entry.status_distribution ?? {}).map(([name, value]) => ({ label: `${name} results`, value: value ?? 0 })),
  ];
  return <article class="quality-card"><h3>{entry.source}</h3><KeyValueTable label={`${entry.source} data quality`} rows={metrics} />
  {Object.keys(entry.invalid_record_counts ?? {}).length > 0 && <Detail label="Invalid record counts"><KeyValueTable label="Invalid record counts" rows={Object.entries(entry.invalid_record_counts ?? {}).map(([name, value]) => ({ label: name, value }))} /></Detail>}
  {Object.keys(entry.suppression_reasons ?? {}).length > 0 && <Detail label="Suppressed analyses"><ul>{Object.entries(entry.suppression_reasons ?? {}).map(([name, reason]) => <li key={name}><strong>{name}:</strong> {reason}</li>)}</ul></Detail>}
  {limitations.length > 0 && <ul>{limitations.map((value) => <li key={value}>{value}</li>)}</ul>}</article>;
}

function SummaryChart({ section }: { section: Extract<ReportSection, { kind: "summary-visualization" }> }) {
  const status = section.status_distribution ?? {};
  const statusTotal = Object.values(status).reduce<number>((sum, value) => sum + (value ?? 0), 0);
  const timeline = (section.timeline ?? []).map((bucket) => ({ label: bucket.starts_at, value: bucket.count }));
  const statusData: ChartSegment[] = [
    { label: "Success", value: status.success ?? 0, tone: "success" },
    { label: "Error", value: status.error ?? 0, tone: "error" },
    { label: "Unknown", value: status.unknown ?? 0, tone: "unknown" },
    { label: "Other", value: status.other ?? 0, tone: "accent" },
  ];
  return <div class="summary-chart summary-viz-grid">
    {statusTotal ? <DonutChart title="Command Status Distribution" question="How are recorded command results distributed by status?" data={statusData} /> : <Empty>No result events to chart.</Empty>}
    {timeline.length > 1 ? <TimelineChart title="Command Volume Timeline" question="When was task activity concentrated?" data={timeline} /> : timeline.length === 1 ? <SingleBucketActivity bucket={timeline[0]} spanSeconds={section.span_seconds} /> : <Empty>No task timestamps available for timeline.</Empty>}
  </div>;
}

export function SectionPanel({ section, query }: { section: ReportSection; query: string }) {
  const [open, setOpen] = useState(section.kind === "summary-visualization" || section.kind === "data-quality");
  const forcedOpen = Boolean(query && matches(section, query));
  const expanded = open || forcedOpen;
  const isAvailable = section.status === "available";
  const warningMessages = section.warnings?.map((warning) => warning.message) ?? [];
  return <details class={`report-section ${section.status}`} open={expanded} onToggle={(event) => {
    if (!forcedOpen) setOpen((event.currentTarget as HTMLDetailsElement).open);
  }}>
    <summary class="section-toggle">
      <span><span id={`heading-${section.id}`} role="heading" aria-level={2}>{section.title}</span>{section.confidence && <small class={`confidence ${section.confidence}`}>{section.confidence} confidence</small>}</span>
      <span class={`section-state ${isAvailable ? "available" : `exception ${section.status}`}`} aria-label={isAvailable ? (expanded ? "Collapse section" : "Expand section") : `${section.status}: ${section.status_reason ?? "analyzer data is unavailable"}`}>
        {!isAvailable && <i aria-hidden="true" />}{expanded ? "−" : "+"}
      </span>
    </summary>
    <div class="section-content">
      {section.status !== "available" ? <p class="empty">{section.status_reason}</p> : <SectionBody section={section} query={query} />}
      {warningMessages.map((warning) => <p class="section-warning" key={warning}>{warning}</p>)}
    </div>
  </details>;
}

function SectionBody({ section, query }: { section: ReportSection; query: string }): ComponentChildren {
  switch (section.kind) {
    case "summary-visualization": return <SummaryChart section={section} />;
    case "command-failure-summary": {
      const commands = (section.commands ?? []).filter((row) => matches(row, query));
      return <><StackedChart title="Failure rate by command" question="Which commands failed, and how much of their observed execution volume did they affect?" rows={commands.map((row) => ({ label: row.command_name, segments: [{ label: "Success", value: row.success_count, tone: "success" }, { label: "Error", value: row.error_count, tone: "error" }, { label: "Unknown", value: row.unknown_count ?? 0, tone: "unknown" }] }))} /><Table searching={Boolean(query)} label={section.title} headers={["Command", "Runs", "Success", "Errors", "Unknown", "Failure rate", "Callbacks"]} initialSortColumn={5} initialSortDirection="descending" rows={commands.map((row) => ({ key: row.command_name, values: [row.command_name, row.execution_count, row.success_count, row.error_count, row.unknown_count ?? 0, percent(row.failure_rate), row.affected_callbacks ?? 0], sortValues: [row.command_name, row.execution_count, row.success_count, row.error_count, row.unknown_count ?? 0, row.failure_rate, row.affected_callbacks ?? 0] }))} />
        <div class="detail-list">{commands.filter((row) => row.failures?.length).map((row) => <Detail key={row.command_name} label={`${row.command_name}: ${row.failures?.length} failure detail(s)`}><ul class="event-list">{row.failures?.map((failure, index) => <li key={`${failure.task.task_id}-${index}`}><Task task={failure.task} /><span>{failure.dispatch_failed ? "Dispatch failed" : failure.status ?? "Error"}</span>{failure.output_preview?.text && <pre>{failure.output_preview.text}</pre>}{failure.output_preview?.binary && <small>Binary output withheld.</small>}</li>)}</ul></Detail>)}</div></>;
    }
    case "command-duration": {
      const commands = (section.commands ?? []).filter((row) => matches(row, query));
      return <><RangePlot title="Command duration distribution" question="Which commands are consistently slow, and which have a long tail?" data={commands.map((row) => ({ label: row.command_name, min: row.min_seconds ?? 0, median: row.median_seconds ?? 0, p95: row.p95_seconds ?? 0, max: row.max_seconds ?? 0 }))} /><Table searching={Boolean(query)} label={section.title} headers={["Command", "Runs", "Min", "Mean", "Median", "P95", "Max", "Outliers"]} rows={commands.map((row) => ({ key: row.command_name, values: [row.command_name, row.execution_count, duration(row.min_seconds), duration(row.mean_seconds), duration(row.median_seconds), duration(row.p95_seconds), duration(row.max_seconds), row.outlier_count ?? 0], sortValues: [row.command_name, row.execution_count, row.min_seconds, row.mean_seconds, row.median_seconds, row.p95_seconds, row.max_seconds, row.outlier_count ?? 0] }))} />
        <div class="detail-list">{commands.filter((row) => row.slowest_task || row.outlier_tasks?.length).map((row) => <Detail key={row.command_name} label={`${row.command_name} task context`}>
          {row.slowest_task && <p><strong>Slowest:</strong> <Task task={row.slowest_task} /></p>}<TaskList tasks={row.outlier_tasks} empty="No outlier tasks." />
        </Detail>)}</div></>;
    }
    case "command-retry-success": {
      const sequences = (section.sequences ?? []).filter((row) => matches(row, query));
      return <><DotPlot title="Retry attempts by command" question="Which command sequences required the most attempts, and did they recover?" data={sequences.map((row) => ({ label: `${row.command_name} · ${row.succeeded ? "recovered" : "unresolved"}`, value: row.attempts, displayValue: `${row.attempts} attempt${row.attempts === 1 ? "" : "s"}` }))} /><Table searching={Boolean(query)} label={section.title} headers={["Command", "Attempts", "Outcome", "Final status", "Duration"]} rows={sequences.map((row, index) => ({ key: `${row.command_name}-${index}`, values: [row.command_name, row.attempts, row.succeeded ? "Recovered" : "Unresolved", text(row.final_status), duration(row.duration_seconds)], sortValues: [row.command_name, row.attempts, row.succeeded ? 1 : 0, row.final_status, row.duration_seconds] }))} />
        <div class="detail-list">{sequences.filter((row) => row.tasks?.length || row.transitions?.length || row.intervening_tasks?.length).map((row, index) => <Detail key={`${row.command_name}-${index}`} label={`${row.command_name}: attempt context`}>{row.tasks?.length ? <><h3>Attempts</h3><TaskList tasks={row.tasks} empty="No attempt task references." /></> : null}{row.transitions?.length ? <><h3>Argument changes</h3><ul>{row.transitions.map((transition) => <li key={`${transition.from_attempt}-${transition.to_attempt}`}>Attempt {transition.from_attempt} → {transition.to_attempt}: {(transition.changes ?? []).join(", ") || transition.note || "No recorded change"}</li>)}</ul></> : null}{row.intervening_tasks?.length ? <><h3>Intervening tasks</h3><TaskList tasks={row.intervening_tasks} empty="No intervening tasks." /></> : null}</Detail>)}</div></>;
    }
    case "friction-score": {
      const candidates = (section.candidates ?? []).filter((row) => matches(row, query));
      if (!candidates.length) return <Empty>No friction candidates match the active filter.</Empty>;
      return <><DotPlot title="Friction score by command" question="Which commands impose the most operator friction and deserve investigation first?" data={candidates.map((row) => ({ label: `${row.command_name} · ${row.sample_size} samples`, value: row.score, displayValue: row.score.toFixed(1) }))} /><div class="card-grid">{candidates.map((row) => <article class="finding-card" key={row.command_name} data-search-match={query ? "true" : undefined} tabIndex={query ? -1 : undefined}><h3>{row.command_name}</h3><strong>{row.score.toFixed(1)}</strong><p>{row.recommended_action}</p><small>{row.sample_size} samples · {row.confidence} confidence{row.suppressed ? " · action suppressed" : ""}</small><Detail label="Score evidence"><dl>{Object.entries(row.components ?? {}).map(([name, value]) => <><dt key={`${name}-label`}>{name}</dt><dd key={name}>{text(value)}</dd></>)}</dl>{row.drivers?.length ? <ul>{row.drivers.map((driver) => <li key={driver.component}><strong>{driver.label}:</strong> {text(driver.value)} ({text(driver.impact)} impact)</li>)}</ul> : <Empty>No score drivers.</Empty>}{[...(row.confidence_reasons ?? []), ...(row.limitations ?? [])].map((reason) => <p key={reason}>{reason}</p>)}</Detail></article>)}</div></>;
    }
    case "callback-health": {
      const callbacks = (section.callbacks ?? []).filter((row) => matches(row, query));
      return <><Table searching={Boolean(query)} label={section.title} headers={["Callback", "Tasks", "Success", "Errors", "Unknown", "Unclassified", "Completion", "Consecutive failures"]} initialSortColumn={6} initialSortDirection="ascending" rows={callbacks.map((row) => { const status = callbackStatus(row); return { key: row.callback_id, values: [row.link ? <SafeAnchor link={row.link} /> : row.callback_id, row.task_count, status.success, status.error, status.unknown, status.unclassified, percent(row.completion_rate), row.consecutive_failure_count ?? 0], sortValues: [row.callback_display_id ?? row.callback_id, row.task_count, status.success, status.error, status.unknown, status.unclassified, row.completion_rate ?? -1, row.consecutive_failure_count ?? 0] }; })} />
        <div class="detail-list">{callbacks.filter((row) => row.trailing_failures?.length || row.last_successful_task).map((row) => <Detail key={row.callback_id} label={`Callback ${row.callback_display_id ?? row.callback_id} context`}><p>{row.first_task_at ? new Date(row.first_task_at).toLocaleString() : "Unknown start"} → {row.last_task_at ? new Date(row.last_task_at).toLocaleString() : "unknown end"}</p>{row.last_successful_task && <p><strong>Last success:</strong> <Task task={row.last_successful_task} /></p>}<TaskList tasks={row.trailing_failures} empty="No trailing failures." /></Detail>)}</div></>;
    }
    case "av-tracker": {
      const detections = (section.detections ?? []).filter((row) => matches(row, query));
      return <><p class="section-summary">Scanned {section.scanned_task_count ?? 0} process-list task(s); found {section.detections?.length ?? 0} detection row(s).</p><DotPlot title="Detections by vendor" question="Which security products were observed most often in retained process-list results?" data={detections.map((row) => ({ label: `${row.vendor} · ${(row.matched_executables ?? []).join(", ")}`, value: row.occurrence_count }))} /><Table searching={Boolean(query)} label={section.title} headers={["Vendor", "Executables", "Occurrences", "Status", "Task"]} rows={detections.map((row, index) => ({ key: `${row.vendor}-${index}`, values: [row.vendor, (row.matched_executables ?? []).join(", "), row.occurrence_count, text(row.status), <Task task={row.task} />], sortValues: [row.vendor, (row.matched_executables ?? []).join(", "), row.occurrence_count, row.status, row.task.display_id ?? row.task.task_id] }))} /></>;
    }
    case "dwell-time": {
      const measurements = (section.measurements ?? []).filter((row) => matches(row, query));
      return <><dl class="inline-metrics"><dt>Measured intervals</dt><dd>{section.measurement_count ?? measurements.length}</dd><dt>Median</dt><dd>{duration(section.median_seconds)}</dd><dt>P95</dt><dd>{duration(section.p95_seconds)}</dd><dt>Maximum</dt><dd>{duration(section.max_seconds)}</dd></dl><DwellDistribution data={section.distribution ?? []} /><Table searching={Boolean(query)} label="Dwell intervals" headers={["Earlier task", "Next task", "Pause"]} rows={measurements.map((row, index) => ({ key: String(index), values: [<Task task={row.from_task} />, <Task task={row.to_task} />, <strong class="dwell-value">{duration(row.dwell_seconds)}</strong>], sortValues: [row.from_task.display_id ?? row.from_task.task_id, row.to_task.display_id ?? row.to_task.task_id, row.dwell_seconds] }))} /></>;
    }
    case "parameter-entropy": {
      const findings = (section.findings ?? []).filter((row) => matches(row, query));
      const repeated = (section.repeated_tokens ?? []).filter((row) => matches(row, query));
      const entropyFindings = findings.filter((row) => row.token_entropy !== null && row.token_entropy !== undefined).map((row) => ({ label: `${row.task.command_name ?? "Task"} #${row.task.display_id ?? row.task.task_id}`, value: row.token_entropy ?? 0, findingType: row.finding_type, token: row.token }));
      return <><EntropyPlot findings={entropyFindings} /><Table searching={Boolean(query)} label={section.title} headers={["Task", "Finding", "Token", "Entropy", "Detail"]} initialSortColumn={3} initialSortDirection="descending" rows={findings.map((row, index) => ({ key: String(index), values: [<Task task={row.task} />, row.finding_type, row.token ? <code class="entropy-token">{row.token}</code> : "—", text(row.token_entropy), row.detail], sortValues: [row.task.display_id ?? row.task.task_id, row.finding_type, row.token, row.token_entropy ?? -1, row.detail] }))} />{repeated.length > 0 && <Detail label={`${section.repeated_token_count ?? repeated.length} repeated high-entropy token(s)`}><Table searching={Boolean(query)} label="Repeated high-entropy tokens" headers={["Prefix", "Mean entropy", "Occurrences", "Commands", "Detail"]} rows={repeated.map((row) => ({ key: row.token_prefix, values: [row.token_prefix, text(row.entropy_mean), row.occurrences, (row.commands ?? []).join(", "), row.detail], sortValues: [row.token_prefix, row.entropy_mean, row.occurrences, (row.commands ?? []).join(", "), row.detail] }))} /></Detail>}</>;
    }
    case "argument-position-profile": {
      const findings = (section.findings ?? []).filter((row) => matches(row, query));
      const depth = section.depth_distribution ?? [];
      const profiles = section.command_profiles ?? [];
      return <><p class="section-summary">Profiled {section.commands_profiled ?? 0} command(s), maximum argument depth {section.max_depth ?? 0}.</p><DotPlot title="Finding ratio by command and position" question="Which command positions show the strongest repeated argument pattern?" formatValue={(value) => percent(value)} data={findings.map((row) => ({ label: `${row.command_name} · position ${row.position ?? "—"} · ${row.finding_type}`, value: row.ratio ?? 0, displayValue: percent(row.ratio) }))} /><Table searching={Boolean(query)} label={section.title} headers={["Command", "Position", "Finding", "Occurrences", "Sample", "Ratio", "Detail"]} rows={findings.map((row, index) => ({ key: `${row.command_name}-${index}`, values: [row.command_name, text(row.position), row.finding_type, row.occurrences ?? 0, row.sample_size ?? 0, percent(row.ratio), row.detail], sortValues: [row.command_name, row.position, row.finding_type, row.occurrences ?? 0, row.sample_size ?? 0, row.ratio, row.detail] }))} />{depth.length > 0 && <Detail label="Depth distribution"><DotPlot title="Mean argument depth by command" question="Which commands carry the deepest retained argument structures?" data={depth.map((row) => ({ label: `${row.command_name} · ${row.min_depth ?? 0}–${row.max_depth ?? 0} range`, value: row.mean_depth ?? 0 }))} /><Table searching={false} label="Argument depth distribution" headers={["Command", "Tasks", "Minimum", "Maximum", "Mean"]} rows={depth.map((row) => ({ key: row.command_name, values: [row.command_name, row.task_count ?? 0, row.min_depth ?? 0, row.max_depth ?? 0, text(row.mean_depth)], sortValues: [row.command_name, row.task_count, row.min_depth, row.max_depth, row.mean_depth] }))} /></Detail>}{profiles.length > 0 && <Detail label="Per-command profiles"><Table searching={false} label="Per-command argument profiles" headers={["Command", "Tasks", "Positions"]} rows={profiles.map((row) => ({ key: row.command_name, values: [row.command_name, row.task_count ?? 0, row.positions ?? 0] }))} /></Detail>}</>;
    }
    case "tool-dump": {
      const groups = (section.groups ?? []).filter((row) => matches(row, query));
      if (!groups.length) return <Empty>No tool-dump groups match the active filter.</Empty>;
      const totalMatches = groups.reduce((sum, group) => sum + group.match_count, 0);
      const entries = groups.flatMap((group) => (group.entries ?? []).map((task, index) => ({ group, task, index }))).filter((row) => matches(row, query));
      const artifacts = groups.filter((group) => group.artifact_path);
      if (!entries.length && totalMatches > 0) return <p class="section-warning">{totalMatches} tool match{totalMatches === 1 ? " was" : "es were"} reported, but the matching invocation details were not retained in this report.</p>;
      if (!entries.length) return <Empty>No tool invocations were matched.</Empty>;
      return <>{entries.length < totalMatches && <p class="section-warning">Showing {entries.length} retained invocation{entries.length === 1 ? "" : "s"} from {totalMatches} reported matches.</p>}<Table searching={Boolean(query)} label={section.title} headers={["Invocation", "Group", "Task", "Observed"]} rows={entries.map(({ group, task, index }) => ({ key: `${group.id}-${task.task_id}-${index}`, values: [<ToolInvocation task={task} />, <ToolGroup group={group} />, task.link ? <SafeAnchor link={task.link} /> : `Task ${task.display_id ?? task.task_id}`, task.timestamp ? new Date(task.timestamp).toLocaleString() : "—"], sortValues: [`${task.command_name ?? ""} ${task.argument_preview?.text ?? ""}`, group.name, task.display_id ?? task.task_id, task.timestamp] }))} />{artifacts.length > 0 && <p class="artifact-note"><strong>Exports:</strong> {artifacts.map((group) => `${group.name} — ${group.artifact_path}`).join(" · ")}</p>}</>;
    }
    case "data-quality": {
      const entries = (section.entries ?? []).filter((row) => matches(row, query));
      return <><StackedChart title="Result fidelity by source" question="How much trustworthy result-state coverage does each source provide?" rows={entries.map((entry) => ({ label: entry.source, segments: [{ label: "Success", value: entry.status_distribution?.success ?? 0, tone: "success" }, { label: "Error", value: entry.status_distribution?.error ?? 0, tone: "error" }, { label: "Unknown", value: (entry.status_distribution?.unknown ?? 0) + (entry.status_distribution?.other ?? 0), tone: "unknown" }] }))} /><div class="quality-grid">{entries.map((entry) => <div key={entry.source} data-search-match={query ? "true" : undefined} tabIndex={query ? -1 : undefined}><DataQuality entry={entry} /></div>)}</div></>;
    }
    case "run-diff": {
      const findings = (section.findings ?? []).filter((row) => matches(row, query));
      const summary = section.summary;
      const entities = [...(section.new_entities ?? []).map((row) => ({ key: `new-${row.entity_type}-${row.entity_id}`, values: ["New", row.entity_type, row.entity_id, row.count ?? 0] })), ...(section.removed_entities ?? []).map((row) => ({ key: `removed-${row.entity_type}-${row.entity_id}`, values: ["Removed", row.entity_type, row.entity_id, row.count ?? 0] }))];
      return <><p class={`comparability ${section.comparability_status}`}>Comparability: {section.comparability_status}</p>{summary && <><dl class="inline-metrics"><dt>Regressions</dt><dd>{summary.likely_regressions ?? 0}</dd><dt>Improvements</dt><dd>{summary.likely_improvements ?? 0}</dd><dt>Low confidence</dt><dd>{summary.low_confidence_changes ?? 0}</dd><dt>Not comparable</dt><dd>{summary.not_comparable ?? 0}</dd></dl><DonutChart title="Comparison outcomes" question="How are comparable findings distributed across regression, improvement, and uncertainty?" data={[{ label: "Regressions", value: summary.likely_regressions ?? 0, tone: "error" }, { label: "Improvements", value: summary.likely_improvements ?? 0, tone: "success" }, { label: "Low confidence", value: summary.low_confidence_changes ?? 0, tone: "unknown" }, { label: "Not comparable", value: summary.not_comparable ?? 0, tone: "accent" }]} /></>}<DotPlot title="Metric change magnitude" question="Which comparable metrics changed the most between runs?" data={findings.filter((row) => row.delta !== null && row.delta !== undefined).map((row) => ({ label: `${row.metric_id} · ${row.entity_id}`, value: row.delta ?? 0, displayValue: `${(row.delta ?? 0) > 0 ? "+" : ""}${text(row.delta)}` }))} /><Table searching={Boolean(query)} label={section.title} headers={["Metric", "Entity", "Classification", "Confidence", "Baseline", "Candidate", "Delta", "Explanation"]} rows={findings.map((row) => ({ key: `${row.metric_id}-${row.entity_id}`, values: [row.metric_id, row.entity_id, row.classification, row.confidence, text(row.baseline_value), text(row.candidate_value), text(row.delta), row.explanation], sortValues: [row.metric_id, row.entity_id, row.classification, row.confidence, row.baseline_value, row.candidate_value, row.delta, row.explanation] }))} />{entities.length > 0 && <Detail label="Entity presence changes"><Table searching={false} label="New and removed entities" headers={["Change", "Type", "Entity", "Count"]} rows={entities} /></Detail>}</>;
    }
    case "outlier-context": {
      const outliers = (section.outliers ?? []).filter((row) => matches(row, query));
      return <OutlierExplorer outliers={outliers} />;
    }
    case "unknown": return <p class="empty">{section.fallback_message}</p>;
  }
  return assertNever(section);
}
