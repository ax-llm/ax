package axir

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
)

type VerifyOptions struct {
	Targets         []string
	WorkDir         string
	RuntimeProfiles []string
}

type VerifyReport struct {
	Root    string
	WorkDir string
	Targets []VerifyTargetReport
}

type VerifyTargetReport struct {
	Target string
	OutDir string
	Steps  []VerifyStep
}

type VerifyStep struct {
	Name    string
	Status  string
	Message string
}

func Verify(rootFile string, opts VerifyOptions) (VerifyReport, error) {
	targets := normalizeVerifyTargets(opts.Targets)
	bundle, err := LoadBundle(rootFile)
	if err != nil {
		return VerifyReport{}, err
	}
	if ds := Check(bundle); ds.HasErrors() {
		return VerifyReport{}, ds
	}
	workDir := opts.WorkDir
	if workDir == "" {
		workDir, err = os.MkdirTemp("", "axir-verify-")
		if err != nil {
			return VerifyReport{}, err
		}
	}
	report := VerifyReport{Root: rootFile, WorkDir: workDir}
	conformanceRoot := conformanceRootFor(rootFile)
	var failures []string
	for _, target := range targets {
		targetReport := VerifyTargetReport{
			Target: target,
			OutDir: filepath.Join(workDir, target),
		}
		if err := os.RemoveAll(targetReport.OutDir); err != nil {
			return report, err
		}
		if err := Compile(bundle, target, targetReport.OutDir); err != nil {
			targetReport.Steps = append(targetReport.Steps, VerifyStep{Name: "compile", Status: "fail", Message: err.Error()})
			report.Targets = append(report.Targets, targetReport)
			failures = append(failures, fmt.Sprintf("%s compile: %v", target, err))
			continue
		}
		targetReport.Steps = append(targetReport.Steps, VerifyStep{Name: "compile", Status: "ok", Message: targetReport.OutDir})
		if err := verifyManifest(targetReport.OutDir, target); err != nil {
			targetReport.Steps = append(targetReport.Steps, VerifyStep{Name: "manifest", Status: "fail", Message: err.Error()})
			report.Targets = append(report.Targets, targetReport)
			failures = append(failures, fmt.Sprintf("%s manifest: %v", target, err))
			continue
		}
		targetReport.Steps = append(targetReport.Steps, VerifyStep{Name: "manifest", Status: "ok", Message: "axir-capabilities.json"})
		var targetErr error
		switch target {
		case "python":
			targetReport, targetErr = verifyPythonTarget(targetReport, conformanceRoot)
		case "java":
			targetReport, targetErr = verifyJavaTarget(targetReport, conformanceRoot)
		case "cpp":
			targetReport, targetErr = verifyCppTarget(targetReport, conformanceRoot)
		default:
			targetErr = fmt.Errorf("unknown verify target %q", target)
		}
		if targetErr != nil {
			failures = append(failures, fmt.Sprintf("%s: %v", target, targetErr))
		}
		if len(opts.RuntimeProfiles) > 0 && targetErr == nil {
			var profileErr error
			targetReport, profileErr = verifyRuntimeProfilesTarget(targetReport, target, opts.RuntimeProfiles, conformanceRoot)
			if profileErr != nil {
				failures = append(failures, fmt.Sprintf("%s runtime profiles: %v", target, profileErr))
			}
		}
		report.Targets = append(report.Targets, targetReport)
	}
	if len(failures) > 0 {
		return report, fmt.Errorf("axir verify failed: %s", strings.Join(failures, "; "))
	}
	return report, nil
}

