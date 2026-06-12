package axir

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	VerifyModeDev     = "dev"
	VerifyModeRelease = "release"
)

type VerifyOptions struct {
	Targets         []string
	WorkDir         string
	RuntimeProfiles []string
	Mode            string
	Jobs            int
	Progress        bool
}

type VerifyReport struct {
	Root    string
	WorkDir string
	Mode    string
	Jobs    int
	Targets []VerifyTargetReport
}

type VerifyTargetReport struct {
	Target string
	OutDir string
	Steps  []VerifyStep

	mode     string
	progress *verifyProgress
}

type VerifyStep struct {
	Name     string
	Status   string
	Message  string
	Duration time.Duration
}

func Verify(rootFile string, opts VerifyOptions) (VerifyReport, error) {
	targets := normalizeVerifyTargets(opts.Targets)
	mode, err := normalizeVerifyMode(opts.Mode)
	if err != nil {
		return VerifyReport{}, err
	}
	bundle, err := LoadBundle(rootFile)
	if err != nil {
		return VerifyReport{}, err
	}
	if ds := Check(bundle); ds.HasErrors() {
		return VerifyReport{}, ds
	}
	workDir := opts.WorkDir
	if workDir == "" {
		if mode == VerifyModeDev {
			workDir = stableDevVerifyWorkDir(rootFile)
		} else {
			workDir, err = os.MkdirTemp("", "axir-verify-")
			if err != nil {
				return VerifyReport{}, err
			}
		}
	}
	if err := os.MkdirAll(workDir, 0o755); err != nil {
		return VerifyReport{}, err
	}
	if mode == VerifyModeDev {
		ensureDevVerifyCaches()
	}
	jobs := normalizeVerifyJobs(opts.Jobs, len(targets))
	report := VerifyReport{Root: rootFile, WorkDir: workDir, Mode: mode, Jobs: jobs}
	conformanceRoot := conformanceRootFor(rootFile)
	progress := &verifyProgress{enabled: opts.Progress}
	results := runVerifyTargets(targets, jobs, func(index int, target string) verifyTargetResult {
		return verifyOneTarget(index, target, bundle, workDir, conformanceRoot, opts.RuntimeProfiles, mode, progress)
	})
	failures := make([]string, 0)
	for _, result := range results {
		report.Targets = append(report.Targets, result.report)
		if result.err != nil {
			failures = append(failures, result.err.Error())
		}
		if result.failure != "" {
			failures = append(failures, result.failure)
		}
	}
	if len(failures) > 0 {
		return report, fmt.Errorf("axir verify failed: %s", strings.Join(failures, "; "))
	}
	return report, nil
}

type verifyTargetResult struct {
	index   int
	report  VerifyTargetReport
	failure string
	err     error
}

// scrubbedEnviron returns the process environment without provider endpoint
// or credential overrides (*_BASE_URL, *_API_KEY), so scripted verification
// steps (conformance fixtures, no-key examples, package smokes) cannot be
// skewed by the developer's shell.
func scrubbedEnviron() []string {
	var env []string
	for _, kv := range os.Environ() {
		name, _, ok := strings.Cut(kv, "=")
		if ok && (strings.HasSuffix(name, "_BASE_URL") || strings.HasSuffix(name, "_API_KEY")) {
			continue
		}
		env = append(env, kv)
	}
	return env
}

func verifyOneTarget(index int, target string, bundle Bundle, workDir string, conformanceRoot string, runtimeProfiles []string, mode string, progress *verifyProgress) verifyTargetResult {
	targetReport := VerifyTargetReport{
		Target:   target,
		OutDir:   filepath.Join(workDir, target),
		mode:     mode,
		progress: progress,
	}
	if err := os.RemoveAll(targetReport.OutDir); err != nil {
		return verifyTargetResult{index: index, report: targetReport, err: fmt.Errorf("%s cleanup: %v", target, err)}
	}
	start := targetReport.startStep("compile")
	if err := Compile(bundle, target, targetReport.OutDir); err != nil {
		targetReport.finishStep("compile", "fail", err.Error(), start)
		return verifyTargetResult{index: index, report: targetReport, failure: fmt.Sprintf("%s compile: %v", target, err)}
	}
	targetReport.finishStep("compile", "ok", targetReport.OutDir, start)
	start = targetReport.startStep("manifest")
	if err := verifyManifest(targetReport.OutDir, target); err != nil {
		targetReport.finishStep("manifest", "fail", err.Error(), start)
		return verifyTargetResult{index: index, report: targetReport, failure: fmt.Sprintf("%s manifest: %v", target, err)}
	}
	targetReport.finishStep("manifest", "ok", "axir-capabilities.json", start)
	start = targetReport.startStep("provenance")
	verifyModel, err := BuildRuntimeModel(LowerToCore(bundle))
	if err != nil {
		targetReport.finishStep("provenance", "fail", err.Error(), start)
		return verifyTargetResult{index: index, report: targetReport, failure: fmt.Sprintf("%s provenance: %v", target, err)}
	}
	provenance, err := AuditProvenanceDir(verifyModel, target, targetReport.OutDir)
	if err != nil {
		targetReport.finishStep("provenance", "fail", err.Error(), start)
		return verifyTargetResult{index: index, report: targetReport, failure: fmt.Sprintf("%s provenance: %v", target, err)}
	}
	switch {
	case provenance.Enforced && len(provenance.Violations) > 0:
		message := strings.Join(provenance.Violations, "; ")
		targetReport.finishStep("provenance", "fail", message, start)
		return verifyTargetResult{index: index, report: targetReport, failure: fmt.Sprintf("%s provenance: %s", target, message)}
	case provenance.Enforced:
		targetReport.finishStep("provenance", "ok", fmt.Sprintf("%d core functions emitted from IR", provenance.EmittedFunctions), start)
	default:
		targetReport.finishStep("provenance", "skip", "report-only until this target emits Core bodies", start)
	}
	var targetErr error
	switch target {
	case "python":
		targetReport, targetErr = verifyPythonTarget(targetReport, conformanceRoot)
	case "java":
		targetReport, targetErr = verifyJavaTarget(targetReport, conformanceRoot)
	case "cpp":
		targetReport, targetErr = verifyCppTarget(targetReport, conformanceRoot)
	case "go":
		targetReport, targetErr = verifyGoTarget(targetReport, conformanceRoot)
	case "rust":
		targetReport, targetErr = verifyRustTarget(targetReport, conformanceRoot)
	default:
		targetErr = fmt.Errorf("unknown verify target %q", target)
	}
	if targetErr != nil {
		return verifyTargetResult{index: index, report: targetReport, failure: fmt.Sprintf("%s: %v", target, targetErr)}
	}
	if len(runtimeProfiles) > 0 {
		var profileErr error
		targetReport, profileErr = verifyRuntimeProfilesTarget(targetReport, target, runtimeProfiles, conformanceRoot, bundle)
		if profileErr != nil {
			return verifyTargetResult{index: index, report: targetReport, failure: fmt.Sprintf("%s runtime profiles: %v", target, profileErr)}
		}
	}
	return verifyTargetResult{index: index, report: targetReport}
}

func runVerifyTargets(targets []string, jobs int, run func(index int, target string) verifyTargetResult) []verifyTargetResult {
	results := make([]verifyTargetResult, len(targets))
	if jobs <= 1 || len(targets) <= 1 {
		for index, target := range targets {
			results[index] = run(index, target)
		}
		return results
	}
	type verifyJob struct {
		index  int
		target string
	}
	work := make(chan verifyJob)
	done := make(chan verifyTargetResult)
	var wg sync.WaitGroup
	for i := 0; i < jobs; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for job := range work {
				done <- run(job.index, job.target)
			}
		}()
	}
	go func() {
		for index, target := range targets {
			work <- verifyJob{index: index, target: target}
		}
		close(work)
		wg.Wait()
		close(done)
	}()
	for result := range done {
		results[result.index] = result
	}
	return results
}

