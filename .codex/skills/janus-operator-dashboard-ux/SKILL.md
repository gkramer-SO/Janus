---
name: janus-operator-dashboard-ux
description: "Design, implement, or rework Janus operator-facing reports and dashboards. Use for information hierarchy, charts, tables, live-data states, report/static parity, and visual treatment; not for analyzer or ingestion work with no user-facing reporting impact."
---

# Janus Operator Dashboard UX

Apply this skill automatically to Janus operator- or consultant-facing reporting
views: the served dashboard, portable HTML report, run list, analyzer results,
tables, charts, alerts, and live-state presentation.

Janus users are time-constrained. The interface must help them determine what
happened, where attention is needed, how trustworthy the conclusion is, and
what to inspect next. Do not add decorative metrics, generic charts, or
full-width chrome merely to make a page feel populated.

## First orient to the data

1. State the operator question the change should answer in one sentence.
2. Identify the `ReportModel` field(s), source fidelity, retention boundary,
   and whether the view must work in static mode, served mode, or both.
3. For a new view, choose its format from the operator task:
   - summary for scope and health;
   - compact exception notice for action or degraded state;
   - table for exact lookup, comparison, or auditability;
   - chart only for a meaningful distribution, timeline, relationship, or
     range that a table cannot surface as quickly.
4. For an existing view, keep useful content, remove or demote noise, and
   avoid unrelated redesign.

Read [system-contracts.md](references/system-contracts.md) before changing a
data boundary, adding a new dashboard view, changing live behavior, or working
on static report parity.

## Janus visual language

- Default hierarchy is run summary, compact notices, analysis, then details;
  vary it when the data makes another sequence more useful.
- Use the current dark, high-contrast baseline. Let normal state stay quiet and
  give exceptions visual priority.
- Reserve color for meaning: standard success, error, warning, unknown, and
  live/degraded states. Do not use color as decoration or as the sole signal.
- Keep panels content-sized. Combine short, related notices rather than
  spending a full-width card on each one.
- Treat containment as a card invariant. Card padding, gaps, borders, legends,
  labels, controls, and child minimum widths must all fit inside the card at
  every supported width; no child may overlap a sibling or escape the surface.
- Build responsive card grids from the space each card actually needs. Prefer
  flexible tracks such as `minmax(0, 1fr)` and auto-fitting layouts over rigid
  column ratios, and collapse the layout before the sum of child minimum
  widths, gaps, and padding exceeds the available width.
- Give grid and flex children `min-width: 0` where intrinsic content could
  force overflow. Wrap, truncate, or scroll intentionally for long source
  names, timestamps, counts, and status labels; never let browser defaults
  choose accidental overflow.
- Use consistent internal padding that preserves breathing room without
  reducing the content area below its usable minimum. Responsive rules may
  reduce padding, but must retain a visible inset between content and every
  card edge.
- Treat analyzer availability as the normal expectation. Show a clear,
  compact exception only when data is unavailable, partial, stale, malformed,
  or otherwise unreliable.
- Render tables as operator tools: clear headers, full cell boundaries, zebra
  rows, stable numeric alignment, and accessible text equivalents for state.
  Add sorting, filtering, or drilldown only when they shorten a realistic
  investigation.
- Make a chart earn its space. State the question it answers in nearby copy or
  the implementation rationale. Provide legible labels/tooltips and a usable
  tabular or textual equivalent where exact values matter.
- Favor counts, rates, chronology, outliers, confidence, and cross-source
  caveats over vanity totals. A ranked bar chart that does not alter an
  operator decision is not a valid default.

## Trust, fidelity, and live behavior

- Keep the browser on the versioned `ReportModel` contract. Do not fetch raw
  artifacts in the client or reproduce analysis logic in presentation code.
- Preserve the same information and fidelity caveats in static and served
  reports. A static report is an immutable snapshot; a served live run updates
  through the supported refresh/SSE path.
- In live mode, distinguish fresh, refreshing, stale, degraded, and failed
  states. Retain and label the last-known-good analysis instead of implying
  current certainty after a failed refresh.
- Never make weaker source data look as certain as stronger data. Surface
  unknown status, inference, malformed input, fallback identifiers, retention,
  and similar quality limits when they affect a conclusion.
- Never expose credentials or data intentionally excluded by Janus retention
  policy.

## Implementation and validation

1. Make the smallest cross-stack change that preserves the report-model
   contract; implementation technology may change, but the contract and
   static/live behavior are product invariants.
2. When a presentation need exposes a missing field, evolve the typed model and
   its builders/schema/tests rather than inventing client-only facts.
3. Verify the view using representative report data, including empty, partial,
   and error/degraded states where relevant.
4. For card or grid work, verify narrow mobile, intermediate/tablet, and normal
   desktop widths plus long labels and large numeric values. Confirm that
   padding remains visible and no legend, chart, table, tooltip, or control
   overlaps or escapes its owning surface.
5. Run focused tests and the frontend production build for UI work. For changes
   affecting contracts, server behavior, packaging, or release readiness, run
   `make check` and `make docker-smoke` when practical.

## Completion standard

Deliver a concise outcome that names the operator question now answered, the
data/fidelity limitations that remain visible, and the validation performed.
