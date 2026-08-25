#!/usr/bin/env bash
set -euo pipefail

image="${1:-janus:latest}"
smoke_root="$(mktemp -d)"
container="janus-dashboard-smoke-${RANDOM}"

cleanup() {
  docker rm -f "${container}" >/dev/null 2>&1 || true
  rm -rf "${smoke_root}"
}
trap cleanup EXIT

run_dir="${smoke_root}/complete/fixture"
mkdir -p "${run_dir}"
cp Tests/fixtures/reports/complete-mythic.json "${run_dir}/report-model.json"
printf '%s\n' '{}' > "${run_dir}/bundle.json"

docker run --rm -v "${smoke_root}:/data/out" "${image}" html --analysis-dir /data/out/complete/fixture --output /data/out/complete/fixture/report.html
test -s "${run_dir}/report.html"
grep -q 'id="janus-report-model"' "${run_dir}/report.html"

docker run -d --name "${container}" -p 127.0.0.1::8000 -v "${smoke_root}:/data/out:ro" "${image}" serve --output-root /data/out --host 0.0.0.0 --port 8000 >/dev/null
host_port="$(docker port "${container}" 8000/tcp | awk -F: 'NR == 1 {print $NF}')"

for _ in $(seq 1 30); do
  if curl --fail --silent "http://127.0.0.1:${host_port}/api/v1/health" | grep -q '"status":"ok"'; then
    break
  fi
  sleep 1
done

curl --fail --silent "http://127.0.0.1:${host_port}/api/v1/runs" | grep -q '"run_id"'
curl --fail --silent "http://127.0.0.1:${host_port}/" | grep -q 'id="app"'

docker rm -f "${container}" >/dev/null
mkdir -p "${smoke_root}/input" "${smoke_root}/config"
printf '%s\n' 'source: outflank' > "${smoke_root}/config/janus.yml"
printf '%s\n' \
  '2026-08-24 12:00:00 UTC {"event_type":"task_request","implant":{"uid":"implant-1","delay":5},"task":{"uid":"task-1","name":"whoami","out_arguments":"","timestamp":"2026-08-24T12:00:00Z"}}' \
  '2026-08-24 12:00:01 UTC {"event_type":"task_response","implant":{"uid":"implant-1","delay":5},"task":{"uid":"task-1","name":"whoami","response":"operator\\user","response_timestamp":"2026-08-24T12:00:01Z"}}' \
  > "${smoke_root}/input/outflank.json"

docker run -d --name "${container}" -p 127.0.0.1::8000 \
  -v "${smoke_root}:/data/out" -v "${smoke_root}/config:/config:ro" "${image}" \
  serve --output-root /data/out --host 0.0.0.0 --port 8000 --live --source outflank \
  --config /config/janus.yml --operation-id 7 --operation-name smoke-operation \
  --log-path /data/out/input/outflank.json --poll-interval 0.2 --analysis-debounce 0 >/dev/null
host_port="$(docker port "${container}" 8000/tcp | awk -F: 'NR == 1 {print $NF}')"

for _ in $(seq 1 60); do
  if curl --fail --silent "http://127.0.0.1:${host_port}/api/v1/health" | grep -q '"status":"ok"'; then
    break
  fi
  sleep 1
done

run_listing="$(curl --fail --silent "http://127.0.0.1:${host_port}/api/v1/runs")"
printf '%s' "${run_listing}" | grep -q '"live":true'
run_id="$(printf '%s' "${run_listing}" | python3 -c 'import json,sys; print(json.load(sys.stdin)["runs"][0]["run_id"])')"
encoded_run_id="$(python3 -c 'import sys,urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "${run_id}")"
curl --fail --silent "http://127.0.0.1:${host_port}/api/v1/runs/${encoded_run_id}/report" | grep -q 'live-revisions'
curl --fail --silent "http://127.0.0.1:${host_port}/api/v1/runs/${encoded_run_id}/status" | grep -q '"phase":"ready"'
test -s "${smoke_root}/live/outflank/events.ndjson"
test -s "${smoke_root}/live/outflank/report.html"
