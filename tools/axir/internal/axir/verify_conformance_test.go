package axir

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestConformanceShardsCoverEveryFixtureOnce(t *testing.T) {
	root := t.TempDir()
	var want []string
	for i, suite := range conformanceSuitePaths(root) {
		if err := os.MkdirAll(suite, 0755); err != nil {
			t.Fatal(err)
		}
		for j := 0; j <= i; j++ {
			file := filepath.Join(suite, fmt.Sprintf("fixture-%02d.json", j))
			if err := os.WriteFile(file, []byte(`{}`), 0644); err != nil {
				t.Fatal(err)
			}
			want = append(want, file)
		}
		if err := os.WriteFile(filepath.Join(suite, "README.md"), nil, 0644); err != nil {
			t.Fatal(err)
		}
	}
	for _, workers := range []int{1, 4, 32} {
		shards, err := conformanceShards(root, workers)
		if err != nil {
			t.Fatal(err)
		}
		seen := map[string]bool{}
		min, max := len(want), 0
		for _, shard := range shards {
			if len(shard) < min {
				min = len(shard)
			}
			if len(shard) > max {
				max = len(shard)
			}
			for _, file := range shard {
				if seen[file] {
					t.Fatalf("duplicate fixture: %s", file)
				}
				seen[file] = true
			}
		}
		if max-min > 1 {
			t.Fatalf("unbalanced shard sizes: %d..%d", min, max)
		}
		for _, file := range want {
			if !seen[file] {
				t.Fatalf("missing fixture: %s", file)
			}
		}
		if len(seen) != len(want) {
			t.Fatalf("got %d fixtures, want %d", len(seen), len(want))
		}
	}
	if _, err := conformanceShards(t.TempDir(), 4); err == nil {
		t.Fatal("missing suites must fail")
	}
}

func TestConformanceShardsRejectMissingResults(t *testing.T) {
	for _, tc := range []struct {
		output string
		fail   bool
	}{
		{"ok one\nok two", false},
		{"ok one\nskip two: requires lone surrogates", false},
		{"ok one", true},
		{"ok one\nok two\nok extra", true},
	} {
		report := VerifyTargetReport{Target: "cpp"}
		err := runConformanceShards(&report, [][]string{{"one", "two"}}, func([]string) (string, error) { return tc.output, nil })
		if (err != nil) != tc.fail {
			t.Fatalf("output %q: error %v, want failure %v", tc.output, err, tc.fail)
		}
	}
}

func TestConformanceShardsPropagateFailureAndWait(t *testing.T) {
	var finished atomic.Int32
	report := VerifyTargetReport{Target: "cpp"}
	err := runConformanceShards(&report, [][]string{{"bad"}, {"good"}}, func(files []string) (string, error) {
		defer finished.Add(1)
		if files[0] == "bad" {
			return "assertion failed", fmt.Errorf("exit 1")
		}
		time.Sleep(10 * time.Millisecond)
		return "ok good", nil
	})
	if err == nil || !strings.Contains(err.Error(), "shard 1/2: exit 1") {
		t.Fatalf("error = %v", err)
	}
	if finished.Load() != 2 {
		t.Fatal("returned before other workers finished")
	}
	if report.Steps[0].Status != "fail" {
		t.Fatal("failure did not reach the verification report")
	}
}

func TestConformanceWorkerSettings(t *testing.T) {
	for _, value := range []string{"0", "-1", "1.5", "33", "bad"} {
		t.Setenv("AXIR_CONFORMANCE_WORKERS", value)
		if _, err := conformanceWorkers(); err == nil {
			t.Fatalf("accepted invalid worker setting %q", value)
		}
	}
	t.Setenv("AXIR_CONFORMANCE_WORKERS", "4")
	if workers, err := conformanceWorkers(); err != nil || workers != 4 {
		t.Fatalf("workers %d, error %v", workers, err)
	}
}

func TestConformanceSequentialUsesSuiteDirectories(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell stand-in runner")
	}
	t.Setenv("AXIR_CONFORMANCE_WORKERS", "1")
	root := t.TempDir()
	for _, suite := range conformanceSuitePaths(root) {
		if err := os.MkdirAll(suite, 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(suite, "fixture.json"), []byte(`{}`), 0644); err != nil {
			t.Fatal(err)
		}
	}
	report := VerifyTargetReport{Target: "cpp"}
	script := `for suite in "$@"; do
    test -d "$suite" || exit 1
    for fixture in "$suite"/*.json; do echo "ok $fixture"; done
  done`
	if err := runConformanceVerifyCommand(&report, root, "", nil, "sh", "-c", script, "runner"); err != nil {
		t.Fatal(err)
	}
	if countConformanceFixtures(report.Steps[0].Message) != 12 {
		t.Fatal("lost sequential fixtures")
	}
}
