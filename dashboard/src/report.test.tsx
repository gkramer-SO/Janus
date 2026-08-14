// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/preact";
import { describe, expect, it } from "vitest";

import { SectionPanel } from "./report";
import type { ReportModel } from "./generated/report-model";

type ReportSection = NonNullable<ReportModel["sections"]>[number];

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
    fireEvent.click(screen.getByRole("button", { name: /command failures/i }));

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
    fireEvent.click(screen.getByRole("button", { name: /tool dump/i }));
    expect(screen.getByText("No tool dump artifact was generated.")).toBeTruthy();
  });
});
