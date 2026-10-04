package axir

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
)

func conformanceWorkers() (int, error) {
	value := os.Getenv("AXIR_CONFORMANCE_WORKERS")
	if value == "" {
		return 1, nil
	}
	workers, err := strconv.Atoi(value)
	if err != nil || workers < 1 || workers > 32 {
		return 0, fmt.Errorf("AXIR_CONFORMANCE_WORKERS must be an integer from 1 to 32")
	}
	return workers, nil
}

// Interleave sorted fixture paths rather than assigning whole suites: axai
// and axagent take much longer than the schema and signature suites.
func conformanceShards(root string, workers int) ([][]string, error) {
	shards := make([][]string, workers)
	count := 0
	for _, suite := range conformanceSuitePaths(root) {
		entries, err := os.ReadDir(suite)
		if err != nil {
			return nil, err
		}
		for _, entry := range entries {
			if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
				continue
			}
			shards[count%workers] = append(shards[count%workers], filepath.Join(suite, entry.Name()))
			count++
		}
	}
	if count == 0 {
		return nil, fmt.Errorf("conformance ran 0 fixtures; check that the conformance root exists")
	}
	if count < workers {
		shards = shards[:count]
	}
	return shards, nil
}

func runConformanceVerifyCommand(report *VerifyTargetReport, root, dir string, env []string, command string, prefix ...string) error {
	workers, err := conformanceWorkers()
	if err != nil {
		return err
	}
	shards, err := conformanceShards(root, workers)
	if err != nil {
		return err
	}
	return runConformanceShards(report, shards, func(fixtures []string) (string, error) {
		args := append(append([]string{}, prefix...), fixtures...)
		return runCommandMessage(dir, env, command, args...)
	})
}

func runConformanceShards(report *VerifyTargetReport, shards [][]string, run func([]string) (string, error)) error {
	start := report.startStep("conformance")
	messages := make([]string, len(shards))
	failures := make([]error, len(shards))
	var wg sync.WaitGroup
	for index, fixtures := range shards {
		wg.Add(1)
		go func(index int, fixtures []string) {
			defer wg.Done()
			message, err := run(fixtures)
			// A successful exit alone is insufficient: a runner could ignore
			// a file argument. Account for every assigned fixture, including
			// the explicit capability skips used by UTF-8-only runners.
			reported := countConformanceFixtures(message)
			for _, line := range strings.Split(message, "\n") {
				if strings.HasPrefix(strings.TrimSpace(line), "skip ") {
					reported++
				}
			}
			if err == nil && reported != len(fixtures) {
				err = fmt.Errorf("reported %d of %d assigned fixtures", reported, len(fixtures))
			}
			messages[index] = fmt.Sprintf("shard %d/%d: %d fixtures\n%s", index+1, len(shards), len(fixtures), message)
			if err != nil {
				failures[index] = fmt.Errorf("shard %d/%d: %w", index+1, len(shards), err)
			}
		}(index, fixtures)
	}
	wg.Wait()
	message := strings.Join(messages, "\n")
	for _, err := range failures {
		if err != nil {
			report.finishStep("conformance", "fail", message, start)
			return fmt.Errorf("conformance failed: %w\n%s", err, message)
		}
	}
	report.finishStep("conformance", "ok", message, start)
	return nil
}
