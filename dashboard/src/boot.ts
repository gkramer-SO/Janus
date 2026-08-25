import type { ReportModel } from "./generated/report-model";

const SUPPORTED_REPORT_MODEL_MAJOR = 1;

export interface RunListing {
  run_id: string;
  operation_name: string;
  analysis_completed_at: string;
  live: boolean;
}

export type ReadyBootState = {
  state: "ready";
  mode: "static" | "served";
  model: ReportModel;
  runs: RunListing[];
  live: boolean;
};

function selectedRunId(): string | null {
  const match = window.location.pathname.match(/^\/runs\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

export function parseReportModel(payload: unknown): ReportModel {
  if (!payload || typeof payload !== "object") throw new Error("The Janus report model is not a JSON object.");
  const candidate = payload as Partial<ReportModel>;
  const version = candidate.report_model_version;
  const major = typeof version === "string" ? Number.parseInt(version.split(".")[0], 10) : Number.NaN;
  if (!Number.isInteger(major)) throw new Error("The Janus report model does not declare a valid version.");
  if (major !== SUPPORTED_REPORT_MODEL_MAJOR) {
    throw new Error(`This dashboard supports report-model v${SUPPORTED_REPORT_MODEL_MAJOR}.x, but the report uses v${version}.`);
  }
  if (typeof candidate.run_id !== "string" || !candidate.run || !candidate.summary || !Array.isArray(candidate.sources)) {
    throw new Error("The Janus report model is missing required fields.");
  }
  return candidate as ReportModel;
}

export async function loadReportModel(requestedRunId?: string): Promise<ReadyBootState> {
  const embedded = document.getElementById("janus-report-model");
  if (embedded?.textContent) {
    return { state: "ready", mode: "static", model: parseReportModel(JSON.parse(embedded.textContent)), runs: [], live: false };
  }
  const listingResponse = await fetch("/api/v1/runs", { headers: { Accept: "application/json" } });
  if (!listingResponse.ok) throw new Error(`Could not list Janus runs (${listingResponse.status}).`);
  const listing = (await listingResponse.json()) as { runs?: RunListing[] };
  const runs = listing.runs ?? [];
  const runId = requestedRunId ?? selectedRunId() ?? runs[0]?.run_id ?? null;
  if (!runId) throw new Error("No reportable Janus runs are available.");
  const selected = runs.find((run) => run.run_id === runId);
  if (!selected) throw new Error(`The selected Janus run is not available: ${runId}.`);
  const response = await fetch(`/api/v1/runs/${encodeURIComponent(runId)}/report`, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Could not load the selected Janus report (${response.status}).`);
  return { state: "ready", mode: "served", model: parseReportModel(await response.json()), runs, live: selected.live };
}
