import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { ReportModel } from "./generated/report-model";
import { loadReportModel } from "./boot";
import { SectionPanel } from "./report";
import "./styles.css";

type BootState =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; mode: "static" | "served"; model: ReportModel };

type ConnectionState = "offline" | "connecting" | "connected" | "degraded";

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div class="metric"><span>{label}</span><strong>{value}</strong></div>;
}

function App() {
  const [boot, setBoot] = useState<BootState>({ state: "loading" });
  const [connection, setConnection] = useState<ConnectionState>("offline");
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  useEffect(() => {
    let stream: EventSource | undefined;
    let closed = false;
    loadReportModel().then((ready) => {
      if (closed) return;
      setBoot(ready);
      setLastUpdated(new Date().toISOString());
      if (ready.mode !== "served") return;
      setConnection("connecting");
      stream = new EventSource(`/api/v1/runs/${encodeURIComponent(ready.model.run_id)}/stream`);
      stream.addEventListener("connected", () => setConnection("connected"));
      stream.addEventListener("run.degraded", () => setConnection("degraded"));
      stream.addEventListener("report.updated", () => {
        loadReportModel().then((replacement) => {
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
    }).catch((error: unknown) => setBoot({ state: "error", message: error instanceof Error ? error.message : "Dashboard startup failed." }));
    return () => {
      closed = true;
      stream?.close();
    };
  }, []);
  if (boot.state === "loading") return <main><p class="state">Loading Janus report…</p></main>;
  if (boot.state === "error") return <main><h1>Janus</h1><p class="error">{boot.message}</p></main>;
  const { model, mode } = boot;
  const status = model.summary.status_distribution ?? {};
  return <main>
    <header>
      <div><p class="eyebrow">Janus local dashboard</p><h1>{model.run.operation_name}</h1></div>
      <div class="mode-stack">
        <span class={`mode ${mode}`}>{mode === "static" ? "Static snapshot" : "Served locally"}</span>
        {mode === "served" && <span class={`connection ${connection}`}>{connection}</span>}
      </div>
    </header>
    <section class="metrics" aria-label="Run summary">
      <Metric label="Tasks" value={model.summary.task_count} />
      <Metric label="Results" value={model.summary.result_count} />
      <Metric label="Success" value={status.success ?? 0} />
      <Metric label="Errors" value={status.error ?? 0} />
      <Metric label="Unknown" value={status.unknown ?? 0} />
    </section>
    {lastUpdated && <p class="last-updated">Dashboard refreshed {new Date(lastUpdated).toLocaleTimeString()}</p>}
    {(model.warnings?.length ?? 0) > 0 && <section class="warnings"><h2>Warnings</h2>{model.warnings?.map((warning) => <p key={`${warning.code}:${warning.section_id ?? "run"}`}>{warning.message}</p>)}</section>}
    <label class="report-search">Search analysis
      <input value={query} onInput={(event) => setQuery((event.target as HTMLInputElement).value)} placeholder="Command, callback, finding…" />
    </label>
    <section class="sections" aria-label="Analysis sections">
      {model.sections?.map((section) => <SectionPanel key={section.id} section={section} query={query} />)}
    </section>
    <footer>Run {model.run_id} · revision {model.revision} · Janus {model.janus_version}</footer>
  </main>;
}

const root = document.getElementById("app");
if (!root) throw new Error("Dashboard root element is missing.");
render(<App />, root);
