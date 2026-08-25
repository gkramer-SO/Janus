<p align="center">
    <img src="Assets/ditheredjanus.png" alt="Janus" width="800"/>
    <br/>
    <em>Janus analyzes C2 telemetry to surface failure patterns, operator friction, and automation opportunities across engagements.</em>
</p>

## Quick Start

Requires [Docker](https://www.docker.com/) and the `janus-cli` binary built for your operating system.

```bash
git clone https://github.com/SpecterOps/Janus/ && cd Janus
make cli
cp Config/janus.example.yml Config/janus.yml # set source, redaction settings, etc. 
./janus-cli run
```

`pull` and `run` include source preflight/auth handling; for provider-specific auth, config precedence, TLS caveats, and Docker networking details, see [docs/FAQ.md](docs/FAQ.md) and [docs/architecture.md](docs/architecture.md).

## Usage

```bash
./janus-cli run # full execution of the ingest, analyze, and report pipeline for the configured source
./janus-cli pull # ingest Mythic, Ghostwriter, Cobalt Strike, or Outflank logs from sources defined in config
./janus-cli analyze # analyze all previously ingested logs
./janus-cli report # generate an HTML report from latest analysis

./janus-cli analyze --analyzer dwell-time 
./janus-cli analyze --events out/complete/operation-chimera_20260306_174521/events.ndjson  
./janus-cli report --json out/complete/operation-chimera_20260306_174521/ 
./janus-cli merge --inputs out/partial/op1/ out/partial/op2/ --output out/merged/ 
./janus-cli multi-analyze --pattern "out/partial/*/" --output out/combined/ 
./janus-cli diff --baseline out/complete/op_old/ --candidate out/complete/op_new/
./janus-cli pull --source cobaltstrike 
./janus-cli run --source cobaltstrike 
./janus-cli run --source outflank --log-path out/input/TSO8IEAB.json
./janus-cli run --source mythic --response-page-size 100 # lower Mythic response pagination for huge output rows

./janus-cli status # display the current ingest/analyze/report state
./janus-cli config # print active configuration
```

## Local Dashboard

`janus-cli serve` starts the one long-lived Janus container: a local, read-only dashboard at `http://127.0.0.1:8000`. It discovers completed runs under `out/` and serves the validated `report-model.json` contract. Press `Ctrl+C` to stop the container.

```bash
./janus-cli serve
./janus-cli serve --run-dir out/complete/<run-directory>
./janus-cli serve --port 8080
```

When multiple runs are available, use the dashboard's run selector to move between them without restarting the server. Press `/` to focus report search; Enter and Shift+Enter move forward and backward through matching rows. The dashboard rejects incompatible report-model major versions with an explicit upgrade message.

The host-side wrapper publishes only to loopback and rejects remote `--bind` values. The app listens inside the container only so Docker can forward that local port. This does not change the ordinary workflow: `pull`, `analyze`, `report`, and `run` each launch a one-shot container and exit when finished. Source endpoints in `Config/janus.yml` must remain reachable from the container; on Docker Desktop, use `host.docker.internal` for an API running on the host.

Live mode starts one continuously refreshed run and remains local-only. It reuses the configured Mythic, Ghostwriter, Cobalt Strike REST, or Outflank ingest path in bounded full-snapshot polls, applies the same retention policy, then reruns the existing analyzers after the configured debounce period. The first snapshot is completed before the dashboard opens; later source or analysis failures leave the previous report available and surface a degraded status.

```bash
./janus-cli serve --live --source mythic --op-id 42 --poll-interval 30 --analysis-debounce 2
./janus-cli serve --live --source cobaltstrike --op-id 1
./janus-cli serve --live --source outflank --log-path out/input/implant_logs
```

`janus-cli report` continues to produce a portable, self-contained `report.html` plus `report-model.json`; it does not require a dashboard server or internet connection to open.

For contributor validation, `make check` runs schema drift detection, the full Python suite, dashboard tests and production build, and Go CLI tests. `make docker-smoke` additionally builds the production image and exercises static report generation plus the served health, run-listing, and dashboard routes.
## Demo 

<p align="center">
  <a href="Assets/Janus-Live-Demo.gif">
    <img
      src="Assets/Janus-Live-Demo.gif"
      alt="Janus live demo walkthrough"
      width="900"
    />
  </a>
</p>

## Analyzers

| Analyzer | What it answers |
|---|---|
| `summary-visualization` | What does the operation look like at a glance across time, volume, and status? |
| `command-failure-summary` | Which commands fail most, and how often? |
| `command-retry-success` | Which commands need repeated tuning to succeed? |
| `command-duration` | How long do commands take, and what's slow? |
| `outlier-context` | What surrounds unusually slow commands? |
| `callback-health` | Which implant sessions show failure patterns or crashes? |
| `av-tracker` | Which commands or callbacks coincided with AV/EDR detections in `ps` output? |
| `dwell-time` | Where are operators losing time between tasks? |
| `friction-score` | Which commands create the most operational friction across failures, retries, duration, callback health, and argument anomalies? |
| `parameter-entropy` | Which arguments look structurally anomalous? |
| `argument-position-profile` | What shows up at a given argument slot? |
| `tool-dump` | Which registry-defined command/tool subsets should be exported for downstream datasets or pattern mining? |

`friction-score` combines findings from the other command analyzers into ranked operational friction candidates. Tune scoring weights and confidence thresholds in `Config/analyzer_registry.yml`, and tune recommendation actions in `Config/friction_score_registry.yml`.

`parameter-entropy` works best when you tune `Config/analyzer_registry.yml` to your own workflows. The current `upload` tuning reflects our observed data and should be treated as a starting point, not a universal baseline.

## Diff

Compare two completed Janus output directories with:

```bash
./janus-cli diff --baseline out/complete/op_old/ --candidate out/complete/op_new/
```

The command writes `diff.json` and the standard Janus `report.html` under `out/diff/<baseline>_vs_<candidate>/` by default and prints a concise terminal summary. Use `--out` to choose another output directory, `--format json` for CI-friendly stdout, `--no-html` to skip `report.html`, and `--fail-on-regression --max-regressions 0` to exit non-zero only for high-confidence regressions.

Janus compares command-level metrics first: task counts, success/failure/unknown rates, retry density, retry-to-success, median and p95 duration, dwell-time deltas, callback-loss-adjacent events, detection-adjacent events, and argument anomaly rates when those metrics are available. If analyzer JSON is missing, Janus falls back to `events.ndjson` where possible.

Diff results include comparability warnings for source mismatches, large task-volume changes, substantially different command mix, and high unknown-status rates. Command-level findings are usually more reliable than aggregate trends because aggregate changes can be driven by scope or command mix rather than actual tooling quality.

Confidence is based on sample size, source overlap, status fidelity, parser/retention quality, and whether a metric was directly observed or inferred. Janus uses `improvement` or `regression` only when the direction is meaningful and confidence supports the claim; otherwise it reports a low-confidence change or marks the metric not comparable.

## Skills

Use repo-local skills/commands by running `claude` or `codex` from the Janus folder, then invoking the command or skill with `/` or `$`.

- [janus-analyzer-skill](https://github.com/SpecterOps/Janus/blob/main/.codex/skills/janus-analyzer-skill/SKILL.md): Use for Janus measurement, analyzer-selection, and source-aware implementation requests across Janus-supported C2 telemetry.
- [janus-ingestor-creation](https://github.com/SpecterOps/Janus/blob/main/.codex/skills/janus-ingestor-creation/SKILL.md): Use for adding or adjusting Janus live API and local-file source ingestors while preserving the normalized event model.
- [janus-insight-interpreter](https://github.com/SpecterOps/Janus/blob/main/.codex/skills/janus-report-interpreter/SKILL.md): Use for evidence-based interpretation of Janus artifacts across Janus-supported C2 telemetry.
- Claude command equivalents live under [.claude/commands](https://github.com/SpecterOps/Janus/tree/main/.claude/commands), including `janus-ingestor`.


## Privacy

Janus runs analysis locally and does **not** use LLMs or external services for normalized operation data.

Retention policies (`output_rule` and `arguments_rule`) control what normalized content is written to disk. See [docs/architecture.md — Privacy](docs/architecture.md#privacy).

## Outputs

- `report-model.json` - validated, versioned dashboard/report contract
- `report.html` - self-contained static dashboard snapshot, including source/parser confidence warnings
- `bundle.json` - versioned JSON metadata for automation and downstream tooling, including structured `data_quality`
- `events.ndjson` - normalized event stream for debugging, replay, and testing

Analyzer outputs include `friction-score.json` when the friction score analyzer is enabled. The HTML report surfaces the top friction candidates and their recommendation metadata.

For the full normalized event model and architecture notes, see docs below.



## Docs

- [Architecture](docs/architecture.md)
- [FAQ](docs/FAQ.md)

## Credits / Contributions

- Thanks to [@IC3-512](https://github.com/IC3-512) for providing OC2 logs that helped make the OC2 ingestion work possible.
