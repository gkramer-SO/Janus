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
        { task: { task_id: "8", display_id: "88", command_name: "execute-assembly", argument_preview: { text: "Rubeus.exe triage", retention: "all" } }, duration_seconds: 90, preceding: [{ task_id: "7", command_name: "pwd" }], following: [{ task_id: "9", command_name: "ls" }], sequence_signature: "pwd -> execute-assembly -> ls" },
        { task: { task_id: "10", display_id: "100", command_name: "upload", argument_preview: { text: "beacon.bin C:\\Temp\\", retention: "all" } }, duration_seconds: 30, preceding: [], following: [], sequence_signature: "upload" },
      ],
    } as ReportSection;

    const view = render(<SectionPanel section={section} query="" />);
    fireEvent.click(screen.getByText("Outlier Context").closest("summary")!);
    const panel = view.container.querySelector(".outlier-panel")!;
    expect(panel.querySelector(".outlier-stats")?.textContent).toMatch(/Detected.*2.*Longest.*1\.5m/i);
    const table = within(panel).getByRole("table", { name: "Outlier Context" });
    expect(within(table).getByText("execute-assembly Rubeus.exe triage")).toBeTruthy();
    expect(within(table).getByText("pwd -> execute-assembly -> ls")).toBeTruthy();
    expect(within(table).getByText("upload beacon.bin C:\\Temp\\")).toBeTruthy();
    expect(view.container.querySelector(".outlier-explorer")).toBeNull();
    expect(view.container.querySelector(".context-step")).toBeNull();

    fireEvent.click(within(panel).getByText(/execute-assembly · Task 88 context/i));
    expect(within(panel).getByLabelText("Command context for task 88")).toBeTruthy();
    expect(within(panel).getByText("pwd")).toBeTruthy();
    expect(within(panel).getByText("ls")).toBeTruthy();
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

  it("keeps a single AV detection as a table instead of repeating it as a chart", () => {
    const section = {
      id: "av",
      title: "AV Tracker",
      kind: "av-tracker",
      status: "available",
      scanned_task_count: 2,
      detections: [{ vendor: "Defender", matched_executables: ["MsMpEng.exe"], occurrence_count: 1, task: { task_id: "7" } }],
    } as ReportSection;

    const view = render(<SectionPanel section={section} query="" />);
    fireEvent.click(screen.getByText("AV Tracker").closest("summary")!);
    expect(screen.getByText(/Scanned/i).textContent).toMatch(/2/);
    expect(screen.queryByText(/found 1 detection/i)).toBeNull();
    expect(view.container.querySelector(".single-signal")).toBeNull();
    expect(view.container.querySelector(".dot-plot")).toBeNull();
    expect(screen.queryByText(/Which security products were observed/i)).toBeNull();
    const table = screen.getByRole("table", { name: "AV Tracker" });
    expect(within(table).getByText("Defender")).toBeTruthy();
    expect(within(table).getByText("MsMpEng.exe")).toBeTruthy();
  });

  it("ranks AV vendors only when multiple detections make comparison useful", () => {
    const section = {
      id: "av",
      title: "AV Tracker",
      kind: "av-tracker",
      status: "available",
      scanned_task_count: 4,
      detections: [
        { vendor: "Defender", matched_executables: ["MsMpEng.exe"], occurrence_count: 3, task: { task_id: "7" } },
        { vendor: "CrowdStrike", matched_executables: ["CSFalconService.exe"], occurrence_count: 1, task: { task_id: "8" } },
      ],
    } as ReportSection;

    const view = render(<SectionPanel section={section} query="" />);
    fireEvent.click(screen.getByText("AV Tracker").closest("summary")!);
    expect(view.container.querySelector(".dot-plot")).toBeTruthy();
    expect(screen.getByText(/Which security products were observed/i)).toBeTruthy();
    expect(screen.getByRole("table", { name: "AV Tracker" })).toBeTruthy();
  });

  it("keeps dwell summary stats inside the distribution chart surface", () => {
    const section = {
      id: "dwell",
      title: "Dwell Time",
      kind: "dwell-time",
      status: "available",
      measurement_count: 6,
      median_seconds: 18.3,
      p95_seconds: 630,
      max_seconds: 810,
      distribution: [
        { label: "1–5s", min_seconds: 1, max_seconds: 5, count: 1 },
        { label: "15–30s", min_seconds: 15, max_seconds: 30, count: 2 },
        { label: "1–2m", min_seconds: 60, max_seconds: 120, count: 3 },
      ],
      measurements: [],
    } as ReportSection;

    const view = render(<SectionPanel section={section} query="" />);
    fireEvent.click(screen.getByText("Dwell Time").closest("summary")!);
    const panel = view.container.querySelector(".dwell-panel");
    expect(panel).toBeTruthy();
    expect(panel?.querySelector(".dwell-stats")?.textContent).toMatch(/Measured.*6.*Median.*18\.3s.*P95.*10\.5m.*Maximum.*13\.5m/i);
    expect(view.container.querySelector(".inline-metrics")).toBeNull();
    expect(panel?.querySelector(".dwell-plot")).toBeTruthy();
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
    // Callback 7 is all unclassified; callback 9 has success + error only.
    expect(rows[0]?.querySelectorAll("td.status-cell")).toHaveLength(1);
    expect(rows[0]?.querySelector("td.status-cell.unknown")?.textContent).toBe("6");
    expect(rows[1]?.querySelector("td.status-cell.success")?.textContent).toBe("10");
    expect(rows[1]?.querySelector("td.status-cell.error")?.textContent).toBe("2");
    expect(rows[1]?.querySelector("td.status-cell.unknown")).toBeNull();
    const toggle = screen.getByLabelText("Status colors") as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    fireEvent.click(toggle);
    expect(toggle.checked).toBe(false);
    expect(view.container.querySelectorAll("td.status-cell")).toHaveLength(0);
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

  it("keeps a single entropy finding as a command-first table instead of duplicating a chart", () => {
    const section = {
      id: "entropy",
      title: "Parameter Entropy",
      kind: "parameter-entropy",
      status: "available",
      findings: [
        {
          task: { task_id: "101", display_id: "101", command_name: "execute-assembly", argument_preview: { text: "Rubeus.exe triage", retention: "all" } },
          finding_type: "high-entropy-token",
          token_entropy: 4.2,
          token: "Y2hhbGxlbmdlLXRva2Vu",
          detail: "An uncommon token structure was observed.",
        },
      ],
    } as ReportSection;

    const view = render(<SectionPanel section={section} query="" />);
    fireEvent.click(screen.getByText("Parameter Entropy").closest("summary")!);
    expect(screen.queryByRole("figure", { name: "Shannon entropy by argument" })).toBeNull();
    const table = screen.getByRole("table", { name: "Parameter Entropy" });
    expect(within(table).getByText("execute-assembly Rubeus.exe triage")).toBeTruthy();
    expect(within(table).getByText("Y2hhbGxlbmdlLXRva2Vu")).toBeTruthy();
    expect(view.container.querySelector(".entropy-cli")?.textContent).toBe("Y2hhbGxlbmdlLXRva2Vu");
  });

  it("renders argument position findings and slots like the portable report", () => {
    const section = {
      id: "argument-position-profile",
      title: "Argument Position Profile",
      kind: "argument-position-profile",
      status: "available",
      commands_profiled: 2,
      max_depth: 2,
      total_tasks: 8,
      tasks_with_arguments: 6,
      mean_argument_depth: 1.75,
      positions_profiled: 3,
      finding_count: 2,
      findings: [
        { command_name: "ls", position: 1, finding_type: "high_diversity", occurrences: 5, sample_size: 6, ratio: 0.83, detail: "5 unique values across 6 tasks (83% diversity)" },
        { command_name: "execute-assembly", position: 1, finding_type: "static_argument", occurrences: 6, sample_size: 6, ratio: 1, detail: "always Rubeus.exe — 6/6 tasks (100%)", expected: true },
      ],
      depth_distribution: [{ command_name: "pty_in_session::cd", task_count: 3, min_depth: 1, max_depth: 1, mean_depth: 1, median_depth: 1, stdev_depth: 0 }],
      command_profiles: [{ command_name: "execute-assembly", task_count: 6, positions: 1, position_rows: [{ position: 1, tasks_reaching: 6, reach_pct: 100, unique_values: 1, top_values: [{ value: "Rubeus.exe", count: 6, pct: 100 }] }] }],
    } as ReportSection;

    const view = render(<SectionPanel section={section} query="" />);
    expect(screen.queryByRole("figure", { name: "Finding ratio by command and position" })).toBeNull();
    const stats = view.container.querySelector(".arg-stats")!;
    expect(within(stats as HTMLElement).getByText("6 / 8")).toBeTruthy();
    expect(within(stats as HTMLElement).getByText("Positions profiled")).toBeTruthy();
    const table = screen.getByRole("table", { name: "Argument Position Profile" });
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent?.replace(/[↑↓\s]/g, ""))).toEqual(["Type", "Command", "Position", "Detail"]);
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows[0].textContent).toContain("Static Arg");
    expect(rows[0].textContent).toContain("expected");
    expect(rows[1].textContent).toContain("High Diversity");
    expect(screen.getByText("PTY ▸ cd")).toBeTruthy();
    const slots = screen.getByRole("table", { name: "execute-assembly argument positions" });
    expect(within(slots).getByText("Rubeus.exe")).toBeTruthy();
    expect(within(slots).getByText("100%")).toBeTruthy();
  });

  it("plots parameter entropy against the Shannon flag threshold instead of a ranked dot line", () => {
    const section = {
      id: "entropy",
      title: "Parameter Entropy",
      kind: "parameter-entropy",
      status: "available",
      findings: [
        { task: { task_id: "161", display_id: "161", command_name: "cat", argument_preview: { text: "blob.b64", retention: "all" } }, finding_type: "high_entropy_token", token_entropy: 4.83, token: "Y2hhbGxlbmdlLXRva2Vu…[+80]", detail: "Token entropy 4.83 bits/char" },
        { task: { task_id: "12", display_id: "12", command_name: "download" }, finding_type: "high_entropy_token", token_entropy: 5.1, detail: "Token entropy 5.10 bits/char" },
        { task: { task_id: "9", display_id: "9", command_name: "ptt" }, finding_type: "low_entropy_for_expected_high_entropy_command", token_entropy: 3.1, detail: "Below expected minimum" },
        { task: { task_id: "4", display_id: "4", command_name: "ls" }, finding_type: "wildcard_path", token_entropy: null, detail: "3 wildcard chars" },
      ],
    } as ReportSection;

    const view = render(<SectionPanel section={section} query="" />);
    fireEvent.click(screen.getByText("Parameter Entropy").closest("summary")!);
    const chart = screen.getByRole("figure", { name: "Shannon entropy by argument" });
    expect(screen.queryByRole("figure", { name: "Highest parameter entropy" })).toBeNull();
    expect(view.container.querySelector(".dot-plot")).toBeNull();
    expect(chart.querySelectorAll(".entropy-bar")).toHaveLength(3);
    expect(chart.querySelectorAll(".entropy-bar.flagged")).toHaveLength(2);
    expect(chart.querySelectorAll(".entropy-bar.low")).toHaveLength(1);
    expect(chart.querySelectorAll(".entropy-threshold")).toHaveLength(3);
    expect(chart.querySelector(".entropy-tick.flag")?.textContent).toMatch(/4\.5 flag/i);
    expect(within(chart).getByText(/cat blob\.b64/i)).toBeTruthy();
    expect(within(chart).queryByText(/wildcard/i)).toBeNull();
    const table = screen.getByRole("table", { name: "Parameter Entropy" });
    expect(within(table).getByRole("button", { name: "CLI input" })).toBeTruthy();
    expect(within(table).getByRole("button", { name: /Entropy ↓/i })).toBeTruthy();
    expect(within(table).getByText("Y2hhbGxlbmdlLXRva2Vu…[+80]")).toBeTruthy();
    expect(view.container.querySelectorAll("td.status-cell.entropy-flag")).toHaveLength(2);
    expect(view.container.querySelectorAll("td.status-cell.entropy-low")).toHaveLength(1);
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

  it("shows the issued command beside each retry attempt task link", () => {
    const section = {
      id: "retry",
      title: "Command Retry Success",
      kind: "command-retry-success",
      status: "available",
      sequences: [{
        command_name: "execute-assembly",
        attempts: 2,
        succeeded: true,
        tasks: [
          {
            task_id: "100",
            display_id: "100",
            command_name: "execute-assembly",
            argument_preview: { text: "Seatbelt.exe -group=user", retention: "all" },
            timestamp: "2026-07-27T15:00:00Z",
            link: { label: "Task 100", url: "https://mythic.local/new/task/100", kind: "task" },
          },
          {
            task_id: "101",
            display_id: "101",
            command_name: "execute-assembly",
            argument_preview: { text: "Seatbelt.exe -group=all", retention: "all" },
            timestamp: "2026-07-27T15:00:00Z",
            link: { label: "Task 101", url: "https://mythic.local/new/task/101", kind: "task" },
          },
        ],
        transitions: [],
        intervening_tasks: [],
      }],
    } as ReportSection;

    render(<SectionPanel section={section} query="" />);
    fireEvent.click(screen.getByText("Command Retry Success").closest("summary")!);
    fireEvent.click(screen.getByText(/execute-assembly: attempt context/i));
    expect(screen.getByText("Task 100")).toBeTruthy();
    expect(screen.getByText("Task 101")).toBeTruthy();
    expect(screen.getByText(/execute-assembly Seatbelt\.exe -group=user/i)).toBeTruthy();
    expect(screen.getByText(/execute-assembly Seatbelt\.exe -group=all/i)).toBeTruthy();
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
