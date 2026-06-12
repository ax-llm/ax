package axir

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
)

// CoverageReport describes which registry functions a target's conformance
// run actually executed, per the AXIR_COVERAGE_FILE trace.
type CoverageReport struct {
	Target      string   `json:"target"`
	Total       int      `json:"total"`
	Exercised   []string `json:"exercised"`
	Unexercised []string `json:"unexercised"`
}

// ParseCoverageTrace reads a coverage trace file (one function name per
// line, duplicates tolerated) into a set.
func ParseCoverageTrace(path string) (map[string]bool, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	seen := map[string]bool{}
	for _, line := range strings.Split(string(data), "\n") {
		name := strings.TrimSpace(line)
		if name != "" {
			seen[name] = true
		}
	}
	return seen, nil
}

// AuditCoverage diffs a traced name set against the registry. Unknown traced
// names (helpers, future drift) are ignored; only registry functions count.
func AuditCoverage(specs []CoreFuncSpec, target string, traced map[string]bool) CoverageReport {
	report := CoverageReport{Target: target, Total: len(specs)}
	for _, spec := range specs {
		if traced[spec.Name] {
			report.Exercised = append(report.Exercised, spec.Name)
		} else {
			report.Unexercised = append(report.Unexercised, spec.Name)
		}
	}
	sort.Strings(report.Exercised)
	sort.Strings(report.Unexercised)
	return report
}

// UnexercisedByModule groups a report's unexercised names by emit module.
func UnexercisedByModule(specs []CoreFuncSpec, report CoverageReport) map[string][]string {
	moduleOf := map[string]string{}
	for _, spec := range specs {
		moduleOf[spec.Name] = spec.Module
	}
	grouped := map[string][]string{}
	for _, name := range report.Unexercised {
		module := moduleOf[name]
		grouped[module] = append(grouped[module], name)
	}
	for _, names := range grouped {
		sort.Strings(names)
	}
	return grouped
}

// CoverageAsymmetries returns, for every function exercised by at least one
// target but not all, the per-target presence — the wiring-gap signal.
func CoverageAsymmetries(reports []CoverageReport) map[string][]string {
	exercisedBy := map[string][]string{}
	for _, report := range reports {
		for _, name := range report.Exercised {
			exercisedBy[name] = append(exercisedBy[name], report.Target)
		}
	}
	asymmetries := map[string][]string{}
	for name, targets := range exercisedBy {
		if len(targets) < len(reports) {
			sort.Strings(targets)
			asymmetries[name] = targets
		}
	}
	return asymmetries
}

// RunCoverageConformance builds the target's conformance runner inside its
// generated package directory and runs all suites with AXIR_COVERAGE_FILE
// set, mirroring the verify-step recipes.
func RunCoverageConformance(target, outDir, conformanceRoot, traceFile string) error {
	env := append(scrubbedEnviron(), "AXIR_COVERAGE_FILE="+traceFile)
	env = runtimeProtocolEnv(conformanceRoot, env)
	suites := conformanceSuitePaths(conformanceRoot)
	run := func(dir, command string, args ...string) error {
		message, err := runCommandMessage(dir, env, command, args...)
		if err != nil {
			return fmt.Errorf("%s coverage conformance: %w\n%s", target, err, message)
		}
		return nil
	}
	switch target {
	case "python":
		python, err := exec.LookPath("python3")
		if err != nil {
			return err
		}
		pyEnv := append([]string{}, env...)
		pyEnv = append(pyEnv, "PYTHONPATH="+outDir)
		message, err := runCommandMessage("", pyEnv, python, append([]string{"-m", "axllm.conformance"}, suites...)...)
		if err != nil {
			return fmt.Errorf("python coverage conformance: %w\n%s", err, message)
		}
		return nil
	case "go":
		goTool, err := exec.LookPath("go")
		if err != nil {
			return err
		}
		return run(outDir, goTool, append([]string{"run", "./conformance"}, suites...)...)
	case "rust":
		cargo, err := exec.LookPath("cargo")
		if err != nil {
			return err
		}
		args := append([]string{"run", "--quiet", "--manifest-path", filepath.Join(outDir, "Cargo.toml"), "--bin", "axllm-conformance", "--"}, suites...)
		return run(outDir, cargo, args...)
	case "java":
		javac, err := findJavaTool("javac")
		if err != nil {
			return err
		}
		java, err := findJavaTool("java")
		if err != nil {
			return err
		}
		files, err := filepath.Glob(filepath.Join(outDir, "dev", "axllm", "ax", "*.java"))
		if err != nil {
			return err
		}
		sort.Strings(files)
		if err := run("", javac, append([]string{"-cp", outDir, "-d", outDir}, files...)...); err != nil {
			return err
		}
		return run("", java, append([]string{"-cp", outDir, "dev.axllm.ax.Conformance"}, suites...)...)
	case "cpp":
		cpp, err := findCppCompiler()
		if err != nil {
			return err
		}
		buildDir := filepath.Join(outDir, "_coverage_cpp")
		if err := os.MkdirAll(buildDir, 0o755); err != nil {
			return err
		}
		axObj := filepath.Join(buildDir, "axllm.o")
		mcpObj := filepath.Join(buildDir, "mcp.o")
		if err := run("", cpp, "-std=c++17", "-I", outDir, "-c", filepath.Join(outDir, "axllm", "axllm.cpp"), "-o", axObj); err != nil {
			return err
		}
		if err := run("", cpp, "-std=c++17", "-I", outDir, "-c", filepath.Join(outDir, "axllm", "mcp.cpp"), "-o", mcpObj); err != nil {
			return err
		}
		conformanceBin := filepath.Join(buildDir, "conformance")
		if err := run("", cpp, "-std=c++17", "-I", outDir, filepath.Join(outDir, "conformance.cpp"), axObj, mcpObj, "-o", conformanceBin); err != nil {
			return err
		}
		return run("", conformanceBin, suites...)
	default:
		return fmt.Errorf("coverage audit does not support target %q", target)
	}
}
