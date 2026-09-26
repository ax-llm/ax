package axir

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Targets run their conformance from their generated package directories, so
// Verify resolves a relative root against the working directory first.
func TestVerifyResolvesRelativeRootAgainstWorkingDirectory(t *testing.T) {
	relative := filepath.Join("..", "..", "..", "..", "ir", "axcore", "root.axir")
	cwd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	root := absoluteRootFile(relative)
	if want := filepath.Join(cwd, relative); root != want {
		t.Fatalf("absoluteRootFile(%q) = %q, want %q", relative, root, want)
	}
	for _, suite := range conformanceSuitePaths(conformanceRootFor(root)) {
		if !filepath.IsAbs(suite) {
			t.Fatalf("conformance suite path %q is relative", suite)
		}
		if _, err := os.Stat(suite); err != nil {
			t.Fatalf("conformance suite %q: %v", suite, err)
		}
	}
}

func TestRequireConformanceFixturesFailsWhenNoneRan(t *testing.T) {
	empty := VerifyTargetReport{Target: "go", Steps: []VerifyStep{{Name: "conformance", Status: "ok", Message: "go"}}}
	err := requireConformanceFixtures(&empty)
	if err == nil || !strings.Contains(err.Error(), "ran 0 fixtures") {
		t.Fatalf("requireConformanceFixtures with no fixtures = %v, want a 0 fixtures error", err)
	}
	if last := empty.Steps[len(empty.Steps)-1]; last.Name != "conformance fixtures" || last.Status != "fail" {
		t.Fatalf("last step = %+v, want a failed conformance fixtures step", last)
	}

	ran := VerifyTargetReport{Target: "rust", Steps: []VerifyStep{{Name: "conformance", Status: "ok", Message: "offline\nwarning: unused variable\nok first\nok second"}}}
	if err := requireConformanceFixtures(&ran); err != nil {
		t.Fatalf("requireConformanceFixtures with two fixtures: %v", err)
	}
	if last := ran.Steps[len(ran.Steps)-1]; last.Status != "ok" || last.Message != "2 fixtures" {
		t.Fatalf("last step = %+v, want ok with 2 fixtures", last)
	}
}
