// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import { loadReportModel, parseReportModel } from "./boot";
import type { ReportModel } from "./generated/report-model";

const model = {
  report_model_version: "1.1.0",
  run_id: "run:1",
  revision: 1,
  generated_at: "2026-08-24T12:00:00Z",
  janus_version: "1.5.0",
  run: { run_kind: "operation", operation_name: "Operation one", analysis_completed_at: "2026-08-24T12:00:00Z", task_count: 1, result_count: 1, janus_version: "1.5.0", retention: {} },
  sources: [{ kind: "mythic" }],
  retention: {},
  summary: { task_count: 1, result_count: 1 },
} as ReportModel;

const listing = { run_id: "run:1", operation_name: "Operation one", analysis_completed_at: "2026-08-24T12:00:00Z", live: false };

beforeEach(() => {
  document.body.innerHTML = "";
  window.history.replaceState({}, "", "/");
  vi.restoreAllMocks();
});

describe("dashboard boot modes", () => {
  it("loads embedded JSON without making a request", async () => {
    const embedded = document.createElement("script");
    embedded.id = "janus-report-model";
    embedded.type = "application/json";
    embedded.textContent = JSON.stringify(model);
    document.body.append(embedded);
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await loadReportModel();

    expect(result.mode).toBe("static");
    expect(result.live).toBe(false);
    expect(result.model.run_id).toBe("run:1");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("discovers the newest run and fetches its report in served mode", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ runs: [listing] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(model), { status: 200 }));

    const result = await loadReportModel();

    expect(result.mode).toBe("served");
    expect(result.live).toBe(false);
    expect(fetchSpy).toHaveBeenNthCalledWith(2, "/api/v1/runs/run%3A1/report", expect.any(Object));
  });

  it("keeps an explicitly selected live run pinned", async () => {
    const second = { ...listing, run_id: "live:mythic", operation_name: "Live operation", live: true };
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ runs: [listing, second] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...model, run_id: second.run_id }), { status: 200 }));

    const result = await loadReportModel(second.run_id);

    expect(result.live).toBe(true);
    expect(result.model.run_id).toBe(second.run_id);
    expect(fetchSpy).toHaveBeenNthCalledWith(2, "/api/v1/runs/live%3Amythic/report", expect.any(Object));
  });

  it("rejects unsupported and malformed report models", () => {
    expect(() => parseReportModel({ ...model, report_model_version: "2.0.0" })).toThrow(/supports report-model v1/);
    expect(() => parseReportModel({ report_model_version: "1.0.0" })).toThrow(/missing required fields/);
  });
});
