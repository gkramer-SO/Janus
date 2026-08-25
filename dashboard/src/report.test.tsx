// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it } from "vitest";

import { SectionPanel } from "./report";
import type { ReportModel } from "./generated/report-model";

type ReportSection = NonNullable<ReportModel["sections"]>[number];

afterEach(cleanup);

describe("report sections", () => {
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

    expect(screen.getByRole("table", { name: "Command failures" })).toBeTruthy();
    expect(screen.getByText("shell")).toBeTruthy();
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
    expect(screen.getByText("fast")).toBeTruthy();
    expect(view.container.querySelector("[data-search-match='true']")).toBeTruthy();

    view.rerender(<SectionPanel section={section} query="" />);
    fireEvent.click(screen.getByText("Command duration").closest("summary")!);
    fireEvent.click(screen.getByRole("button", { name: /median/i }));
    const rows = [...view.container.querySelectorAll("tbody tr")];
    expect(rows.map((row) => row.firstElementChild?.textContent)).toEqual(["fast", "slow"]);
  });
});
