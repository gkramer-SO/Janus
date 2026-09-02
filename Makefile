IMAGE   := janus
TAG     := latest

# Read the package version without requiring Python. PowerShell is available on
# supported Windows hosts; Unix-like hosts use awk.
ifeq ($(OS),Windows_NT)
JANUS_VERSION := $(shell powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/read_project_version.ps1 pyproject.toml)
else
JANUS_VERSION := $(shell awk 'BEGIN { in_project = 0 } /^\[project\]/ { in_project = 1; next } /^\[/ { in_project = 0 } in_project && /^version[[:space:]]*=/ { gsub(/"/, "", $$3); print $$3; exit }' pyproject.toml)
endif
ifeq ($(strip $(JANUS_VERSION)),)
$(error Could not read version from pyproject.toml)
endif
CLI_LDFLAGS := -ldflags="-s -w -X main.version=$(JANUS_VERSION)"

# Host OS from the Go toolchain — Windows needs .exe for PowerShell/cmd.
GOHOSTOS := $(shell go env GOOS)
ifeq ($(GOHOSTOS),windows)
CLI_OUT := ../../janus-cli.exe
else
CLI_OUT := ../../janus-cli
endif

.PHONY: build test test-python test-go check schema schema-check shell clean help cli cli-all web-install web-build web-test test-dashboard docker-smoke serve

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  %-12s %s\n", $$1, $$2}'
	@echo ""
	@echo "Build the CLI: make cli"

build: ## Build the Docker image
	docker build -t $(IMAGE):$(TAG) .

test: build ## Run the test suite inside the container
	docker run --rm --entrypoint sh \
		-v $(CURDIR):/src:ro \
		-w /src \
		$(IMAGE):$(TAG) -c "pip install -q pytest && pytest Tests/"

test-python: ## Run the full Python test suite on the host
	python3 -m pytest -q Tests/

test-go: ## Run Go CLI tests
	go test ./...

check: schema-check test-python web-test web-build test-go ## Run all non-Docker validation gates

schema: ## Generate report-model JSON Schema and TypeScript declarations
	python3 scripts/generate_report_schema.py

schema-check: ## Fail when generated report-model artifacts are stale
	python3 scripts/generate_report_schema.py --check

web-install: ## Install locked dashboard dependencies
	npm --prefix dashboard ci

web-build: ## Type-check and build the dashboard
	npm --prefix dashboard run typecheck
	npm --prefix dashboard run build

web-test: ## Run dashboard unit tests
	npm --prefix dashboard run test

test-dashboard: web-test ## Alias for dashboard unit tests

docker-smoke: build ## Exercise static, served, and local live-source workflows in the production image
	scripts/docker_smoke_test.sh $(IMAGE):$(TAG)

serve: build ## Start the local dashboard through Docker Compose
	docker compose up --build janus

shell: build ## Open a shell in the container
	docker run --rm -it --entrypoint /bin/bash \
		-v $(CURDIR)/out:/data/out \
		-v $(CURDIR)/Config:/config:ro \
		$(IMAGE):$(TAG)

clean: ## Remove all versioned output directories and loose output files
	rm -rf out/op-* out/latest out/latest.txt out/*.json out/*.ndjson out/*.html

cli: ## Build the Go CLI binary for the current platform (janus-cli.exe on Windows)
	cd cmd/janus-cli && go build $(CLI_LDFLAGS) -o $(CLI_OUT) .

cli-all: ## Cross-compile Go CLI for all platforms
	cd cmd/janus-cli && GOOS=linux GOARCH=amd64 go build $(CLI_LDFLAGS) -o ../../dist/janus-cli-linux-amd64 .
	cd cmd/janus-cli && GOOS=linux GOARCH=arm64 go build $(CLI_LDFLAGS) -o ../../dist/janus-cli-linux-arm64 .
	cd cmd/janus-cli && GOOS=darwin GOARCH=amd64 go build $(CLI_LDFLAGS) -o ../../dist/janus-cli-darwin-amd64 .
	cd cmd/janus-cli && GOOS=darwin GOARCH=arm64 go build $(CLI_LDFLAGS) -o ../../dist/janus-cli-darwin-arm64 .
	cd cmd/janus-cli && GOOS=windows GOARCH=amd64 go build $(CLI_LDFLAGS) -o ../../dist/janus-cli-windows-amd64.exe .