func normalizeVerifyMode(mode string) (string, error) {
	mode = strings.TrimSpace(mode)
	if mode == "" {
		return VerifyModeRelease, nil
	}
	switch mode {
	case VerifyModeDev, VerifyModeRelease:
		return mode, nil
	default:
		return "", fmt.Errorf("unknown verify mode %q", mode)
	}
}

func normalizeVerifyJobs(jobs int, targetCount int) int {
	if targetCount <= 1 {
		return 1
	}
	if jobs == 0 {
		jobs = runtime.NumCPU()
	}
	if jobs < 1 {
		jobs = 1
	}
	if jobs > targetCount {
		jobs = targetCount
	}
	return jobs
}

func stableDevVerifyWorkDir(rootFile string) string {
	abs, err := filepath.Abs(rootFile)
	if err != nil {
		abs = rootFile
	}
	sum := sha256.Sum256([]byte(abs))
	return filepath.Join(os.TempDir(), "axir-verify-dev-"+fmt.Sprintf("%x", sum[:])[:12])
}

func ensureDevVerifyCaches() {
	if strings.TrimSpace(os.Getenv("GOCACHE")) == "" {
		_ = os.Setenv("GOCACHE", filepath.Join(os.TempDir(), "go-build"))
	}
	if strings.TrimSpace(os.Getenv("CARGO_TARGET_DIR")) == "" {
		_ = os.Setenv("CARGO_TARGET_DIR", filepath.Join(os.TempDir(), "axir-cargo-target"))
	}
}

func verifyRuntimeProfilesTarget(report VerifyTargetReport, target string, profiles []string, conformanceRoot string, bundle Bundle) (VerifyTargetReport, error) {
	for _, profile := range normalizeVerifyTargets(profiles) {
		switch profile {
		case "javascript-quickjs":
			var err error
			switch target {
			case "python":
				report, err = verifyPythonQuickJSProfile(report, conformanceRoot, bundle)
			case "java":
				report, err = verifyJavaQuickJSProfile(report)
			case "cpp":
				report, err = verifyCppQuickJSProfile(report)
			case "go":
				report.Steps = append(report.Steps, VerifyStep{Name: "runtime profile javascript-quickjs", Status: "skip", Message: "Go uses javascript-goja for built-in JavaScript actor execution; use ProcessCodeRuntime for external QuickJS protocol servers"})
			case "rust":
				report, err = verifyRustQuickJSProfile(report)
			default:
				err = fmt.Errorf("unknown target %q", target)
			}
			if err != nil {
				return report, err
			}
		case "javascript-goja":
			if target == "go" {
				var err error
				report, err = verifyGoGojaProfile(report)
				if err != nil {
					return report, err
				}
			} else if target == "rust" {
				report.Steps = append(report.Steps, VerifyStep{Name: "runtime profile javascript-goja", Status: "skip", Message: "javascript-goja is a Go-native runtime profile; Rust uses the process runtime boundary"})
			} else {
				report.Steps = append(report.Steps, VerifyStep{Name: "runtime profile javascript-goja", Status: "skip", Message: "javascript-goja is a Go-native runtime profile"})
			}
		case "python-pyodide":
			var err error
			switch target {
			case "python":
				report, err = verifyPythonPyodideProfile(report, conformanceRoot)
			case "java":
				report, err = verifyJavaPyodideProfile(report, conformanceRoot)
			case "cpp":
				report, err = verifyCppPyodideProfile(report)
			case "go":
				report.Steps = append(report.Steps, VerifyStep{Name: "runtime profile python-pyodide", Status: "skip", Message: "Go uses the process runtime boundary; optional Pyodide profile verification is deferred"})
			case "rust":
				report.Steps = append(report.Steps, VerifyStep{Name: "runtime profile python-pyodide", Status: "skip", Message: "Rust uses the process runtime boundary; optional Pyodide profile verification is deferred"})
			default:
				err = fmt.Errorf("unknown target %q", target)
			}
			if err != nil {
				return report, err
			}
		default:
			return report, fmt.Errorf("unknown runtime profile %q", profile)
		}
	}
	return report, nil
}

type verifyProgress struct {
	enabled bool
	mu      sync.Mutex
}

func (p *verifyProgress) start(target, name string) {
	if p == nil || !p.enabled {
		return
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	fmt.Fprintf(os.Stderr, "[%s] start %s\n", target, name)
}

func (p *verifyProgress) finish(target, name, status string, duration time.Duration) {
	if p == nil || !p.enabled {
		return
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	fmt.Fprintf(os.Stderr, "[%s] %s %s (%s)\n", target, status, name, formatVerifyDuration(duration))
}

func (r *VerifyTargetReport) startStep(name string) time.Time {
	if r.progress != nil {
		r.progress.start(r.Target, name)
	}
	return time.Now()
}

func (r *VerifyTargetReport) finishStep(name, status, message string, start time.Time) {
	duration := time.Duration(0)
	if !start.IsZero() {
		duration = time.Since(start)
	}
	r.Steps = append(r.Steps, VerifyStep{Name: name, Status: status, Message: message, Duration: duration})
	if r.progress != nil && !start.IsZero() {
		r.progress.finish(r.Target, name, status, duration)
	}
}

func (r *VerifyTargetReport) skipPackageSmoke(name string) {
	r.finishStep(name, "skip", "dev mode; use --mode release to run package-consumer smoke tests", time.Time{})
}

func (r *VerifyTargetReport) releaseMode() bool {
	return r.mode == VerifyModeRelease
}

func verifyGoGojaProfile(report VerifyTargetReport) (VerifyTargetReport, error) {
	goTool, err := exec.LookPath("go")
	if err != nil {
		report.Steps = append(report.Steps, VerifyStep{Name: "runtime profile javascript-goja", Status: "skip", Message: "go not found"})
		return report, nil
	}
	if err := runVerifyCommand(&report, "runtime profile javascript-goja", report.OutDir, scrubbedEnviron(), goTool, "run", "./examples/runtime_profiles/javascript_goja"); err != nil {
		return report, err
	}
	return report, nil
}

func verifyRustQuickJSProfile(report VerifyTargetReport) (VerifyTargetReport, error) {
	cargo, err := exec.LookPath("cargo")
	if err != nil {
		report.Steps = append(report.Steps, VerifyStep{Name: "runtime profile javascript-quickjs cargo", Status: "skip", Message: "cargo not found"})
		return report, nil
	}
	if err := runCargoVerifyCommand(&report, "runtime profile javascript-quickjs", report.OutDir, scrubbedEnviron(), cargo, "run", "--quiet", "--manifest-path", filepath.Join(report.OutDir, "Cargo.toml"), "--features", "runtime-quickjs", "--example", "javascript_quickjs"); err != nil {
		return report, err
	}
	return report, nil
}

func normalizeVerifyTargets(targets []string) []string {
	if len(targets) == 0 {
		return []string{"python", "java", "cpp", "go", "rust"}
	}
	out := make([]string, 0, len(targets))
	seen := map[string]bool{}
	for _, target := range targets {
		target = strings.TrimSpace(target)
		if target == "" || seen[target] {
			continue
		}
		seen[target] = true
		out = append(out, target)
	}
	return out
}

func verifyGoTarget(report VerifyTargetReport, conformanceRoot string) (VerifyTargetReport, error) {
	goTool, err := exec.LookPath("go")
	if err != nil {
		report.Steps = append(report.Steps, VerifyStep{Name: "go", Status: "skip", Message: "go not found"})
		return report, nil
	}
	env := runtimeProtocolEnv(conformanceRoot, scrubbedEnviron())
	if err := runVerifyCommand(&report, "go test", report.OutDir, env, goTool, "test", "./..."); err != nil {
		return report, err
	}
	for _, example := range []string{
		"signature_schema",
		"axgen_scripted_client_tool",
		"provider_mapping_no_key",
		"provider_stream_no_key",
		"axagent_pipeline",
		"audio_responses_mapping",
		"realtime_audio_events",
		"runtime_adapter",
		"runtime_protocol",
		"axflow_program_graph",
		"optimizer_artifact",
		"gepa_local_optimizer",
		"mcp_scripted_tools",
	} {
		if err := runVerifyCommand(&report, "example "+example, report.OutDir, env, goTool, "run", "./examples/"+example); err != nil {
			return report, err
		}
	}
	args := append([]string{"run", "./conformance"}, conformanceSuitePaths(conformanceRoot)...)
	if err := runVerifyCommand(&report, "conformance", report.OutDir, env, goTool, args...); err != nil {
		return report, err
	}
	if report.releaseMode() {
		if err := verifyGoPackageSmoke(&report, goTool); err != nil {
			return report, err
		}
	} else {
		report.skipPackageSmoke("package go consumer")
	}
	return report, nil
}

func verifyGoPackageSmoke(report *VerifyTargetReport, goTool string) error {
	consumerDir := filepath.Join(report.OutDir, "_package_go_consumer")
	if err := os.RemoveAll(consumerDir); err != nil {
		return err
	}
	if err := os.MkdirAll(consumerDir, 0o755); err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(consumerDir, "go.mod"), []byte(`module axllm_consumer

go 1.22

require github.com/ax-llm/ax/go v0.0.0

replace github.com/ax-llm/ax/go => ..
`), 0o644); err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(consumerDir, "main.go"), []byte(`package main

import (
	"fmt"

	ax "github.com/ax-llm/ax/go"
)

func main() {
	sig := ax.NewSignature("question:string -> answer:string")
	if len(sig.GetOutputFields()) != 1 {
		panic("missing output field")
	}
	fmt.Println("go-package-consumer-ok", sig.GetOutputFields()[0].Name)
}
`), 0o644); err != nil {
		return err
	}
	return runVerifyCommand(report, "package go consumer", consumerDir, scrubbedEnviron(), goTool, "run", ".")
}

