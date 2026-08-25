package main

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestNormalizeServeBindRejectsRemoteExposure(t *testing.T) {
	for _, value := range []string{"", "localhost", "127.0.0.1"} {
		got, err := normalizeServeBind(value)
		if err != nil || got != "127.0.0.1" {
			t.Fatalf("normalizeServeBind(%q) = %q, %v", value, got, err)
		}
	}
	for _, value := range []string{"0.0.0.0", "::1", "192.0.2.10"} {
		if _, err := normalizeServeBind(value); err == nil {
			t.Fatalf("normalizeServeBind(%q) accepted a non-loopback bind", value)
		}
	}
}

func TestServeValidationStopsBeforeDocker(t *testing.T) {
	for _, args := range [][]string{
		{"--no-build", "--bind", "0.0.0.0"},
		{"--no-build", "--port", "0"},
		{"--no-build", "--poll-interval", "0"},
		{"--no-build", "--latest", "--run-dir", "out/example"},
	} {
		if code := cmdServe(args); code != 1 {
			t.Fatalf("cmdServe(%v) returned %d, want 1", args, code)
		}
	}
}

func TestResolveServePathsRemainBelowOut(t *testing.T) {
	original, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chdir(t.TempDir()); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chdir(original) })
	if err := os.MkdirAll(filepath.Join("out", "complete", "run-one"), 0o755); err != nil {
		t.Fatal(err)
	}

	got, err := resolvePathUnderOutForDocker(filepath.Join("out", "complete", "run-one"), true, true)
	if err != nil || got != "out/complete/run-one" {
		t.Fatalf("resolved path = %q, %v", got, err)
	}
	if _, err := resolvePathUnderOutForDocker(".", true, true); err == nil {
		t.Fatal("path outside out/ was accepted")
	}
}

func TestLeadingDockerFlagsAreParsedWithoutChangingSubcommand(t *testing.T) {
	globalDockerNetwork, globalDockerAddHost = "", ""
	rest := parseLeadingGlobalFlags([]string{"--docker-network", "host", "--docker-add-host=api:host-gateway", "serve", "--no-build"})
	if !reflect.DeepEqual(rest, []string{"serve", "--no-build"}) {
		t.Fatalf("remaining arguments = %v", rest)
	}
	if globalDockerNetwork != "host" || globalDockerAddHost != "api:host-gateway" {
		t.Fatalf("parsed globals = %q, %q", globalDockerNetwork, globalDockerAddHost)
	}
}
