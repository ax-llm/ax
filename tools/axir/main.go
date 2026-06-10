package main

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/ax-llm/ax/tools/axir/internal/axir"
)

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(args []string) error {
	if len(args) == 0 {
		return usage()
	}
	switch args[0] {
	case "fmt":
		return runFmt(args[1:])
	case "check":
		return runCheck(args[1:])
	case "dump-json":
		return runDumpJSON(args[1:])
	case "lower":
		return runLower(args[1:])
	case "lint":
		return runLint(args[1:])
	case "explain":
		return runExplain(args[1:])
	case "compile":
		return runCompile(args[1:])
	case "audit":
		return runAudit(args[1:])
	case "verify":
		return runVerify(args[1:])
	case "help", "-h", "--help":
		fmt.Print(usageText())
		return nil
	default:
		return fmt.Errorf("unknown command %q\n\n%s", args[0], usageText())
	}
}

func runFmt(files []string) error {
	if len(files) == 0 {
		return fmt.Errorf("fmt requires at least one .axir file")
	}
	for _, file := range files {
		m, err := readModule(file)
		if err != nil {
			return err
		}
		if err := os.WriteFile(file, []byte(axir.FormatModuleCompact(m)), 0o644); err != nil {
			return err
		}
	}
	return nil
}

func runCheck(files []string) error {
	if len(files) == 0 {
		return fmt.Errorf("check requires at least one .axir file")
	}
	failed := false
	for _, file := range files {
		bundle, err := axir.LoadBundle(file)
		if err != nil {
			return err
		}
		ds := axir.Check(bundle)
		if len(ds) == 0 {
			fmt.Printf("%s: ok\n", file)
			continue
		}
		for _, d := range ds {
			fmt.Printf("%s: %s\n", file, d.Error())
			if d.Severity == "error" {
				failed = true
			}
		}
	}
	if failed {
		return fmt.Errorf("axir check failed")
	}
	return nil
}

func runDumpJSON(files []string) error {
	if len(files) != 1 {
		return fmt.Errorf("dump-json requires exactly one .axir file")
	}
	bundle, err := axir.LoadBundle(files[0])
	if err != nil {
		return err
	}
	out, err := axir.DumpJSON(bundle)
	if err != nil {
		return err
	}
	fmt.Println(string(out))
	return nil
}

func runLower(args []string) error {
	fs := flag.NewFlagSet("lower", flag.ContinueOnError)
	fs.SetOutput(os.Stderr)
	to := fs.String("to", "core", "lowering target")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *to != "core" {
		return fmt.Errorf("only --to core is supported")
	}
	if fs.NArg() != 1 {
		return fmt.Errorf("lower requires exactly one .axir root file")
	}
	bundle, err := axir.LoadBundle(fs.Arg(0))
	if err != nil {
		return err
	}
	if ds := axir.Check(bundle); ds.HasErrors() {
		return ds
	}
	fmt.Print(axir.FormatModule(axir.LowerToCore(bundle)))
	return nil
}

func runLint(args []string) error {
	fs := flag.NewFlagSet("lint", flag.ContinueOnError)
	fs.SetOutput(os.Stderr)
	profile := fs.String("profile", "llm-core", "lint profile")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() == 0 {
		return fmt.Errorf("lint requires at least one .axir root file")
	}
	failed := false
	for _, file := range fs.Args() {
		bundle, err := axir.LoadBundle(file)
		if err != nil {
			return err
		}
		ds := axir.Lint(bundle, *profile)
		if len(ds) == 0 {
			fmt.Printf("%s: ok\n", file)
			continue
		}
		for _, d := range ds {
			fmt.Printf("%s: %s\n", file, d.Error())
			if d.Severity == "error" {
				failed = true
			}
		}
	}
	if failed {
		return fmt.Errorf("axir lint failed")
	}
	return nil
}

func runExplain(args []string) error {
	fs := flag.NewFlagSet("explain", flag.ContinueOnError)
	fs.SetOutput(os.Stderr)
	symbol := fs.String("symbol", "", "symbol to explain")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() != 1 {
		return fmt.Errorf("explain requires exactly one .axir root file")
	}
	if *symbol == "" {
		return fmt.Errorf("explain requires --symbol <name>")
	}
	bundle, err := axir.LoadBundle(fs.Arg(0))
	if err != nil {
		return err
	}
	if ds := axir.Check(bundle); ds.HasErrors() {
		return ds
	}
	out, err := axir.Explain(bundle, *symbol)
	if err != nil {
		return err
	}
	fmt.Print(out)
	return nil
}

func runCompile(args []string) error {
	fs := flag.NewFlagSet("compile", flag.ContinueOnError)
	fs.SetOutput(os.Stderr)
	target := fs.String("target", "", "compile target: python, java, cpp, go, or rust")
	outDir := fs.String("out", "", "output directory")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *target == "" {
		return fmt.Errorf("compile requires --target python|java|cpp|go|rust")
	}
	if *outDir == "" {
		return fmt.Errorf("compile requires --out <dir>")
	}
	if fs.NArg() != 1 {
		return fmt.Errorf("compile requires exactly one .axir file")
	}
	bundle, err := axir.LoadBundle(fs.Arg(0))
	if err != nil {
		return err
	}
	if err := axir.Compile(bundle, *target, *outDir); err != nil {
		return err
	}
	fmt.Printf("wrote %s package to %s\n", *target, filepath.Clean(*outDir))
	return nil
}