func verifyRustTarget(report VerifyTargetReport, conformanceRoot string) (VerifyTargetReport, error) {
	cargo, err := exec.LookPath("cargo")
	if err != nil {
		report.Steps = append(report.Steps, VerifyStep{Name: "cargo", Status: "skip", Message: "cargo not found"})
		return report, nil
	}
	env := runtimeProtocolEnv(conformanceRoot, scrubbedEnviron())
	if err := runVerifyCommand(&report, "cargo fmt", report.OutDir, env, cargo, "fmt", "--check", "--manifest-path", filepath.Join(report.OutDir, "Cargo.toml")); err != nil {
		return report, err
	}
	if err := runCargoVerifyCommand(&report, "cargo test", report.OutDir, env, cargo, "test", "--manifest-path", filepath.Join(report.OutDir, "Cargo.toml"), "--all-targets"); err != nil {
		return report, err
	}
	for _, example := range []string{
		"signature_schema",
		"provider_mapping_no_key",
		"provider_stream_no_key",
		"axgen_scripted_client_tool",
		"axagent_pipeline",
		"audio_responses_mapping",
		"realtime_audio_events",
		"runtime_adapter",
		"runtime_protocol",
		"axflow_program_graph",
		"optimizer_artifact",
		"gepa_local_optimizer",
		"mcp_scripted_tools",
	} {
		if err := runCargoVerifyCommand(&report, "example "+example, report.OutDir, env, cargo, "run", "--quiet", "--manifest-path", filepath.Join(report.OutDir, "Cargo.toml"), "--example", example); err != nil {
			return report, err
		}
	}
	args := append([]string{"run", "--quiet", "--manifest-path", filepath.Join(report.OutDir, "Cargo.toml"), "--bin", "axllm-conformance", "--"}, conformanceSuitePaths(conformanceRoot)...)
	if err := runCargoVerifyCommand(&report, "conformance", report.OutDir, env, cargo, args...); err != nil {
		return report, err
	}
	if report.releaseMode() {
		if err := verifyRustPackageSmoke(&report, cargo); err != nil {
			return report, err
		}
	} else {
		report.skipPackageSmoke("package rust consumer")
	}
	return report, nil
}

func verifyRustPackageSmoke(report *VerifyTargetReport, cargo string) error {
	consumerDir := filepath.Join(report.OutDir, "_package_rust_consumer")
	if err := os.RemoveAll(consumerDir); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Join(consumerDir, "src"), 0o755); err != nil {
		return err
	}
	cargoToml := `[package]
name = "axllm_consumer"
version = "0.0.0"
edition = "2021"

[dependencies]
axllm = { path = ".." }
`
	if err := os.WriteFile(filepath.Join(consumerDir, "Cargo.toml"), []byte(cargoToml), 0o644); err != nil {
		return err
	}
	mainRs := `use axllm::{s, AxResult};

fn main() -> AxResult<()> {
    let sig = s("question:string -> answer:string")?;
    println!("rust-package-consumer-ok {}", sig.get_output_fields()[0].name);
    Ok(())
}
`
	if err := os.WriteFile(filepath.Join(consumerDir, "src", "main.rs"), []byte(mainRs), 0o644); err != nil {
		return err
	}
	return runCargoVerifyCommand(report, "package rust consumer", consumerDir, scrubbedEnviron(), cargo, "run", "--quiet", "--manifest-path", filepath.Join(consumerDir, "Cargo.toml"))
}

func conformanceRootFor(rootFile string) string {
	axcoreDir := filepath.Dir(rootFile)
	irDir := filepath.Dir(axcoreDir)
	return filepath.Join(irDir, "conformance")
}

func (r VerifyReport) String() string {
	var b strings.Builder
	fmt.Fprintf(&b, "AxIR verify: %s\n", filepath.Clean(r.Root))
	fmt.Fprintf(&b, "mode: %s\n", r.Mode)
	fmt.Fprintf(&b, "jobs: %d\n", r.Jobs)
	fmt.Fprintf(&b, "workdir: %s\n", filepath.Clean(r.WorkDir))
	for _, target := range r.Targets {
		fmt.Fprintf(&b, "%s: %s\n", target.Target, filepath.Clean(target.OutDir))
		for _, step := range target.Steps {
			duration := ""
			if step.Duration > 0 {
				duration = " (" + formatVerifyDuration(step.Duration) + ")"
			}
			if step.Message == "" {
				fmt.Fprintf(&b, "  %s %s%s\n", step.Status, step.Name, duration)
			} else {
				fmt.Fprintf(&b, "  %s %s%s: %s\n", step.Status, step.Name, duration, step.Message)
			}
		}
	}
	return b.String()
}

func verifyManifest(outDir, target string) error {
	data, err := os.ReadFile(filepath.Join(outDir, "axir-capabilities.json"))
	if err != nil {
		return err
	}
	var manifest CapabilityManifest
	if err := json.Unmarshal(data, &manifest); err != nil {
		return fmt.Errorf("read axir-capabilities.json: %w", err)
	}
	if !bytes.Contains(data, []byte(`"target": "`+target+`"`)) {
		return fmt.Errorf("manifest missing target %q", target)
	}
	for _, suite := range []string{"signature", "schema", "validation", "prompt", "axgen", "axai", "axagent", "axoptimize", "axprogram", "axflow"} {
		if !bytes.Contains(data, []byte(`"`+suite+`"`)) {
			return fmt.Errorf("manifest missing suite %q", suite)
		}
	}
	coverageData, err := os.ReadFile(filepath.Join(outDir, "conformance-coverage.json"))
	if err != nil {
		return err
	}
	var coverage ConformanceCoverageManifest
	if err := json.Unmarshal(coverageData, &coverage); err != nil {
		return fmt.Errorf("read conformance-coverage.json: %w", err)
	}
	if err := ValidateConformanceCoverage(manifest, coverage); err != nil {
		return err
	}
	return nil
}

