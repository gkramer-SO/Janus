// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./main";
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
  sections: [{ id: "failures", title: "Command failures", kind: "command-failure-summary", status: "available", commands: [{ command_name: "whoami", execution_count: 1, success_count: 0, error_count: 1 }] }],
} as ReportModel;

const listing = { run_id: "run:1", operation_name: "Operation one", analysis_completed_at: "2026-08-24T12:00:00Z", live: false };

class EventSourceStub {
  static instances: EventSourceStub[] = [];
  onerror: ((event: Event) => void) | null = null;
  constructor(public url: string | URL) { EventSourceStub.instances.push(this); }
  addEventListener() {}
  close() {}
}

beforeEach(() => {
  window.history.replaceState({}, "", "/");
  EventSourceStub.instances = [];
  vi.stubGlobal("EventSource", EventSourceStub);
  HTMLElement.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mockBoot(live: boolean) {
  vi.spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(new Response(JSON.stringify({ runs: [{ ...listing, live }] }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify(model), { status: 200 }));
}

describe("dashboard application", () => {
  it("does not open an event stream for an ordinary served report", async () => {
    mockBoot(false);
    render(<App />);

    await screen.findByText("Operation one");

    expect(EventSourceStub.instances).toHaveLength(0);
    expect(screen.queryByText("degraded")).toBeNull();
  });

  it("opens an event stream only for a live run", async () => {
    mockBoot(true);
    render(<App />);

    await screen.findByText("Operation one");
    await waitFor(() => expect(EventSourceStub.instances).toHaveLength(1));
    expect(String(EventSourceStub.instances[0].url)).toContain("run%3A1/stream");
  });

  it("supports slash focus and Enter navigation through search matches", async () => {
    mockBoot(false);
    render(<App />);
    await screen.findByText("Operation one");

    fireEvent.keyDown(document, { key: "/" });
    const search = screen.getByRole("textbox", { name: /search analysis/i });
    expect(document.activeElement).toBe(search);
    fireEvent.input(search, { target: { value: "whoami" } });
    fireEvent.keyDown(search, { key: "Enter" });

    expect((document.activeElement as HTMLElement).getAttribute("data-search-match")).toBe("true");
  });

  it("selects only run identifiers advertised by the server and pins the route", async () => {
    const secondListing = { ...listing, run_id: "run:2", operation_name: "Operation two" };
    const secondModel = { ...model, run_id: "run:2", run: { ...model.run, operation_name: "Operation two" } };
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ runs: [listing, secondListing] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(model), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ runs: [listing, secondListing] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(secondModel), { status: 200 }));
    render(<App />);
    await screen.findByText("Operation one");

    fireEvent.change(screen.getByRole("combobox", { name: "Run" }), { target: { value: "run:2" } });

    await screen.findByText("Operation two");
    expect(window.location.pathname).toBe("/runs/run%3A2");
  });
});
