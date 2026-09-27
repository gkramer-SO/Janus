import { useEffect, useRef, useState } from "preact/hooks";
import { loadReportModel, type ReadyBootState } from "./boot";
import { SectionPanel } from "./report";

type BootState =
  | { state: "loading" }
  | { state: "error"; message: string }
  | ReadyBootState;

type ConnectionState = "offline" | "connecting" | "connected" | "degraded";

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div class="metric"><span>{label}</span><strong>{value}</strong></div>;
}

export function App() {
  const [boot, setBoot] = useState<BootState>({ state: "loading" });
  const [connection, setConnection] = useState<ConnectionState>("offline");
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let closed = false;
    loadReportModel().then((ready) => {
      if (closed) return;
      setBoot(ready);
      setLastUpdated(new Date().toISOString());
    }).catch((error: unknown) => setBoot({ state: "error", message: error instanceof Error ? error.message : "Dashboard startup failed." }));
    return () => { closed = true; };
  }, []);
  const activeRunId = boot.state === "ready" ? boot.model.run_id : null;
  const liveEnabled = boot.state === "ready" && boot.mode === "served" && boot.live;
  useEffect(() => {
    if (!activeRunId || !liveEnabled) {
      setConnection("offline");
      return;
    }
    let closed = false;
    let stream: EventSource | undefined;
    setConnection("connecting");
    stream = new EventSource(`/api/v1/runs/${encodeURIComponent(activeRunId)}/stream`);
    stream.addEventListener("connected", () => setConnection("connected"));
    stream.addEventListener("run.degraded", () => setConnection("degraded"));
    stream.addEventListener("report.updated", () => {
      loadReportModel(activeRunId).then((replacement) => {
        if (!closed) {
          setBoot(replacement);
          setLastUpdated(new Date().toISOString());
          setConnection("connected");
        }
      }).catch(() => {
        if (!closed) setConnection("degraded");
      });
    });
    stream.addEventListener("run.stopped", () => {
      stream?.close();
      if (!closed) setConnection("offline");
    });
    stream.onerror = () => {
      if (!closed) setConnection("degraded");
    };
    return () => {
      closed = true;
      stream?.close();
    };
  }, [activeRunId, liveEnabled]);
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const editing = target?.matches("input, textarea, select, [contenteditable='true']") ?? false;
      if (event.key === "/" && !editing) {
        event.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (event.key === "Escape" && target === searchRef.current) {
        setQuery("");
        return;
      }
      if (event.key !== "Enter" || !query || (target !== searchRef.current && !target?.matches("[data-search-match='true']"))) return;
      const matches = [...document.querySelectorAll<HTMLElement>("[data-search-match='true']")];
      if (matches.length === 0) return;
      event.preventDefault();
      const current = matches.indexOf(document.activeElement as HTMLElement);
      const offset = event.shiftKey ? -1 : 1;
      const next = current < 0 ? (event.shiftKey ? matches.length - 1 : 0) : (current + offset + matches.length) % matches.length;
      matches[next].focus();
      matches[next].scrollIntoView({ block: "nearest" });
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [query]);
  async function selectRun(runId: string) {
    try {
      const ready = await loadReportModel(runId);
      window.history.pushState({}, "", `/runs/${encodeURIComponent(runId)}`);
      setBoot(ready);
      setLastUpdated(new Date().toISOString());
    } catch (error) {
      setBoot({ state: "error", message: error instanceof Error ? error.message : "Could not select the Janus run." });
    }
  }
  if (boot.state === "loading") return <main><p class="state">Loading Janus report…</p></main>;
  if (boot.state === "error") return <main><h1>Janus</h1><p class="state">{boot.message}</p></main>;
  const { model, mode } = boot;
  const status = model.summary.status_distribution ?? {};
  return <main>
    <header>
      <div><p class="eyebrow">Janus local dashboard</p><h1>{model.run.operation_name}</h1></div>
      <div class="mode-stack">
        <span class={`mode ${mode}`}>{mode === "static" ? "Static snapshot" : "Served locally"}</span>
        {mode === "served" && boot.live && <span class={`connection ${connection}`}>{connection}</span>}
      </div>
    </header>
    <section class="metrics" aria-label="Run summary">
      <Metric label="Tasks" value={model.summary.task_count} />
      <Metric label="Results" value={model.summary.result_count} />
      <Metric label="Success" value={status.success ?? 0} />
      <Metric label="Errors" value={status.error ?? 0} />
      <Metric label="Unknown" value={status.unknown ?? 0} />
      <Metric label="Operations" value={model.run.operations?.length || model.summary.operation_count || 1} />
      <Metric label="Callbacks" value={model.summary.callback_count ?? "—"} />
      <Metric label="Span" value={model.summary.span_seconds !== null && model.summary.span_seconds !== undefined ? `${(model.summary.span_seconds / 3600).toFixed(1)}h` : "—"} />
    </section>
    <section class="overview" aria-label="Report overview">
      <div class="overview-lines">
        <p>
          <span>Sources</span>
          {model.sources.map((source, index) => <span class="overview-source" key={`${source.kind}-${index}`}>{index > 0 && " · "}<strong>{source.kind}</strong>{source.subtype ? ` · ${source.subtype}` : ""}{source.endpoint_label ? ` · ${source.endpoint_label}` : ""}{source.parser_version ? ` · parser ${source.parser_version}` : ""}</span>)}
        </p>
        <p>
          <span>Retention</span>
          arguments {model.retention.arguments ?? "unknown"} · output {model.retention.output ?? "unknown"}
          {(model.retention.limitations?.length ?? 0) > 0 ? ` · ${model.retention.limitations?.join(" · ")}` : ""}
        </p>
      </div>
      {model.run.operations && model.run.operations.length > 1 && <ul class="overview-operations">{model.run.operations.map((operation) => <li key={operation.operation_id ?? operation.operation_name}>{operation.operation_name}: {operation.task_count ?? 0} tasks, {operation.result_count ?? 0} results</li>)}</ul>}
    </section>
    {mode === "served" && boot.runs.length > 1 && <label class="run-selector">Run
      <select value={model.run_id} onChange={(event) => void selectRun((event.target as HTMLSelectElement).value)}>
        {boot.runs.map((run) => <option key={run.run_id} value={run.run_id}>{run.operation_name} · {new Date(run.analysis_completed_at).toLocaleString()}</option>)}
      </select>
    </label>}
    {lastUpdated && <p class="last-updated">Dashboard refreshed {new Date(lastUpdated).toLocaleTimeString()}</p>}
    {(model.warnings?.length ?? 0) > 0 && <section class="run-notices" aria-label="Run notices">
      <section class="warnings" role="alert" aria-label="Run warnings"><i aria-hidden="true">!</i><div>{model.warnings?.map((warning) => <p key={`${warning.code}:${warning.section_id ?? "run"}`}>{warning.message}</p>)}</div></section>
    </section>}
    {model.diff && <section class="diff-overview"><h2>Comparison</h2><p>{model.diff.baseline_run_id} → {model.diff.candidate_run_id} · {model.diff.comparability_status}</p>{model.diff.warnings?.map((warning) => <p key={warning}>{warning}</p>)}</section>}
    <label class="report-search">Search analysis
      <input ref={searchRef} value={query} onInput={(event) => setQuery((event.target as HTMLInputElement).value)} placeholder="Command, callback, finding…" aria-describedby="search-help" />
      <small id="search-help">Press / to focus; Enter and Shift+Enter move through matches.</small>
    </label>
    <section class="sections" aria-label="Analysis sections">
      {model.sections?.map((section) => <SectionPanel key={section.id} section={section} query={query} />)}
    </section>
    <footer>Run {model.run_id} · revision {model.revision} · Janus {model.janus_version}</footer>
  </main>;
}
