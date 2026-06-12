package axir

import (
	"os"
	"path/filepath"
	"testing"
)

func coverageSpecs() []CoreFuncSpec {
	return []CoreFuncSpec{
		{Symbol: "alpha", Name: "alpha", Module: "signature"},
		{Symbol: "beta", Name: "_beta", Module: "signature"},
		{Symbol: "gamma", Name: "gamma", Module: "agent"},
	}
}

func TestParseCoverageTraceDedupes(t *testing.T) {
	path := filepath.Join(t.TempDir(), "trace.txt")
	if err := os.WriteFile(path, []byte("alpha\n\ngamma\nalpha\n  _beta \n"), 0o644); err != nil {
		t.Fatal(err)
	}
	traced, err := ParseCoverageTrace(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(traced) != 3 || !traced["alpha"] || !traced["_beta"] || !traced["gamma"] {
		t.Fatalf("unexpected trace set: %#v", traced)
	}
}

func TestAuditCoverageDiffsAgainstRegistry(t *testing.T) {
	report := AuditCoverage(coverageSpecs(), "go", map[string]bool{
		"alpha":    true,
		"unknown":  true, // helpers and drift are ignored
		"_unnamed": true,
	})
	if report.Total != 3 {
		t.Fatalf("total = %d, want 3", report.Total)
	}
	if len(report.Exercised) != 1 || report.Exercised[0] != "alpha" {
		t.Fatalf("exercised = %v", report.Exercised)
	}
	if len(report.Unexercised) != 2 {
		t.Fatalf("unexercised = %v", report.Unexercised)
	}
	grouped := UnexercisedByModule(coverageSpecs(), report)
	if len(grouped["signature"]) != 1 || grouped["signature"][0] != "_beta" {
		t.Fatalf("signature group = %v", grouped["signature"])
	}
	if len(grouped["agent"]) != 1 {
		t.Fatalf("agent group = %v", grouped["agent"])
	}
}

func TestCoverageAsymmetries(t *testing.T) {
	reports := []CoverageReport{
		{Target: "python", Exercised: []string{"alpha", "gamma"}},
		{Target: "go", Exercised: []string{"alpha"}},
	}
	asymmetries := CoverageAsymmetries(reports)
	if len(asymmetries) != 1 {
		t.Fatalf("asymmetries = %#v", asymmetries)
	}
	if targets := asymmetries["gamma"]; len(targets) != 1 || targets[0] != "python" {
		t.Fatalf("gamma targets = %v", targets)
	}
}