func verifyPythonTarget(report VerifyTargetReport, conformanceRoot string) (VerifyTargetReport, error) {
	python, err := exec.LookPath("python3")
	if err != nil {
		report.Steps = append(report.Steps, VerifyStep{Name: "python3", Status: "skip", Message: "python3 not found"})
		return report, nil
	}
	env := runtimeProtocolEnv(conformanceRoot, append(scrubbedEnviron(), "PYTHONPATH="+report.OutDir))
	if err := runVerifyCommand(&report, "compileall", "", env, python, "-m", "compileall", "-q", filepath.Join(report.OutDir, "axllm")); err != nil {
		return report, err
	}
	for _, example := range []string{
		"signature_schema.py",
		"axgen_scripted_client_tool.py",
		"provider_mapping_no_key.py",
		"provider_stream_no_key.py",
		"axagent_pipeline.py",
		"audio_responses_mapping.py",
		"realtime_audio_events.py",
		"runtime_adapter.py",
		"runtime_protocol.py",
		"axflow_program_graph.py",
		"optimizer_artifact.py",
		"gepa_local_optimizer.py",
		"mcp_scripted_tools.py",
	} {
		if err := runVerifyCommand(&report, "example "+example, "", env, python, filepath.Join(report.OutDir, "examples", example)); err != nil {
			return report, err
		}
	}
	args := append([]string{"-m", "axllm.conformance"}, conformanceSuitePaths(conformanceRoot)...)
	if err := runVerifyCommand(&report, "conformance", "", env, python, args...); err != nil {
		return report, err
	}
	if report.releaseMode() {
		if err := verifyPythonPackageSmoke(&report, conformanceRoot, python); err != nil {
			return report, err
		}
	} else {
		report.skipPackageSmoke("package python smoke")
	}
	return report, nil
}

func verifyPythonPackageSmoke(report *VerifyTargetReport, conformanceRoot string, python string) error {
	if err := exec.Command(python, "-m", "pip", "--version").Run(); err != nil {
		report.Steps = append(report.Steps, VerifyStep{Name: "package python install", Status: "skip", Message: "pip not available"})
		return nil
	}
	if err := exec.Command(python, "-c", "import setuptools.build_meta").Run(); err != nil {
		report.Steps = append(report.Steps, VerifyStep{Name: "package python install", Status: "skip", Message: "setuptools.build_meta not available"})
		env := runtimeProtocolEnv(conformanceRoot, append(scrubbedEnviron(), "PYTHONPATH="+report.OutDir))
		return runVerifyCommand(report, "package python source import", "", env, python, "-c", "import axllm; print('python-package-source-ok', axllm.s('question:string -> answer:string').to_json_schema()['type'])")
	}
	installDir := filepath.Join(report.OutDir, "_package_python", "site")
	if err := os.RemoveAll(installDir); err != nil {
		return err
	}
	if err := os.MkdirAll(installDir, 0o755); err != nil {
		return err
	}
	env := runtimeProtocolEnv(conformanceRoot, scrubbedEnviron())
	if err := runVerifyCommand(report, "package python install", "", env, python, "-m", "pip", "install", "--no-deps", "--no-build-isolation", "--target", installDir, report.OutDir); err != nil {
		return err
	}
	env = runtimeProtocolEnv(conformanceRoot, append(scrubbedEnviron(), "PYTHONPATH="+installDir))
	if err := runVerifyCommand(report, "package python import", "", env, python, "-c", "import axllm; print('python-package-ok', axllm.s('question:string -> answer:string').to_json_schema()['type'])"); err != nil {
		return err
	}
	return runVerifyCommand(report, "package python example", "", env, python, filepath.Join(report.OutDir, "examples", "signature_schema.py"))
}

func verifyPythonQuickJSProfile(report VerifyTargetReport, conformanceRoot string, bundle Bundle) (VerifyTargetReport, error) {
	server := strings.TrimSpace(os.Getenv("AXIR_QUICKJS_RUNTIME_SERVER"))
	serverSource := "AXIR_QUICKJS_RUNTIME_SERVER"
	if server == "" {
		var err error
		server, serverSource, err = quickJSJavaProtocolServerCommand(&report, bundle)
		if err != nil {
			return report, err
		}
		if server == "" {
			report.Steps = append(report.Steps, VerifyStep{Name: "runtime profile javascript-quickjs", Status: "skip", Message: "AXIR_QUICKJS_RUNTIME_SERVER not set and QuickJS4J classpath unavailable; use AXIR_QUICKJS_RUNTIME_SERVER, AXIR_QUICKJS4J_CP, AXIR_QUICKJS4J_CP_FILE, or AXIR_QUICKJS4J_RESOLVE=1"})
			return report, nil
		}
	}
	python, err := exec.LookPath("python3")
	if err != nil {
		report.Steps = append(report.Steps, VerifyStep{Name: "runtime profile javascript-quickjs", Status: "skip", Message: "python3 not found"})
		return report, nil
	}
	report.Steps = append(report.Steps, VerifyStep{Name: "runtime profile javascript-quickjs server", Status: "ok", Message: serverSource})
	env := runtimeProtocolEnv(conformanceRoot, append(scrubbedEnviron(), "PYTHONPATH="+report.OutDir, "AXIR_QUICKJS_RUNTIME_SERVER="+server))
	return report, runVerifyCommand(&report, "runtime profile javascript-quickjs", "", env, python, filepath.Join(report.OutDir, "examples", "runtime_profiles", "javascript_quickjs.py"))
}

func verifyPythonPyodideProfile(report VerifyTargetReport, conformanceRoot string) (VerifyTargetReport, error) {
	server, source, err := pyodideRuntimeServerCommand(report.OutDir, conformanceRoot)
	if err != nil {
		return report, err
	}
	if server == "" {
		report.Steps = append(report.Steps, VerifyStep{Name: "runtime profile python-pyodide", Status: "skip", Message: "AXIR_PYODIDE_RUNTIME_SERVER not set; use AXIR_PYODIDE_RESOLVE=1; see examples/runtime_profiles/README.md"})
		return report, nil
	}
	python, err := exec.LookPath("python3")
	if err != nil {
		report.Steps = append(report.Steps, VerifyStep{Name: "runtime profile python-pyodide", Status: "skip", Message: "python3 not found"})
		return report, nil
	}
	report.Steps = append(report.Steps, VerifyStep{Name: "runtime profile python-pyodide server", Status: "ok", Message: source})
	env := runtimeProtocolEnv(conformanceRoot, append(scrubbedEnviron(), "PYTHONPATH="+report.OutDir, "AXIR_PYODIDE_RUNTIME_SERVER="+server))
	return report, runVerifyCommand(&report, "runtime profile python-pyodide", "", env, python, filepath.Join(report.OutDir, "examples", "runtime_profiles", "python_pyodide.py"))
}

func verifyJavaTarget(report VerifyTargetReport, conformanceRoot string) (VerifyTargetReport, error) {
	javac, err := findJavaTool("javac")
	if err != nil {
		report.Steps = append(report.Steps, VerifyStep{Name: "javac", Status: "skip", Message: err.Error()})
		return report, nil
	}
	java, err := findJavaTool("java")
	if err != nil {
		report.Steps = append(report.Steps, VerifyStep{Name: "java", Status: "skip", Message: err.Error()})
		return report, nil
	}
	files, err := filepath.Glob(filepath.Join(report.OutDir, "dev", "axllm", "ax", "*.java"))
	if err != nil {
		return report, err
	}
	examples, err := filepath.Glob(filepath.Join(report.OutDir, "examples", "*.java"))
	if err != nil {
		return report, err
	}
	files = append(files, examples...)
	sort.Strings(files)
	args := append([]string{"-cp", report.OutDir, "-d", report.OutDir}, files...)
	env := runtimeProtocolEnv(conformanceRoot, scrubbedEnviron())
	if err := runVerifyCommand(&report, "javac", "", env, javac, args...); err != nil {
		return report, err
	}
	for _, className := range []string{
		"SignatureSchemaExample",
		"AxGenScriptedClientToolExample",
		"ProviderMappingNoKeyExample",
		"ProviderStreamNoKeyExample",
		"AxAgentPipelineExample",
		"AudioResponsesMappingExample",
		"RealtimeAudioEventsExample",
		"RuntimeAdapterExample",
		"RuntimeProtocolExample",
		"AxFlowProgramGraphExample",
		"OptimizerArtifactExample",
		"GEPALocalOptimizerExample",
		"AxMCPScriptedToolsExample",
	} {
		if err := runVerifyCommand(&report, "example "+className, "", env, java, "-cp", report.OutDir, className); err != nil {
			return report, err
		}
	}
	args = append([]string{"-cp", report.OutDir, "dev.axllm.ax.Conformance"}, conformanceSuitePaths(conformanceRoot)...)
	if err := runVerifyCommand(&report, "conformance", "", nil, java, args...); err != nil {
		return report, err
	}
	if report.releaseMode() {
		if err := verifyJavaPackageSmoke(&report, javac, java); err != nil {
			return report, err
		}
	} else {
		report.skipPackageSmoke("package java smoke")
	}
	return report, nil
}

