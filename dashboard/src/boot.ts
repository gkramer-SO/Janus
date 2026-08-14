import type { ReportModel } from "./generated/report-model";

export type ReadyBootState = { state: "ready"; mode: "static" | "served"; model: ReportModel };

function selectedRunId(): string | null {
  const match = window.location.pathname.match(/^\/runs\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

export async function loadReportModel(): Promise<ReadyBootState> {
  const embedded = document.getElementById("janus-report-model");
  if (embedded?.textContent) {
    return { state: "ready", mode: "static", model: JSON.parse(embedded.textContent) as ReportModel };
  }
  let runId = selectedRunId();
  if (!runId) {
    const response = await fetch("/api/v1/runs", { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`Could not list Janus runs (${response.status}).`);
    const listing = (await response.json()) as { runs?: Array<{ run_id: string }> };
    runId = listing.runs?.[0]?.run_id ?? null;
  }
  if (!runId) throw new Error("No reportable Janus runs are available.");
  const response = await fetch(`/api/v1/runs/${encodeURIComponent(runId)}/report`, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Could not load the selected Janus report (${response.status}).`);
  return { state: "ready", mode: "served", model: (await response.json()) as ReportModel };
}