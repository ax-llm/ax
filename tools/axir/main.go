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
	case "compile":
		return runCompile(args[1:])
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
		if err := os.WriteFile(file, []byte(axir.FormatModule(m)), 0o644); err != nil {
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

func runCompile(args []string) error {
	fs := flag.NewFlagSet("compile", flag.ContinueOnError)
	fs.SetOutput(os.Stderr)
	target := fs.String("target", "", "compile target: python, java, or cpp")
	outDir := fs.String("out", "", "output directory")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *target == "" {
		return fmt.Errorf("compile requires --target python|java|cpp")
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

func runVerify(args []string) error {
	fs := flag.NewFlagSet("verify", flag.ContinueOnError)
	fs.SetOutput(os.Stderr)
	targetsText := fs.String("targets", "python,java,cpp", "comma-separated targets: python,java,cpp")
	workDir := fs.String("workdir", "", "optional verification output directory")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() != 1 {
		return fmt.Errorf("verify requires exactly one .axir root file")
	}
	targets := splitTargets(*targetsText)
	report, err := axir.Verify(fs.Arg(0), axir.VerifyOptions{Targets: targets, WorkDir: *workDir})
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
  compile --target python|java|cpp --out DIR <file>
  verify [--targets python,java,cpp] [--workdir DIR] <root>
`
}