func verifyJavaPackageSmoke(report *VerifyTargetReport, javac, java string) error {
	jar, err := findJarTool()
	if err != nil {
		report.Steps = append(report.Steps, VerifyStep{Name: "package java jar", Status: "skip", Message: err.Error()})
		return nil
	}
	pkgDir := filepath.Join(report.OutDir, "_package_java")
	classesDir := filepath.Join(pkgDir, "classes")
	exampleClassesDir := filepath.Join(pkgDir, "example-classes")
	if err := os.RemoveAll(pkgDir); err != nil {
		return err
	}
	if err := os.MkdirAll(classesDir, 0o755); err != nil {
		return err
	}
	baseFiles, err := filepath.Glob(filepath.Join(report.OutDir, "dev", "axllm", "ax", "*.java"))
	if err != nil {
		return err
	}
	sort.Strings(baseFiles)
	args := append([]string{"-d", classesDir}, baseFiles...)
	if err := runVerifyCommand(report, "package java compile", "", scrubbedEnviron(), javac, args...); err != nil {
		return err
	}
	jarPath := filepath.Join(pkgDir, "ax.jar")
	if err := runVerifyCommand(report, "package java jar", "", scrubbedEnviron(), jar, "--create", "--file", jarPath, "-C", classesDir, "."); err != nil {
		return err
	}
	if err := os.MkdirAll(exampleClassesDir, 0o755); err != nil {
		return err
	}
	example := filepath.Join(report.OutDir, "examples", "SignatureSchemaExample.java")
	if err := runVerifyCommand(report, "package java example compile", "", scrubbedEnviron(), javac, "-cp", jarPath, "-d", exampleClassesDir, example); err != nil {
		return err
	}
	classpath := jarPath + string(os.PathListSeparator) + exampleClassesDir
	if err := runVerifyCommand(report, "package java example", "", scrubbedEnviron(), java, "-cp", classpath, "SignatureSchemaExample"); err != nil {
		return err
	}
	if err := verifyOptionalJavaBuildTool(report, "maven package", "mvn", "AXIR_VERIFY_MAVEN", "-q", "-DskipTests", "package"); err != nil {
		return err
	}
	return verifyOptionalJavaBuildTool(report, "gradle package", "gradle", "AXIR_VERIFY_GRADLE", "--quiet", "jar")
}

func verifyOptionalJavaBuildTool(report *VerifyTargetReport, name, command, flag string, args ...string) error {
	if !envFlag(os.Getenv(flag)) {
		report.Steps = append(report.Steps, VerifyStep{Name: "package java " + name, Status: "skip", Message: "set " + flag + "=1 to run"})
		return nil
	}
	path, err := exec.LookPath(command)
	if err != nil {
		report.Steps = append(report.Steps, VerifyStep{Name: "package java " + name, Status: "skip", Message: command + " not found"})
		return nil
	}
	return runVerifyCommand(report, "package java "+name, report.OutDir, scrubbedEnviron(), path, args...)
}

func verifyJavaQuickJSProfile(report VerifyTargetReport) (VerifyTargetReport, error) {
	cp, cpSource, err := quickJS4JClasspath(report.OutDir)
	if err != nil {
		return report, err
	}
	if cp == "" {
		report.Steps = append(report.Steps, VerifyStep{Name: "runtime profile javascript-quickjs", Status: "skip", Message: "AXIR_QUICKJS4J_CP not set; use AXIR_QUICKJS4J_CP_FILE or AXIR_QUICKJS4J_RESOLVE=1; see examples/runtime_profiles/README.md"})
		return report, nil
	}
	javac, err := findJavaTool("javac")
	if err != nil {
		report.Steps = append(report.Steps, VerifyStep{Name: "runtime profile javascript-quickjs javac", Status: "skip", Message: err.Error()})
		return report, nil
	}
	java, err := findJavaTool("java")
	if err != nil {
		report.Steps = append(report.Steps, VerifyStep{Name: "runtime profile javascript-quickjs java", Status: "skip", Message: err.Error()})
		return report, nil
	}
	report.Steps = append(report.Steps, VerifyStep{Name: "runtime profile javascript-quickjs classpath", Status: "ok", Message: cpSource})
	files, err := filepath.Glob(filepath.Join(report.OutDir, "dev", "axllm", "ax", "*.java"))
	if err != nil {
		return report, err
	}
	profileFiles, err := filepath.Glob(filepath.Join(report.OutDir, "dev", "axllm", "ax", "runtime", "quickjs", "*.java"))
	if err != nil {
		return report, err
	}
	files = append(files, profileFiles...)
	files = append(files, filepath.Join(report.OutDir, "examples", "runtime_profiles", "JavaScriptQuickJsExample.java"))
	sort.Strings(files)
	classpath := report.OutDir + string(os.PathListSeparator) + cp
	args := append([]string{"-cp", classpath, "-d", report.OutDir}, files...)
	if err := runVerifyCommand(&report, "compile runtime profile javascript-quickjs", "", scrubbedEnviron(), javac, args...); err != nil {
		return report, err
	}
	if err := runVerifyCommand(&report, "runtime profile javascript-quickjs", "", scrubbedEnviron(), java, "-cp", classpath, "JavaScriptQuickJsExample"); err != nil {
		return report, err
	}
	if err := runVerifyCommand(&report, "runtime profile javascript-quickjs protocol server", "", scrubbedEnviron(), java, "-cp", classpath, "dev.axllm.ax.runtime.quickjs.AxQuickJsProtocolServer", "--self-test"); err != nil {
		return report, err
	}
	return report, nil
}

func verifyJavaPyodideProfile(report VerifyTargetReport, conformanceRoot string) (VerifyTargetReport, error) {
	server, source, err := pyodideRuntimeServerCommand(report.OutDir, conformanceRoot)
	if err != nil {
		return report, err
	}
	if server == "" {
		report.Steps = append(report.Steps, VerifyStep{Name: "runtime profile python-pyodide", Status: "skip", Message: "AXIR_PYODIDE_RUNTIME_SERVER not set; use AXIR_PYODIDE_RESOLVE=1; see examples/runtime_profiles/README.md"})
		return report, nil
	}
	javac, err := findJavaTool("javac")
	if err != nil {
		report.Steps = append(report.Steps, VerifyStep{Name: "runtime profile python-pyodide javac", Status: "skip", Message: err.Error()})
		return report, nil
	}
	java, err := findJavaTool("java")
	if err != nil {
		report.Steps = append(report.Steps, VerifyStep{Name: "runtime profile python-pyodide java", Status: "skip", Message: err.Error()})
		return report, nil
	}
	report.Steps = append(report.Steps, VerifyStep{Name: "runtime profile python-pyodide server", Status: "ok", Message: source})
	sourceFile := filepath.Join(report.OutDir, "examples", "runtime_profiles", "PythonPyodideExample.java")
	if err := runVerifyCommand(&report, "compile runtime profile python-pyodide", "", scrubbedEnviron(), javac, "-cp", report.OutDir, "-d", report.OutDir, sourceFile); err != nil {
		return report, err
	}
	env := runtimeProtocolEnv(conformanceRoot, append(scrubbedEnviron(), "AXIR_PYODIDE_RUNTIME_SERVER="+server))
	if err := runVerifyCommand(&report, "runtime profile python-pyodide", "", env, java, "-cp", report.OutDir, "PythonPyodideExample"); err != nil {
		return report, err
	}
	return report, nil
}

