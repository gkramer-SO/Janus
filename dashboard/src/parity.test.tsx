// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it } from "vitest";

import completeFixture from "../../Tests/fixtures/reports/complete-mythic.json";
import diffFixture from "../../Tests/fixtures/reports/diff-report.json";
import type { ReportModel } from "./generated/report-model";
import { SectionPanel } from "./report";

afterEach(cleanup);

function openAll(container: Element) {
  for (const summary of container.querySelectorAll("summary.section-toggle")) fireEvent.click(summary);
}

describe("report migration parity", () => {
  it("renders every operation analyzer section from the complete contract fixture", () => {
    const model = completeFixture as unknown as ReportModel;
    const view = render(<>{model.sections?.map((section) => <SectionPanel key={section.id} section={section} query="" />)}</>);
    openAll(view.container);

    for (const title of ["Summary Analysis", "Command Failure Summary", "Command Retry Success", "Command Duration", "Top Friction Candidates", "Outlier Context", "Callback Health", "AV Tracker", "Dwell Time", "Parameter Entropy", "Argument Position Profile", "Tool Dump", "Data Quality"]) {
      expect(screen.getByText(title)).toBeTruthy();
    }
    expect(screen.getByText(/attempt context/i)).toBeTruthy();
    expect(screen.getByText(/context for task 101/i)).toBeTruthy();
    expect(screen.getByText(/tool-dump\/assembly-tools.ndjson/i)).toBeTruthy();
    expect(screen.getByText(/depth distribution/i)).toBeTruthy();
  });

  it("renders diff summary, findings, and entity presence from the diff fixture", () => {
    const model = diffFixture as unknown as ReportModel;
    const section = model.sections?.find((value) => value.kind === "run-diff");
    if (!section) throw new Error("Diff fixture is missing its run-diff section.");
    const view = render(<SectionPanel section={section} query="" />);
    fireEvent.click(view.container.querySelector("summary.section-toggle")!);

    expect(screen.getByText(/comparability:/i)).toBeTruthy();
    expect(screen.getByRole("table", { name: "Run Diff" })).toBeTruthy();
    expect(screen.getByText(/entity presence changes/i)).toBeTruthy();
  });
});
