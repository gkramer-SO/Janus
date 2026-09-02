// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/preact";
import { afterEach, describe, expect, it } from "vitest";

import { SectionPanel } from "./report";
import type { ReportModel } from "./generated/report-model";

type ReportSection = NonNullable<ReportModel["sections"]>[number];

afterEach(cleanup);

describe("report sections", () => {
  it("ports the report status donut and time-bucket histogram as interactive charts", () => {
    const section = {
      id: "summary",
      title: "Summary Analysis",
      kind: "summary-visualization",
      status: "available",
      status_distribution: { success: 5, error: 1, unknown: 0, other: 0 },
      timeline: [
        { starts_at: "2026-07-27T15:00:00Z", count: 2 },
        { starts_at: "2026-07-27T16:00:00Z", count: 4 },
      ],
    } as ReportSection;

    render(<SectionPanel section={section} query="" />);
    const statusChart = screen.getByRole("figure", { name: "Command Status Distribution" });
    const timelineChart = screen.getByRole("figure", { name: "Command Volume Timeline" });
    expect(statusChart.querySelectorAll(".donut-segment")).toHaveLength(2);
    expect(timelineChart.querySelectorAll(".timeline-bar")).toHaveLength(2);
    expect(timelineChart.querySelectorAll("button.timeline-bucket")).toHaveLength(2);

    fireEvent.click(within(statusChart).getByRole("button", { name: /Error.*16\.7%/i }));
    expect(statusChart.querySelector(".donut-center")?.textContent).toContain("1Error");

    const firstBucket = within(timelineChart).getByRole("button", { name: /2 tasks/i });
    firstBucket.focus();
    fireEvent.keyDown(firstBucket, { key: "ArrowRight" });
    expect(document.activeElement?.getAttribute("aria-label")).toMatch(/4 tasks/i);
    expect(timelineChart.querySelector(".timeline-scroll")).toBeNull();
    expect(timelineChart.querySelector(".timeline-bars")?.getAttribute("style")).toContain("minmax(0, 1fr)");
    expect(timelineChart.querySelector(".timeline-axis")).toBeTruthy();
  });

  it("replaces a redundant one-bucket dropdown with a compact activity summary", () => {
    const section = {
      id: "summary",
      title: "Summary Analysis",
      kind: "summary-visualization",
      status: "available",
      span_seconds: 3600,
      status_distribution: { success: 5, error: 1, unknown: 0, other: 0 },
      timeline: [{ starts_at: "2026-07-27T15:00:00Z", count: 6 }],
    } as ReportSection;

    render(<SectionPanel section={section} query="" />);
    const activity = screen.getByRole("figure", { name: "Command Volume" });
    expect(within(activity).getByText("6")).toBeTruthy();
    expect(within(activity).getByText("60.0m")).toBeTruthy();
    expect(screen.queryByText(/activity bucket\(s\)/i)).toBeNull();
    expect(screen.queryByRole("figure", { name: "Command Volume Timeline" })).toBeNull();
  });

  it("makes outlier duration and surrounding task sequence directly inspectable", () => {
    const section = {
      id: "outliers",
      title: "Outlier Context",
      kind: "outlier-context",
      status: "available",
      outliers: [
        { task: { task_id: "8", display_id: "88", command_name: "execute", argument_preview: { text: "payload.bin", retention: "all" } }, duration_seconds: 90, preceding: [{ task_id: "7", command_name: "pwd" }], following: [{ task_id: "9", command_name: "ls" }], sequence_signature: "pwd -> execute -> ls" },
        { task: { task_id: "10", display_id: "100", command_name: "upload" }, duration_seconds: 30, preceding: [], following: [], sequence_signature: "upload" },
      ],
    } as ReportSection;

    render(<SectionPanel section={section} query="" />);
    fireEvent.click(screen.getByText("Outlier Context").closest("summary")!);
    const explorer = screen.getByText(/Neighboring commands provide investigation context/i).closest<HTMLElement>(".outlier-explorer")!;
    expect(within(explorer).getByRole("group", { name: "Command context for task 88" })).toBeTruthy();
    expect(within(explorer).getAllByText("execute payload.bin").length).toBeGreaterThanOrEqual(1);
    expect(within(explorer).getByText("pwd -> execute -> ls")).toBeTruthy();
    expect(explorer.querySelectorAll(".context-step")).toHaveLength(3);

    fireEvent.click(within(explorer).getByRole("button", { name: /upload.*Task 100.*30\.0s/i }));
    expect(within(explorer).getByRole("group", { name: "Command context for task 100" })).toBeTruthy();
    expect(explorer.querySelectorAll(".context-step")).toHaveLength(1);
    expect(screen.queryByRole("figure", { name: "Outlier duration by task" })).toBeNull();
  });

  it("renders compact stacked bars with external count labels", () => {
    const section = {
      id: "failures",
      title: "Command failures",
      kind: "command-failure-summary",
      status: "available",
      commands: [{ command_name: "cat", execution_count: 24, success_count: 21, error_count: 3, failure_rate: 0.125 }],
    } as ReportSection;

    const view = render(<SectionPanel section={section} query="" />);
    fireEvent.click(screen.getByText("Command failures").closest("summary")!);
    const chart = screen.getByRole("figure", { name: "Failure rate by command" });
    expect(chart.querySelector(".stack-track button span")).toBeNull();
    expect(chart.querySelector(".stack-counts strong")?.textContent).toBe("21");
  });

  it("renders a structured command table rather than raw model JSON", () => {
    const section = {
      id: "failures",
      title: "Command failures",
      kind: "command-failure-summary",
      status: "available",
      commands: [
        { command_name: "shell", execution_count: 4, success_count: 2, error_count: 2, failure_rate: 0.5 },
        { command_name: "cat", execution_count: 24, success_count: 21, error_count: 3, failure_rate: 0.125 },
      ],
    } as ReportSection;

    const view = render(<SectionPanel section={section} query="" />);
    fireEvent.click(screen.getByText("Command failures").closest("summary")!);

    const table = screen.getByRole("table", { name: "Command failures" });
    expect(within(table).getByText("shell")).toBeTruthy();
    expect(screen.getByRole("figure", { name: "Failure rate by command" })).toBeTruthy();
    expect(document.body.textContent).not.toContain('"command_name"');
    const rows = [...view.container.querySelectorAll("tbody tr")];
    expect(rows.map((row) => row.firstElementChild?.textContent)).toEqual(["shell", "cat"]);
    expect(within(table).getByRole("button", { name: /Failure rate ↓/i })).toBeTruthy();
  });

  it("uses a compact fact instead of an axis for a one-result ranking", () => {
    const section = {
      id: "av",
      title: "AV Tracker",
      kind: "av-tracker",
      status: "available",
      scanned_task_count: 1,
      detections: [{ vendor: "Defender", matched_executables: ["MsMpEng.exe"], occurrence_count: 1, task: { task_id: "7" } }],
    } as ReportSection;

    const view = render(<SectionPanel section={section} query="" />);
    fireEvent.click(screen.getByText("AV Tracker").closest("summary")!);
    expect(view.container.querySelector(".single-signal")?.textContent).toMatch(/Defender.*1/);
    expect(view.container.querySelector(".dot-plot")).toBeNull();
    expect(screen.getByText(/Which security products were observed/i)).toBeTruthy();
  });

  it("keeps partial callback status coverage visible and explicitly unclassified", () => {
    const section = {
      id: "callbacks",
      title: "Callback Health",
      kind: "callback-health",
      status: "available",
      callbacks: [
        { callback_id: "7", task_count: 6, success_count: 0, error_count: 0, unknown_count: 0 },
        { callback_id: "9", callback_display_id: "9", task_count: 12, success_count: 10, error_count: 2, completion_rate: 0.833, consecutive_failure_count: 3 },
      ],
    } as ReportSection;

    const view = render(<SectionPanel section={section} query="" />);
    fireEvent.click(screen.getByText("Callback Health").closest("summary")!);
    expect(screen.queryByRole("figure", { name: "Completion rate by callback" })).toBeNull();
    expect(screen.queryByLabelText("Callbacks needing attention")).toBeNull();
    const table = screen.getByRole("table", { name: "Callback Health" });
    expect(within(table).getByRole("button", { name: "Unclassified" })).toBeTruthy();
    expect(within(table).getByRole("button", { name: /Completion ↑/i })).toBeTruthy();
    const rows = [...view.container.querySelectorAll("tbody tr")];
    expect(rows[0]?.textContent).toMatch(/7/);
    expect(rows[1]?.textContent).toMatch(/9/);
  });

  it("shows concrete tool invocations instead of repeating tool-group totals", () => {
    const section = {
      id: "tools",
      title: "Tool Dump",
      kind: "tool-dump",
      status: "available",
      groups: [{
        id: "assemblies",
        name: "Assembly tools",
        match_count: 2,
        unique_command_count: 1,
        artifact_path: "assemblies.txt",
        entries: [
          { task_id: "10", display_id: "110", command_name: "execute-assembly", argument_preview: { text: "Seatbelt.exe -group=all", retention: "all" } },
          { task_id: "11", display_id: "111", command_name: "execute-assembly", argument_preview: { text: "Rubeus.exe triage", retention: "all" } },
        ],
      }],
    } as ReportSection;

    render(<SectionPanel section={section} query="" />);
    fireEvent.click(screen.getByText("Tool Dump").closest("summary")!);
    const table = screen.getByRole("table", { name: "Tool Dump" });
    expect(within(table).getByText(/Seatbelt\.exe -group=all/i)).toBeTruthy();
    expect(within(table).getByText(/Rubeus\.exe triage/i)).toBeTruthy();
    expect(screen.queryByRole("figure", { name: "Tool matches by group" })).toBeNull();
    expect(screen.queryByText(/Which tool categories account/i)).toBeNull();
  });

  it("flags older tool reports whose match details are unavailable", () => {
    const section = {
      id: "tools",
      title: "Tool Dump",
      kind: "tool-dump",
      status: "available",
      groups: [{ id: "assemblies", name: "Assembly tools", match_count: 6, entries: [] }],
    } as ReportSection;

    render(<SectionPanel section={section} query="" />);
    fireEvent.click(screen.getByText("Tool Dump").closest("summary")!);
    expect(screen.getByText(/6 tool matches were reported, but the matching invocation details were not retained/i)).toBeTruthy();
  });

  it("does not render empty evidence disclosures", () => {
    const entropy = {
      id: "entropy",
      title: "Parameter Entropy",
      kind: "parameter-entropy",
      status: "available",
      findings: [],
      repeated_token_count: 0,
      repeated_tokens: [],
    } as ReportSection;
    const retry = {
      id: "retry",
      title: "Command Retry Success",
      kind: "command-retry-success",
      status: "available",
      sequences: [{ command_name: "shell", attempts: 2, succeeded: false, tasks: [], transitions: [], intervening_tasks: [] }],
    } as ReportSection;

    const view = render(<><SectionPanel section={entropy} query="" /><SectionPanel section={retry} query="" /></>);
    fireEvent.click(screen.getByText("Parameter Entropy").closest("summary")!);
    fireEvent.click(screen.getByText("Command Retry Success").closest("summary")!);
    expect(view.container.querySelectorAll(".row-detail")).toHaveLength(0);
    expect(screen.queryByText(/repeated high-entropy token/i)).toBeNull();
    expect(screen.queryByText(/attempt context/i)).toBeNull();
  });

  it("distinguishes empty analyzer output from an empty search result", () => {
    const section = {
      id: "failures",
      title: "Command failures",
      kind: "command-failure-summary",
      status: "available",
      commands: [],
    } as ReportSection;

    const view = render(<SectionPanel section={section} query="" />);
    fireEvent.click(screen.getByText("Command failures").closest("summary")!);
    expect(screen.getByText("No analyzer rows were reported.")).toBeTruthy();

    view.rerender(<SectionPanel section={section} query="whoami" />);
    expect(screen.getByText("No rows match the active filter.")).toBeTruthy();
  });

  it("keeps unavailable sections explicit and collapsible", () => {
    const section = {
      id: "missing",
      title: "Tool dump",
      kind: "tool-dump",
      status: "missing",
      status_reason: "No tool dump artifact was generated.",
    } as ReportSection;

    render(<SectionPanel section={section} query="" />);
    fireEvent.click(screen.getByText("Tool dump").closest("summary")!);
    expect(screen.getByLabelText(/missing: no tool dump artifact was generated/i)).toBeTruthy();
    expect(screen.getByText("No tool dump artifact was generated.")).toBeTruthy();
  });

  it("opens matching sections and sorts formatted durations by raw seconds", () => {
    const section = {
      id: "durations",
      title: "Command duration",
      kind: "command-duration",
      status: "available",
      commands: [
        { command_name: "slow", execution_count: 1, median_seconds: 90, p95_seconds: 90 },
        { command_name: "fast", execution_count: 1, median_seconds: 50, p95_seconds: 50 },
      ],
    } as ReportSection;

    const view = render(<SectionPanel section={section} query="fast" />);
    expect(within(screen.getByRole("table", { name: "Command duration" })).getByText("fast")).toBeTruthy();
    expect(view.container.querySelector("[data-search-match='true']")).toBeTruthy();

    view.rerender(<SectionPanel section={section} query="" />);
    fireEvent.click(screen.getByText("Command duration").closest("summary")!);
    fireEvent.click(within(screen.getByRole("table", { name: "Command duration" })).getByRole("button", { name: /median/i }));
    const rows = [...view.container.querySelectorAll("tbody tr")];
    expect(rows.map((row) => row.firstElementChild?.textContent)).toEqual(["fast", "slow"]);
  });
});