func runAudit(args []string) error {
	fs := flag.NewFlagSet("audit", flag.ContinueOnError)
	fs.SetOutput(os.Stderr)
	targets := fs.String("targets", "python,java,cpp,go,rust", "comma-separated targets to audit")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() != 2 || fs.Arg(0) != "provenance" {
		return fmt.Errorf("usage: axir audit provenance [--targets t1,t2] <root.axir>")
	}
	bundle, err := axir.LoadBundle(fs.Arg(1))
	if err != nil {
		return err
	}
	if ds := axir.Check(bundle); ds.HasErrors() {
		return ds
	}
	model, err := axir.BuildRuntimeModel(axir.LowerToCore(bundle))
	if err != nil {
		return err
	}
	emitters := map[string]func(axir.AxRuntimeModel, string) error{
		"python": axir.EmitPython,
		"java":   axir.EmitJava,
		"cpp":    axir.EmitCpp,
		"go":     axir.EmitGo,
		"rust":   axir.EmitRust,
	}
	failed := false
	for _, target := range strings.Split(*targets, ",") {
		target = strings.TrimSpace(target)
		if target == "" {
			continue
		}
		emit, ok := emitters[target]
		if !ok {
			return fmt.Errorf("unknown audit target %q", target)
		}
		dir, err := os.MkdirTemp("", "axir-audit-"+target+"-")
		if err != nil {
			return err
		}
		defer os.RemoveAll(dir)
		if err := emit(model, dir); err != nil {
			return fmt.Errorf("%s: emit failed: %w", target, err)
		}
		report, err := axir.AuditProvenanceDir(model, target, dir)
		if err != nil {
			return fmt.Errorf("%s: %w", target, err)
		}
		mode := "report"
		if report.Enforced {
			mode = "enforced"
		}
		fmt.Printf("%s (%s): %d core functions emitted across %d files, %d violation(s)\n",
			target, mode, report.EmittedFunctions, len(report.Files), len(report.Violations))
		for _, violation := range report.Violations {
			fmt.Printf("  - %s\n", violation)
		}
		if report.Enforced && len(report.Violations) > 0 {
			failed = true
		}
	}
	if failed {
		return fmt.Errorf("provenance audit failed")
	}
	return nil
}

func runVerify(args []string) error {
	fs := flag.NewFlagSet("verify", flag.ContinueOnError)
	fs.SetOutput(os.Stderr)
	targetsText := fs.String("targets", "python,java,cpp,go,rust", "comma-separated targets: python,java,cpp,go,rust")
	workDir := fs.String("workdir", "", "optional verification output directory")
	runtimeProfilesText := fs.String("runtime-profiles", "", "comma-separated optional runtime profiles, e.g. javascript-quickjs,javascript-goja")
	mode := fs.String("mode", axir.VerifyModeRelease, "verification mode: dev or release")
	jobs := fs.Int("jobs", 1, "parallel target jobs; 0 uses available CPUs")
	progress := fs.Bool("progress", false, "print target step progress to stderr")
	noProgress := fs.Bool("no-progress", false, "disable target step progress")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() != 1 {
		return fmt.Errorf("verify requires exactly one .axir root file")
	}
	targets := splitTargets(*targetsText)
	runtimeProfiles := splitTargets(*runtimeProfilesText)
	showProgress := *progress
	if *noProgress {
		showProgress = false
	}
	report, err := axir.Verify(fs.Arg(0), axir.VerifyOptions{
		Targets:         targets,
		WorkDir:         *workDir,
		RuntimeProfiles: runtimeProfiles,
		Mode:            *mode,
		Jobs:            *jobs,
		Progress:        showProgress,
	})
	fmt.Print(report.String())
	return err
}

func splitTargets(text string) []string {
	var targets []string
	for _, item := range strings.Split(text, ",") {
		item = strings.TrimSpace(item)
		if item != "" {
			targets = append(targets, item)
		}
	}
	return targets
}

func readModule(file string) (axir.Module, error) {
	data, err := os.ReadFile(file)
	if err != nil {
		return axir.Module{}, err
	}
	m, err := axir.ParseModule(string(data), file)
	if err != nil {
		return axir.Module{}, fmt.Errorf("%s: %w", file, err)
	}
	return m, nil
}

func usage() error {
	return fmt.Errorf("%s", usageText())
}

func usageText() string {
	return `usage: axir <command> [args]

commands:
  fmt <files...>                         format files in place
  check <roots...>                       parse and validate root bundles
  dump-json <root>                       print JSON AST for a bundle
  lower --to core <root>                 lower Ax dialects to Core IR
  lint [--profile llm-core] <roots...>   lint for the LLM authoring profile
  explain --symbol NAME <root>           explain a lowered symbol
  compile --target python|java|cpp|go|rust --out DIR <file>
  verify [--mode dev|release] [--jobs N] [--progress|--no-progress] [--targets python,java,cpp,go,rust] [--workdir DIR] [--runtime-profiles javascript-quickjs,javascript-goja] <root>
`
}
