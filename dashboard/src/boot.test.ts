// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import { loadReportModel } from "./boot";
import type { ReportModel } from "./generated/report-model";

const model = { run_id: "run:1", revision: 1 } as ReportModel;

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
    expect(result.model.run_id).toBe("run:1");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("discovers the newest run and fetches its report in served mode", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ runs: [{ run_id: "run:1" }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(model), { status: 200 }));

    const result = await loadReportModel();

    expect(result.mode).toBe("served");
    expect(fetchSpy).toHaveBeenNthCalledWith(2, "/api/v1/runs/run%3A1/report", expect.any(Object));
  });
});