func verifyRuntimeProfilesTarget(report VerifyTargetReport, target string, profiles []string, conformanceRoot string) (VerifyTargetReport, error) {
	for _, profile := range normalizeVerifyTargets(profiles) {
		switch profile {
		case "javascript-quickjs":
			var err error
			switch target {
			case "python":
				report, err = verifyPythonQuickJSProfile(report, conformanceRoot)
			case "java":
				report, err = verifyJavaQuickJSProfile(report)
			case "cpp":
				report, err = verifyCppQuickJSProfile(report)
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

func normalizeVerifyTargets(targets []string) []string {
	if len(targets) == 0 {
		return []string{"python", "java", "cpp"}
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

func conformanceRootFor(rootFile string) string {
	axcoreDir := filepath.Dir(rootFile)
	irDir := filepath.Dir(axcoreDir)
	return filepath.Join(irDir, "conformance")
}

func (r VerifyReport) String() string {
	var b strings.Builder
	fmt.Fprintf(&b, "AxIR verify: %s\n", filepath.Clean(r.Root))
	fmt.Fprintf(&b, "workdir: %s\n", filepath.Clean(r.WorkDir))
	for _, target := range r.Targets {
		fmt.Fprintf(&b, "%s: %s\n", target.Target, filepath.Clean(target.OutDir))
		for _, step := range target.Steps {
			if step.Message == "" {
				fmt.Fprintf(&b, "  %s %s\n", step.Status, step.Name)
			} else {
				fmt.Fprintf(&b, "  %s %s: %s\n", step.Status, step.Name, step.Message)
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
	if !bytes.Contains(data, []byte(`"target": "`+target+`"`)) {
		return fmt.Errorf("manifest missing target %q", target)
	}
	for _, suite := range []string{"signature", "schema", "validation", "prompt", "axgen", "axai", "axagent", "axoptimize", "axprogram", "axflow"} {
		if !bytes.Contains(data, []byte(`"`+suite+`"`)) {
			return fmt.Errorf("manifest missing suite %q", suite)
		}
	}
	return nil
}

func verifyPythonTarget(report VerifyTargetReport, conformanceRoot string) (VerifyTargetReport, error) {
	python, err := exec.LookPath("python3")
	if err != nil {
		report.Steps = append(report.Steps, VerifyStep{Name: "python3", Status: "skip", Message: "python3 not found"})
		return report, nil
	}
	env := runtimeProtocolEnv(conformanceRoot, append(os.Environ(), "PYTHONPATH="+report.OutDir))
	if err := runVerifyCommand(&report, "compileall", "", env, python, "-m", "compileall", "-q", filepath.Join(report.OutDir, "ax")); err != nil {
		return report, err
	}
	for _, example := range []string{
		"signature_schema.py",
		"axgen_fake_client_tool.py",
		"axai_fake_transport.py",
		"axagent_pipeline.py",
		"runtime_adapter.py",
		"runtime_protocol.py",
		"axflow_program_graph.py",
		"optimizer_artifact.py",
	} {
		if err := runVerifyCommand(&report, "example "+example, "", env, python, filepath.Join(report.OutDir, "examples", example)); err != nil {
			return report, err
		}
	}
	args := append([]string{"-m", "ax.conformance"}, conformanceSuitePaths(conformanceRoot)...)
	if err := runVerifyCommand(&report, "conformance", "", env, python, args...); err != nil {
		return report, err
	}
	return report, nil
}

func verifyPythonQuickJSProfile(report VerifyTargetReport, conformanceRoot string) (VerifyTargetReport, error) {
	server := os.Getenv("AXIR_QUICKJS_RUNTIME_SERVER")
	if server == "" {
		report.Steps = append(report.Steps, VerifyStep{Name: "runtime profile javascript-quickjs", Status: "skip", Message: "AXIR_QUICKJS_RUNTIME_SERVER not set"})
		return report, nil
	}
	python, err := exec.LookPath("python3")
	if err != nil {
		report.Steps = append(report.Steps, VerifyStep{Name: "runtime profile javascript-quickjs", Status: "skip", Message: "python3 not found"})
		return report, nil
	}
	env := runtimeProtocolEnv(conformanceRoot, append(os.Environ(), "PYTHONPATH="+report.OutDir, "AXIR_QUICKJS_RUNTIME_SERVER="+server))
	return report, runVerifyCommand(&report, "runtime profile javascript-quickjs", "", env, python, filepath.Join(report.OutDir, "examples", "runtime_profiles", "javascript_quickjs.py"))
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
	files, err := filepath.Glob(filepath.Join(report.OutDir, "dev", "ax", "*.java"))
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
	env := runtimeProtocolEnv(conformanceRoot, os.Environ())
	if err := runVerifyCommand(&report, "javac", "", env, javac, args...); err != nil {
		return report, err
	}
	for _, className := range []string{
		"SignatureSchemaExample",
		"AxGenFakeClientToolExample",
		"AxAIFakeTransportExample",
		"AxAgentPipelineExample",
		"RuntimeAdapterExample",
		"RuntimeProtocolExample",
		"AxFlowProgramGraphExample",
		"OptimizerArtifactExample",
	} {
		if err := runVerifyCommand(&report, "example "+className, "", env, java, "-cp", report.OutDir, className); err != nil {
			return report, err
		}
	}
	args = append([]string{"-cp", report.OutDir, "dev.ax.Conformance"}, conformanceSuitePaths(conformanceRoot)...)
	if err := runVerifyCommand(&report, "conformance", "", nil, java, args...); err != nil {
		return report, err
	}
	return report, nil
}

func verifyJavaQuickJSProfile(report VerifyTargetReport) (VerifyTargetReport, error) {
	cp := os.Getenv("AXIR_QUICKJS4J_CP")
	if cp == "" {
		report.Steps = append(report.Steps, VerifyStep{Name: "runtime profile javascript-quickjs", Status: "skip", Message: "AXIR_QUICKJS4J_CP not set"})
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
	files, err := filepath.Glob(filepath.Join(report.OutDir, "dev", "ax", "*.java"))
	if err != nil {
		return report, err
	}
	profileFiles, err := filepath.Glob(filepath.Join(report.OutDir, "dev", "ax", "runtime", "quickjs", "*.java"))
	if err != nil {
		return report, err
	}
	files = append(files, profileFiles...)
	files = append(files, filepath.Join(report.OutDir, "examples", "runtime_profiles", "JavaScriptQuickJsExample.java"))
	sort.Strings(files)
	classpath := report.OutDir + string(os.PathListSeparator) + cp
	args := append([]string{"-cp", classpath, "-d", report.OutDir}, files...)
	if err := runVerifyCommand(&report, "compile runtime profile javascript-quickjs", "", os.Environ(), javac, args...); err != nil {
		return report, err
	}
	if err := runVerifyCommand(&report, "runtime profile javascript-quickjs", "", os.Environ(), java, "-cp", classpath, "JavaScriptQuickJsExample"); err != nil {
		return report, err
	}
	return report, nil
}

func verifyCppTarget(report VerifyTargetReport, conformanceRoot string) (VerifyTargetReport, error) {
	cpp, err := findCppCompiler()
	if err != nil {
		report.Steps = append(report.Steps, VerifyStep{Name: "c++", Status: "skip", Message: err.Error()})
		return report, nil
	}
	axSource := filepath.Join(report.OutDir, "ax", "ax.cpp")
	examples := []string{
		"signature_schema",
		"axgen_fake_client_tool",
		"axai_fake_transport",
		"axagent_pipeline",
		"runtime_adapter",
		"runtime_protocol",
		"axflow_program_graph",
		"optimizer_artifact",
	}
	for _, example := range examples {
		source := filepath.Join(report.OutDir, "examples", example+".cpp")
		bin := filepath.Join(report.OutDir, example)
		if err := runVerifyCommand(&report, "compile example "+example, "", nil, cpp, "-std=c++17", "-I", report.OutDir, axSource, source, "-o", bin); err != nil {
			return report, err
		}
		if err := runVerifyCommand(&report, "example "+example, "", nil, bin); err != nil {
			return report, err
		}
	}
	conformanceBin := filepath.Join(report.OutDir, "conformance")
	if err := runVerifyCommand(&report, "compile conformance", "", nil, cpp, "-std=c++17", "-I", report.OutDir, axSource, filepath.Join(report.OutDir, "conformance.cpp"), "-o", conformanceBin); err != nil {
		return report, err
	}
	args := append([]string{}, conformanceSuitePaths(conformanceRoot)...)
	if err := runVerifyCommand(&report, "conformance", "", nil, conformanceBin, args...); err != nil {
		return report, err
	}
	return report, nil
}

func verifyCppQuickJSProfile(report VerifyTargetReport) (VerifyTargetReport, error) {
	cflags := strings.Fields(os.Getenv("AXIR_QUICKJS_CFLAGS"))
	ldflags := strings.Fields(os.Getenv("AXIR_QUICKJS_LDFLAGS"))
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
		filepath.Join(report.OutDir, "ax", "ax.cpp"),
		filepath.Join(report.OutDir, "ax", "runtime", "quickjs", "quickjs_runtime.cpp"),
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
	cmd := exec.Command(command, args...)
	if dir != "" {
		cmd.Dir = dir
	}
	if env != nil {
		cmd.Env = env
	}
	out, err := cmd.CombinedOutput()
	message := strings.TrimSpace(string(out))
	if err != nil {
		if message == "" {
			message = err.Error()
		} else {
			message = err.Error() + "\n" + message
		}
		report.Steps = append(report.Steps, VerifyStep{Name: name, Status: "fail", Message: message})
		return fmt.Errorf("%s failed: %s", name, message)
	}
	if message == "" {
		message = filepath.Base(command)
	}
	report.Steps = append(report.Steps, VerifyStep{Name: name, Status: "ok", Message: message})
	return nil
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

func findCppCompiler() (string, error) {
	for _, name := range []string{"c++", "clang++", "g++"} {
		path, err := exec.LookPath(name)
		if err == nil {
			return path, nil
		}
	}
	return "", fmt.Errorf("usable C++ compiler not found")
}
