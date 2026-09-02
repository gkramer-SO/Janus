# Janus reporting system contracts

Use this reference when the request spans a data boundary, new view, static
report parity, live updates, or a change in dashboard technology.

## Durable reporting path

Janus ingests source telemetry, normalizes it into `events.ndjson` and
`bundle.json`, runs analyzers, and builds the versioned `ReportModel`. Both
the self-contained `report.html` and the local served dashboard render that
model. The report model—not an analyzer JSON or a browser-side derivation—is
the presentation contract.

Useful implementation anchors:

- `Core/report_model.py`: typed model and schema-facing structure.
- `Core/report_builder.py`: creates report-model content from bundle, events,
  analyzers, and quality data.
- `Core/html_output.py`: portable report rendering and established status/data
  visual baseline.
- `Server/service.py`, `Server/app.py`, and `Server/live.py`: run discovery,
  report API, and live-worker state.
- `dashboard/src/boot.ts`, `dashboard/src/main.tsx`, and
  `dashboard/src/report.tsx`: current browser implementation. These are
  current locations, not a permanent framework requirement.

## Static and served parity

The static report embeds a validated model and is an immutable snapshot. The
served dashboard gets the model from `GET /api/v1/runs/{run_id}/report` with
ETag support. Live runs expose an SSE stream at
`/api/v1/runs/{run_id}/stream` and the `LIVE_REVISIONS` capability.

Do not let the UI bypass this model boundary or read analyzer artifacts
directly. If the UI needs a durable new fact, add it to the report model and
validate it through its producer and consumer paths.

## Data trust rules

- A live worker keeps the last known-good report when a later pull/analyzer
  cycle fails; the UI must identify stale/degraded data instead of calling it
  fresh.
- Source status fidelity differs. Do not imply a status is authoritative when
  it is inferred or unavailable for the source.
- Quality counters and caveats can materially change the meaning of an
  analysis. Keep them accessible and give exceptions an appropriate signal.
- Credentials remain in Janus configuration and are never report/API content.
- Server use is deliberately local observation: it binds host-side to loopback
  and does not task source systems.

## Validation

For a local UI change, run focused frontend tests and a production bundle. For
model/server/package/release changes, use `make check` and `make docker-smoke`
when practical. Inspect real and edge-state report models: complete, empty,
partial, malformed/unknown quality, stale, degraded, and failed refresh.