func quickJSJavaProtocolServerCommand(report *VerifyTargetReport, bundle Bundle) (string, string, error) {
	if !quickJS4JRequested() {
		return "", "", nil
	}
	javac, err := findJavaTool("javac")
	if err != nil {
		report.Steps = append(report.Steps, VerifyStep{Name: "runtime profile javascript-quickjs javac", Status: "skip", Message: err.Error()})
		return "", "", nil
	}
	java, err := findJavaTool("java")
	if err != nil {
		report.Steps = append(report.Steps, VerifyStep{Name: "runtime profile javascript-quickjs java", Status: "skip", Message: err.Error()})
		return "", "", nil
	}
	javaOutDir := filepath.Join(filepath.Dir(report.OutDir), "_quickjs4j_protocol_server")
	if err := os.RemoveAll(javaOutDir); err != nil {
		return "", "", err
	}
	if err := Compile(bundle, "java", javaOutDir); err != nil {
		return "", "", err
	}
	cp, cpSource, err := quickJS4JClasspath(javaOutDir)
	if err != nil {
		return "", "", err
	}
	if cp == "" {
		return "", "", nil
	}
	report.Steps = append(report.Steps, VerifyStep{Name: "runtime profile javascript-quickjs classpath", Status: "ok", Message: cpSource})
	files, err := filepath.Glob(filepath.Join(javaOutDir, "dev", "axllm", "ax", "*.java"))
	if err != nil {
		return "", "", err
	}
	profileFiles, err := filepath.Glob(filepath.Join(javaOutDir, "dev", "axllm", "ax", "runtime", "quickjs", "*.java"))
	if err != nil {
		return "", "", err
	}
	files = append(files, profileFiles...)
	sort.Strings(files)
	classpath := javaOutDir + string(os.PathListSeparator) + cp
	args := append([]string{"-cp", classpath, "-d", javaOutDir}, files...)
	if err := runVerifyCommand(report, "compile runtime profile javascript-quickjs server", "", scrubbedEnviron(), javac, args...); err != nil {
		return "", "", err
	}
	if err := runVerifyCommand(report, "runtime profile javascript-quickjs protocol server", "", scrubbedEnviron(), java, "-cp", classpath, "dev.axllm.ax.runtime.quickjs.AxQuickJsProtocolServer", "--self-test"); err != nil {
		return "", "", err
	}
	server := quoteCommandArg(java) + " -cp " + quoteCommandArg(classpath) + " dev.axllm.ax.runtime.quickjs.AxQuickJsProtocolServer"
	return server, "generated Java QuickJS4J protocol server via " + cpSource, nil
}

func pyodideRuntimeServerCommand(outDir, conformanceRoot string) (string, string, error) {
	if server := strings.TrimSpace(os.Getenv("AXIR_PYODIDE_RUNTIME_SERVER")); server != "" {
		return server, "AXIR_PYODIDE_RUNTIME_SERVER", nil
	}
	if !envFlag(os.Getenv("AXIR_PYODIDE_RESOLVE")) {
		return "", "", nil
	}
	sh, err := exec.LookPath("sh")
	if err != nil {
		return "", "", fmt.Errorf("AXIR_PYODIDE_RESOLVE=1 requires sh: %w", err)
	}
	script := filepath.Join(outDir, "examples", "runtime_profiles", "resolve_pyodide_runtime_server.sh")
	cmd := exec.Command(sh, script)
	cmd.Env = runtimeProtocolEnv(conformanceRoot, scrubbedEnviron())
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	message := strings.TrimSpace(string(out))
	if err != nil {
		if errText := strings.TrimSpace(stderr.String()); errText != "" {
			message = errText
		} else if message == "" {
			message = err.Error()
		}
		return "", "", fmt.Errorf("resolve Pyodide runtime server failed: %s", message)
	}
	if message == "" {
		return "", "", fmt.Errorf("resolve Pyodide runtime server returned empty output")
	}
	return message, "AXIR_PYODIDE_RESOLVE generated npm helper", nil
}

func quickJS4JRequested() bool {
	if strings.TrimSpace(os.Getenv("AXIR_QUICKJS4J_CP")) != "" {
		return true
	}
	if strings.TrimSpace(os.Getenv("AXIR_QUICKJS4J_CP_FILE")) != "" {
		return true
	}
	return envFlag(os.Getenv("AXIR_QUICKJS4J_RESOLVE"))
}

func quickJS4JClasspath(outDir string) (string, string, error) {
	if cp := strings.TrimSpace(os.Getenv("AXIR_QUICKJS4J_CP")); cp != "" {
		return cp, "AXIR_QUICKJS4J_CP", nil
	}
	if cpFile := strings.TrimSpace(os.Getenv("AXIR_QUICKJS4J_CP_FILE")); cpFile != "" {
		data, err := os.ReadFile(cpFile)
		if err != nil {
			return "", "", fmt.Errorf("read AXIR_QUICKJS4J_CP_FILE: %w", err)
		}
		cp := strings.TrimSpace(string(data))
		if cp == "" {
			return "", "", fmt.Errorf("AXIR_QUICKJS4J_CP_FILE %s is empty", cpFile)
		}
		return cp, "AXIR_QUICKJS4J_CP_FILE", nil
	}
	if !envFlag(os.Getenv("AXIR_QUICKJS4J_RESOLVE")) {
		return "", "", nil
	}
	sh, err := exec.LookPath("sh")
	if err != nil {
		return "", "", fmt.Errorf("AXIR_QUICKJS4J_RESOLVE=1 requires sh: %w", err)
	}
	script := filepath.Join(outDir, "examples", "runtime_profiles", "resolve_quickjs4j_cp.sh")
	cmd := exec.Command(sh, script)
	cmd.Env = scrubbedEnviron()
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	message := strings.TrimSpace(string(out))
	if err != nil {
		if errText := strings.TrimSpace(stderr.String()); errText != "" {
			message = errText
		} else if message == "" {
			message = err.Error()
		}
		return "", "", fmt.Errorf("resolve QuickJS4J classpath failed: %s", message)
	}
	if message == "" {
		return "", "", fmt.Errorf("resolve QuickJS4J classpath returned empty output")
	}
	return message, "AXIR_QUICKJS4J_RESOLVE generated Maven helper", nil
}

func quoteCommandArg(value string) string {
	if value == "" {
		return "''"
	}
	if !strings.ContainsAny(value, " \t\n'\"\\") {
		return value
	}
	return "'" + strings.ReplaceAll(value, "'", "'\"'\"'") + "'"
}

func envFlag(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}

func verifyCppTarget(report VerifyTargetReport, conformanceRoot string) (VerifyTargetReport, error) {
	cpp, err := findCppCompiler()
	if err != nil {
		report.Steps = append(report.Steps, VerifyStep{Name: "c++", Status: "skip", Message: err.Error()})
		return report, nil
	}
	axSource := filepath.Join(report.OutDir, "axllm", "axllm.cpp")
	mcpSource := filepath.Join(report.OutDir, "axllm", "mcp.cpp")
	buildDir := filepath.Join(report.OutDir, "_verify_cpp")
	if err := os.MkdirAll(buildDir, 0o755); err != nil {
		return report, err
	}
	axObj := filepath.Join(buildDir, "axllm.o")
	mcpObj := filepath.Join(buildDir, "mcp.o")
	if err := runVerifyCommand(&report, "compile axllm.cpp", "", nil, cpp, "-std=c++17", "-I", report.OutDir, "-c", axSource, "-o", axObj); err != nil {
		return report, err
	}
	if err := runVerifyCommand(&report, "compile mcp.cpp", "", nil, cpp, "-std=c++17", "-I", report.OutDir, "-c", mcpSource, "-o", mcpObj); err != nil {
		return report, err
	}
	examples := []string{
		"signature_schema",
		"axgen_scripted_client_tool",
		"provider_mapping_no_key",
		"provider_stream_no_key",
		"axagent_pipeline",
		"audio_responses_mapping",
		"realtime_audio_events",
		"runtime_adapter",
		"runtime_protocol",
		"axflow_program_graph",
		"optimizer_artifact",
		"gepa_local_optimizer",
		"mcp_scripted_tools",
	}
	for _, example := range examples {
		source := filepath.Join(report.OutDir, "examples", example+".cpp")
		bin := filepath.Join(report.OutDir, example)
		compileArgs := []string{"-std=c++17", "-I", report.OutDir, source, axObj}
		if example == "mcp_scripted_tools" {
			compileArgs = append(compileArgs, mcpObj)
		}
		compileArgs = append(compileArgs, "-o", bin)
		if err := runVerifyCommand(&report, "compile example "+example, "", nil, cpp, compileArgs...); err != nil {
			return report, err
		}
		if err := runVerifyCommand(&report, "example "+example, "", nil, bin); err != nil {
			return report, err
		}
	}
	conformanceBin := filepath.Join(report.OutDir, "conformance")
	if err := runVerifyCommand(&report, "compile conformance", "", nil, cpp, "-std=c++17", "-I", report.OutDir, filepath.Join(report.OutDir, "conformance.cpp"), axObj, mcpObj, "-o", conformanceBin); err != nil {
		return report, err
	}
	args := append([]string{}, conformanceSuitePaths(conformanceRoot)...)
	if err := runVerifyCommand(&report, "conformance", "", nil, conformanceBin, args...); err != nil {
		return report, err
	}
	if report.releaseMode() {
		if err := verifyCppPackageSmoke(&report, cpp, axObj, mcpObj); err != nil {
			return report, err
		}
	} else {
		report.skipPackageSmoke("package cpp smoke")
	}
	return report, nil
}

