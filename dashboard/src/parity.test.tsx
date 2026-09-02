// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it } from "vitest";

import completeFixture from "../../Tests/fixtures/reports/complete-mythic.json";
import cobaltStrikeFixture from "../../Tests/fixtures/reports/cobalt-strike-rest.json";
import diffFixture from "../../Tests/fixtures/reports/diff-report.json";
import ghostwriterFixture from "../../Tests/fixtures/reports/ghostwriter-high-unknown.json";
import malformedFixture from "../../Tests/fixtures/reports/malformed-optional-fields.json";
import missingFixture from "../../Tests/fixtures/reports/missing-analyzers.json";
import multiFixture from "../../Tests/fixtures/reports/multi-operation.json";
import outflankFixture from "../../Tests/fixtures/reports/outflank.json";
import partialFixture from "../../Tests/fixtures/reports/partial-mythic.json";
import retentionFixture from "../../Tests/fixtures/reports/retention-enabled.json";
import type { ReportModel } from "./generated/report-model";
import { SectionPanel } from "./report";

afterEach(cleanup);

function openAll(container: Element) {
  for (const summary of container.querySelectorAll("summary.section-toggle")) fireEvent.click(summary);
}

const reportVariants = [
  ["partial Mythic", partialFixture],
  ["high-unknown Ghostwriter", ghostwriterFixture],
  ["Cobalt Strike REST", cobaltStrikeFixture],
  ["Outflank", outflankFixture],
  ["multi-operation", multiFixture],
  ["retention-limited", retentionFixture],
  ["missing analyzers", missingFixture],
  ["malformed optional fields", malformedFixture],
] as const;

describe("report migration parity", () => {
  it("renders every operation analyzer section from the complete contract fixture", () => {
    const model = completeFixture as unknown as ReportModel;
    const view = render(<>{model.sections?.map((section) => <SectionPanel key={section.id} section={section} query="" />)}</>);
    openAll(view.container);

    for (const title of ["Summary Analysis", "Command Failure Summary", "Command Retry Success", "Command Duration", "Top Friction Candidates", "Outlier Context", "Callback Health", "AV Tracker", "Dwell Time", "Parameter Entropy", "Argument Position Profile", "Tool Dump", "Data Quality"]) {
      expect(screen.getByText(title)).toBeTruthy();
    }
    expect(screen.getByText(/attempt context/i)).toBeTruthy();
    expect(screen.getByRole("group", { name: /command context for task 101/i })).toBeTruthy();
    expect(view.container.querySelector(".artifact-note")?.textContent).toMatch(/Exports:.*tool-dump\/assembly-tools.ndjson/i);
    expect(screen.queryByText(/0 repeated high-entropy token/i)).toBeNull();
    expect(screen.queryByText(/matched tasks/i)).toBeNull();
    expect(screen.getAllByRole("figure").length).toBeGreaterThanOrEqual(12);
    for (const chart of view.container.querySelectorAll("figure.data-chart")) {
      expect(chart.querySelector(".chart-question")?.textContent?.trim()).toBeTruthy();
    }
    expect(view.container.querySelector(".outlier-guidance")?.textContent).toMatch(/context, not proof of causation/i);
  });

  it("renders diff summary, findings, and entity presence from the diff fixture", () => {
    const model = diffFixture as unknown as ReportModel;
    const section = model.sections?.find((value) => value.kind === "run-diff");
    if (!section) throw new Error("Diff fixture is missing its run-diff section.");
    const view = render(<SectionPanel section={section} query="" />);
    fireEvent.click(view.container.querySelector("summary.section-toggle")!);

    expect(screen.getByText(/comparability:/i)).toBeTruthy();
    expect(screen.getByRole("table", { name: "Run Diff" })).toBeTruthy();
    expect(screen.getByRole("figure", { name: "Metric change magnitude" })).toBeTruthy();
    expect(screen.queryByText(/entity presence changes/i)).toBeNull();
  });

  it.each(reportVariants)("renders the %s contract variant through the same reusable analyzer views", (_name, fixture) => {
    const model = fixture as unknown as ReportModel;
    const view = render(<>{model.sections?.map((section) => <SectionPanel key={section.id} section={section} query="" />)}</>);
    openAll(view.container);

    expect(view.container.querySelectorAll("summary.section-toggle")).toHaveLength(model.sections?.length ?? 0);
    for (const chart of view.container.querySelectorAll("figure.data-chart")) {
      expect(chart.querySelector(".chart-question")?.textContent?.trim()).toBeTruthy();
    }
    for (const exception of view.container.querySelectorAll(".section-state.exception")) {
      expect(exception.getAttribute("aria-label")).toMatch(/suppressed|missing|error/i);
    }
  });
});
