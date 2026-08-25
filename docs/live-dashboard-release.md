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
  bind addresses. Authentication is intentionally out of scope for this local
  observation service.
- Live mode performs bounded full-snapshot pulls and retains the last known-good
  report after source or analyzer failures. It is observational and cannot task
  a source system.
- Source credentials remain in the mounted configuration or explicit process
  arguments. They are not returned by browser APIs or embedded in reports.
- Static reports are immutable snapshots. Served reports open an SSE connection
  only when the selected run has an active live worker.
- Report-model major versions are compatibility boundaries. Older dashboards
  fail closed with an upgrade message when a newer major version is opened.
- Python 3.12 or newer is required for host-side development. The production
  image supplies its own supported Python and compiled dashboard assets.