func verifyCppPackageSmoke(report *VerifyTargetReport, cpp string, axObj string, mcpObj string) error {
	ar, err := exec.LookPath("ar")
	if err != nil {
		report.Steps = append(report.Steps, VerifyStep{Name: "package cpp static library", Status: "skip", Message: "ar not found"})
		return nil
	}
	pkgDir := filepath.Join(report.OutDir, "_package_cpp")
	if err := os.RemoveAll(pkgDir); err != nil {
		return err
	}
	if err := os.MkdirAll(pkgDir, 0o755); err != nil {
		return err
	}
	lib := filepath.Join(pkgDir, "libaxllm.a")
	if axObj == "" {
		axObj = filepath.Join(pkgDir, "axllm.o")
		if err := runVerifyCommand(report, "package cpp compile library", "", nil, cpp, "-std=c++17", "-I", report.OutDir, "-c", filepath.Join(report.OutDir, "axllm", "axllm.cpp"), "-o", axObj); err != nil {
			return err
		}
	} else {
		report.finishStep("package cpp compile library", "ok", "reused "+filepath.Base(axObj), time.Time{})
	}
	arArgs := []string{"rcs", lib, axObj}
	if mcpObj != "" {
		arArgs = append(arArgs, mcpObj)
	}
	if err := runVerifyCommand(report, "package cpp static library", "", nil, ar, arArgs...); err != nil {
		return err
	}
	bin := filepath.Join(pkgDir, "signature_schema")
	if err := runVerifyCommand(report, "package cpp example link", "", nil, cpp, "-std=c++17", "-I", report.OutDir, filepath.Join(report.OutDir, "examples", "signature_schema.cpp"), lib, "-o", bin); err != nil {
		return err
	}
	if err := runVerifyCommand(report, "package cpp example", "", nil, bin); err != nil {
		return err
	}
	cmake, err := exec.LookPath("cmake")
	if err != nil {
		report.Steps = append(report.Steps, VerifyStep{Name: "package cpp cmake", Status: "skip", Message: "cmake not found"})
		return nil
	}
	buildDir := filepath.Join(pkgDir, "cmake-build")
	if err := runVerifyCommand(report, "package cpp cmake configure", pkgDir, nil, cmake, "-S", report.OutDir, "-B", buildDir, "-DAX_BUILD_EXAMPLES=ON", "-DAX_BUILD_CONFORMANCE=OFF"); err != nil {
		return err
	}
	if err := runVerifyCommand(report, "package cpp cmake build", buildDir, nil, cmake, "--build", ".", "--target", "signature_schema"); err != nil {
		return err
	}
	installDir := filepath.Join(pkgDir, "install")
	if err := runVerifyCommand(report, "package cpp cmake install", buildDir, nil, cmake, "--install", ".", "--prefix", installDir); err != nil {
		return err
	}
	consumerDir := filepath.Join(pkgDir, "consumer")
	if err := os.MkdirAll(consumerDir, 0o755); err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(consumerDir, "CMakeLists.txt"), []byte(`cmake_minimum_required(VERSION 3.16)
project(axllm_consumer LANGUAGES CXX)
find_package(axllm CONFIG REQUIRED)
add_executable(consumer main.cpp)
target_link_libraries(consumer PRIVATE axllm::axllm)
`), 0o644); err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(consumerDir, "main.cpp"), []byte(`#include <axllm/axllm.hpp>
#include <iostream>

int main() {
  auto sig = axllm::s("question:string -> answer:string");
  auto schema = axllm::to_json_schema(axllm::Core::get(sig, "outputs"));
  if (!axllm::Core::truthy(axllm::Core::get(axllm::Core::get(schema, "properties"), "answer"))) return 1;
  std::cout << "cpp-package-consumer-ok\n";
  return 0;
}
`), 0o644); err != nil {
		return err
	}
	consumerBuild := filepath.Join(pkgDir, "consumer-build")
	if err := runVerifyCommand(report, "package cpp consumer configure", consumerDir, nil, cmake, "-S", consumerDir, "-B", consumerBuild, "-DCMAKE_PREFIX_PATH="+installDir); err != nil {
		return err
	}
	if err := runVerifyCommand(report, "package cpp consumer build", consumerBuild, nil, cmake, "--build", "."); err != nil {
		return err
	}
	return runVerifyCommand(report, "package cpp consumer", "", nil, filepath.Join(consumerBuild, "consumer"))
}

func verifyCppQuickJSProfile(report VerifyTargetReport) (VerifyTargetReport, error) {
	cflags := strings.Fields(os.Getenv("AXIR_QUICKJS_CFLAGS"))
	ldflags := strings.Fields(os.Getenv("AXIR_QUICKJS_LDFLAGS"))
	if len(cflags) == 0 || len(ldflags) == 0 {
		cflags, ldflags = detectHomebrewQuickJSFlags()
	}
	if len(cflags) == 0 || len(ldflags) == 0 {
		report.Steps = append(report.Steps, VerifyStep{Name: "runtime profile javascript-quickjs", Status: "skip", Message: "AXIR_QUICKJS_CFLAGS and AXIR_QUICKJS_LDFLAGS not set"})
		return report, nil
	}
	cpp, err := findCppCompiler()
	if err != nil {
		report.Steps = append(report.Steps, VerifyStep{Name: "runtime profile javascript-quickjs c++", Status: "skip", Message: err.Error()})
		return report, nil
	}
	bin := filepath.Join(report.OutDir, "javascript_quickjs")
	args := []string{"-std=c++17", "-I", report.OutDir}
	args = append(args, cflags...)
	args = append(args,
		filepath.Join(report.OutDir, "axllm", "axllm.cpp"),
		filepath.Join(report.OutDir, "axllm", "runtime", "quickjs", "quickjs_runtime.cpp"),
		filepath.Join(report.OutDir, "examples", "runtime_profiles", "javascript_quickjs.cpp"),
	)
	args = append(args, ldflags...)
	args = append(args, "-o", bin)
	if err := runVerifyCommand(&report, "compile runtime profile javascript-quickjs", "", nil, cpp, args...); err != nil {
		return report, err
	}
	if err := runVerifyCommand(&report, "runtime profile javascript-quickjs", "", nil, bin); err != nil {
		return report, err
	}
	return report, nil
}

func verifyCppPyodideProfile(report VerifyTargetReport) (VerifyTargetReport, error) {
	cpp, err := findCppCompiler()
	if err != nil {
		report.Steps = append(report.Steps, VerifyStep{Name: "runtime profile python-pyodide c++", Status: "skip", Message: err.Error()})
		return report, nil
	}
	bin := filepath.Join(report.OutDir, "python_pyodide")
	if err := runVerifyCommand(&report, "compile runtime profile python-pyodide", "", nil, cpp, "-std=c++17", "-I", report.OutDir, filepath.Join(report.OutDir, "axllm", "axllm.cpp"), filepath.Join(report.OutDir, "examples", "runtime_profiles", "python_pyodide.cpp"), "-o", bin); err != nil {
		return report, err
	}
	if err := runVerifyCommand(&report, "runtime profile python-pyodide", "", nil, bin); err != nil {
		return report, err
	}
	return report, nil
}

