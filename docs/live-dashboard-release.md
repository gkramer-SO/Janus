# Live Dashboard Release Notes

Janus 1.5 introduces one dashboard implementation for both portable static
reports and the local served experience. The browser consumes the versioned
`report-model.json` contract; it does not read analyzer artifacts directly.

## Release gates

Before publishing a build, run:

```bash
make check
make docker-smoke
```

The first command verifies generated model artifacts, every Python test, the
frontend unit tests and production bundle, and the Go CLI. The Docker smoke
test builds the release image, generates a portable report inside it, starts
the local server, probes its health, run discovery, and dashboard shell, then
performs an Outflank local-file live ingest through analysis and reporting.

## Operational considerations

- The host CLI publishes the dashboard only on `127.0.0.1` and rejects remote
  bind addresses (`--bind` is validated in the Go wrapper). Authentication is
  intentionally out of scope for this local observation service.
- Run discovery walks for `bundle.json` anywhere under the output root. A
  pre-existing `report-model.json` is preferred; otherwise the model is built
  on demand from events + analyzers. `--run-dir` pins to exactly one directory.
- Live mode performs bounded full-snapshot pulls (via the normal ingestors in a
  staging directory) and retains the last known-good report after source or
  analyzer failures (run enters `degraded` + `stale`). It is purely observational
  and cannot task a source system.
- For `--live`, the HTTP server does not start until the *first* poll + analysis
  succeeds (timeout ~`max(30s, 2×poll-interval)`). Live data lands under
  `out/live/<source>/` by default; run ids are prefixed `live:<source>:...`.
- Source credentials remain in the mounted `Config/janus.yml` or explicit CLI
  arguments. They are never returned by browser APIs or embedded in reports.
- Static reports are immutable snapshots. Served reports open an SSE connection
  (`/stream`) and receive `LIVE_REVISIONS` only when the selected run has an
  active live worker.
- While a dashboard is running you may continue to use `janus-cli run`,
  `analyze`, `report`, etc. New artifacts under the mounted `./out` become
  visible in the run selector without a restart.
- Report-model major versions are compatibility boundaries. Older dashboards
  fail closed with an explicit upgrade message when a newer major version is
  opened.
- Python 3.12 or newer is required for host-side development. The production
  image supplies its own supported Python and compiled dashboard assets.
- `make serve` starts the same image via docker-compose (static by default).
