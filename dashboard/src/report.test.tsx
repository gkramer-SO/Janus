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

    fireEvent.click(within(statusChart).getByRole("button", { name: /Error.*16\.7%/i }));
    expect(statusChart.querySelector(".donut-center")?.textContent).toContain("1Error");
  });

  it("renders a structured command table rather than raw model JSON", () => {
    const section = {
      id: "failures",
      title: "Command failures",
      kind: "command-failure-summary",
      status: "available",
      commands: [{ command_name: "shell", execution_count: 4, success_count: 2, error_count: 2, failure_rate: 0.5 }],
    } as ReportSection;

    render(<SectionPanel section={section} query="" />);
    fireEvent.click(screen.getByText("Command failures").closest("summary")!);

    const table = screen.getByRole("table", { name: "Command failures" });
    expect(within(table).getByText("shell")).toBeTruthy();
    expect(screen.getByRole("figure", { name: "Failure rate by command" })).toBeTruthy();
    expect(document.body.textContent).not.toContain('"command_name"');
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