func detectHomebrewQuickJSFlags() ([]string, []string) {
	for _, prefix := range []string{"/opt/homebrew/opt/quickjs", "/usr/local/opt/quickjs"} {
		header := filepath.Join(prefix, "include", "quickjs", "quickjs.h")
		lib := filepath.Join(prefix, "lib", "quickjs", "libquickjs.a")
		if _, err := os.Stat(header); err != nil {
			continue
		}
		if _, err := os.Stat(lib); err != nil {
			continue
		}
		return []string{"-I" + filepath.Dir(header)}, []string{lib, "-lm", "-ldl", "-pthread"}
	}
	return nil, nil
}

func conformanceSuitePaths(root string) []string {
	return []string{
		filepath.Join(root, "signature"),
		filepath.Join(root, "schema"),
		filepath.Join(root, "validation"),
		filepath.Join(root, "prompt"),
		filepath.Join(root, "axgen"),
		filepath.Join(root, "axai"),
		filepath.Join(root, "axagent"),
		filepath.Join(root, "axoptimize"),
		filepath.Join(root, "axprogram"),
		filepath.Join(root, "axflow"),
		filepath.Join(root, "axmcp"),
	}
}

func runtimeProtocolEnv(conformanceRoot string, env []string) []string {
	repoRoot := filepath.Dir(filepath.Dir(conformanceRoot))
	if abs, err := filepath.Abs(repoRoot); err == nil {
		repoRoot = abs
	}
	server := filepath.Join(repoRoot, "tools", "axir", "adapters", "axjs-runtime-server.ts")
	return append(env, "AXIR_REPO_ROOT="+repoRoot, "AXIR_AXJS_RUNTIME_SERVER="+server)
}

func runVerifyCommand(report *VerifyTargetReport, name, dir string, env []string, command string, args ...string) error {
	start := report.startStep(name)
	message, err := runCommandMessage(dir, env, command, args...)
	if err != nil {
		report.finishStep(name, "fail", message, start)
		return fmt.Errorf("%s failed: %s", name, message)
	}
	if message == "" {
		message = filepath.Base(command)
	}
	report.finishStep(name, "ok", message, start)
	return nil
}

func runCargoVerifyCommand(report *VerifyTargetReport, name, dir string, env []string, cargo string, args ...string) error {
	start := report.startStep(name)
	if cargoOfflineFirst(env) {
		offlineEnv := append(append([]string{}, env...), "CARGO_NET_OFFLINE=true")
		offlineMessage, offlineErr := runCommandMessage(dir, offlineEnv, cargo, args...)
		if offlineErr == nil {
			if offlineMessage == "" {
				offlineMessage = filepath.Base(cargo)
			}
			report.finishStep(name, "ok", "offline\n"+offlineMessage, start)
			return nil
		}
	}
	message, err := runCommandMessage(dir, env, cargo, args...)
	if err == nil {
		if message == "" {
			message = filepath.Base(cargo)
		}
		report.finishStep(name, "ok", message, start)
		return nil
	}
	if isCargoRegistryNetworkFailure(message) && !envHas(env, "CARGO_NET_OFFLINE") {
		offlineEnv := append(append([]string{}, env...), "CARGO_NET_OFFLINE=true")
		offlineMessage, offlineErr := runCommandMessage(dir, offlineEnv, cargo, args...)
		if offlineErr == nil {
			if offlineMessage == "" {
				offlineMessage = filepath.Base(cargo)
			}
			report.finishStep(name, "ok", "offline retry\n"+offlineMessage, start)
			return nil
		}
		message = message + "\n\noffline retry failed:\n" + offlineMessage
	}
	report.finishStep(name, "fail", message, start)
	return fmt.Errorf("%s failed: %s", name, message)
}

func cargoOfflineFirst(env []string) bool {
	if envHas(env, "CARGO_NET_OFFLINE") {
		return false
	}
	for _, entry := range env {
		key, value, ok := strings.Cut(entry, "=")
		if !ok || key != "AXIR_CARGO_OFFLINE_FIRST" {
			continue
		}
		switch strings.ToLower(strings.TrimSpace(value)) {
		case "", "0", "false", "no", "off":
			return false
		default:
			return true
		}
	}
	return false
}

func formatVerifyDuration(duration time.Duration) string {
	if duration <= 0 {
		return "0s"
	}
	if duration < time.Second {
		return duration.Round(time.Millisecond).String()
	}
	return duration.Round(100 * time.Millisecond).String()
}

func runCommandMessage(dir string, env []string, command string, args ...string) (string, error) {
	cmd := exec.Command(command, args...)
	if dir != "" {
		cmd.Dir = dir
	}
	if env == nil {
		// Verification subprocesses never need provider endpoint or
		// credential overrides; a nil env must not inherit them from the
		// developer's shell.
		env = scrubbedEnviron()
	}
	cmd.Env = env
	// A grandchild that inherits the pipes (for example a leaked runtime
	// subprocess) must not wedge verification forever after the direct
	// child exits.
	cmd.WaitDelay = 30 * time.Second
	out, err := cmd.CombinedOutput()
	message := strings.TrimSpace(string(out))
	if err != nil {
		if message == "" {
			message = err.Error()
		} else {
			message = err.Error() + "\n" + message
		}
		return message, err
	}
	return message, nil
}

func isCargoRegistryNetworkFailure(message string) bool {
	return strings.Contains(message, "failed to download from `https://index.crates.io/config.json`") ||
		strings.Contains(message, "Could not resolve host: index.crates.io") ||
		strings.Contains(message, "failed to get `") && strings.Contains(message, "Updating crates.io index")
}

func envHas(env []string, key string) bool {
	prefix := key + "="
	for _, item := range env {
		if strings.HasPrefix(item, prefix) {
			return true
		}
	}
	return false
}

func findJavaTool(name string) (string, error) {
	var candidates []string
	if path, err := exec.LookPath(name); err == nil {
		candidates = append(candidates, path)
	}
	candidates = append(candidates,
		filepath.Join("/opt/homebrew/opt/openjdk/bin", name),
		filepath.Join("/usr/local/opt/openjdk/bin", name),
		filepath.Join("/opt/homebrew/bin", name),
		filepath.Join("/usr/local/bin", name),
	)
	seen := map[string]bool{}
	for _, candidate := range candidates {
		if candidate == "" || seen[candidate] {
			continue
		}
		seen[candidate] = true
		if _, err := os.Stat(candidate); err != nil {
			continue
		}
		out, err := exec.Command(candidate, "-version").CombinedOutput()
		if err == nil {
			return candidate, nil
		}
		if strings.Contains(string(out), "Unable to locate a Java Runtime") {
			continue
		}
	}
	return "", fmt.Errorf("usable %s not found", name)
}

func findJarTool() (string, error) {
	var candidates []string
	if path, err := exec.LookPath("jar"); err == nil {
		candidates = append(candidates, path)
	}
	candidates = append(candidates,
		"/opt/homebrew/opt/openjdk/bin/jar",
		"/usr/local/opt/openjdk/bin/jar",
		"/opt/homebrew/bin/jar",
		"/usr/local/bin/jar",
	)
	seen := map[string]bool{}
	for _, candidate := range candidates {
		if candidate == "" || seen[candidate] {
			continue
		}
		seen[candidate] = true
		if _, err := os.Stat(candidate); err != nil {
			continue
		}
		out, err := exec.Command(candidate, "--version").CombinedOutput()
		if err == nil {
			return candidate, nil
		}
		if strings.Contains(string(out), "Unable to locate a Java Runtime") {
			continue
		}
	}
	return "", fmt.Errorf("usable jar not found")
}

func findCppCompiler() (string, error) {
	for _, name := range []string{"c++", "clang++", "g++"} {
		path, err := exec.LookPath(name)
		if err == nil {
			return path, nil
		}
	}
	return "", fmt.Errorf("usable C++ compiler not found")
}
