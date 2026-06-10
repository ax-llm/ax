package axir

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

const (
	provenanceBeginFunctions    = "BEGIN AXIR CORE EMITTED FUNCTIONS"
	provenanceEndFunctions      = "END AXIR CORE EMITTED FUNCTIONS"
	provenanceBeginDeclarations = "BEGIN AXIR CORE EMITTED DECLARATIONS"
	provenanceEndDeclarations   = "END AXIR CORE EMITTED DECLARATIONS"
)

// provenanceEnforced lists the targets whose generated packages must prove
// that every Core-owned function is emitted from the IR. Rust stays
// report-only until its real core emitter lands.
var provenanceEnforced = map[string]bool{
	"python": true,
	"java":   true,
	"cpp":    true,
	"go":     true,
	"rust":   false,
}

func provenanceEnforcedFor(target string) bool {
	if os.Getenv("AXIR_PROVENANCE") == "report" {
		return false
	}
	return provenanceEnforced[target]
}

type ProvenanceFileMetrics struct {
	EmittedLines int `json:"emitted_lines"`
	TotalLines   int `json:"total_lines"`
}

type ProvenanceReport struct {
	Target           string                           `json:"target"`
	Enforced         bool                             `json:"enforced"`
	EmittedFunctions int                              `json:"emitted_functions"`
	Files            map[string]ProvenanceFileMetrics `json:"files"`
	Violations       []string                         `json:"violations,omitempty"`
}

type provenanceExpectation struct {
	file    string
	name    string
	inside  string         // exact definition line expected inside the emitted region
	outside *regexp.Regexp // shadow-definition pattern checked outside the region; nil disables
}

// specArgList renders the argument list the emitters generate for a spec so
// audit patterns can match full signatures; java and cpp templates carry
// convenience overloads (same name, different arity) that must not be
// misread as shadows.
func specArgList(model AxRuntimeModel, spec CoreFuncSpec, typeName string, nameFn func(string) string) (string, error) {
	body, err := BuildCoreBody(model.Symbols[spec.Symbol])
	if err != nil {
		return "", fmt.Errorf("@%s: %w", spec.Symbol, err)
	}
	if len(body.Blocks) == 0 {
		return "", fmt.Errorf("@%s has no Core body blocks", spec.Symbol)
	}
	var args []string
	for _, arg := range body.Blocks[0].Args {
		args = append(args, typeName+" "+nameFn("%"+arg.Name))
	}
	return strings.Join(args, ", "), nil
}

func cppSpecArgs(model AxRuntimeModel, spec CoreFuncSpec) (string, error) {
	return specArgList(model, spec, "Value", cppName)
}

func provenanceExpectations(model AxRuntimeModel, target string, specs []CoreFuncSpec) ([]provenanceExpectation, error) {
	var out []provenanceExpectation
	for _, spec := range specs {
		switch target {
		case "python":
			out = append(out, provenanceExpectation{
				file:    "axllm/" + pythonCoreModuleFile(spec.Module) + ".py",
				name:    spec.Name,
				inside:  "def " + spec.Name + "(",
				outside: regexp.MustCompile(`(?m)^def ` + regexp.QuoteMeta(spec.Name) + `\(`),
			})
		case "go":
			out = append(out, provenanceExpectation{
				file:    "axllm.go",
				name:    spec.Name,
				inside:  "func " + spec.Name + "(",
				outside: regexp.MustCompile(`(?m)^func ` + regexp.QuoteMeta(spec.Name) + `\(`),
			})
		case "java":
			args, err := specArgList(model, spec, "Object", javaName)
			if err != nil {
				return nil, err
			}
			definition := fmt.Sprintf("static Object %s(%s) {", spec.Name, args)
			out = append(out, provenanceExpectation{
				file:    "dev/axllm/ax/Core.java",
				name:    spec.Name,
				inside:  "  " + definition,
				outside: regexp.MustCompile(`(?m)^[ \t]*` + regexp.QuoteMeta(definition)),
			})
		case "cpp":
			args, err := cppSpecArgs(model, spec)
			if err != nil {
				return nil, err
			}
			definition := fmt.Sprintf("Value Core::%s(%s) {", spec.Name, args)
			out = append(out, provenanceExpectation{
				file:    "axllm/axllm.cpp",
				name:    spec.Name,
				inside:  definition,
				outside: regexp.MustCompile(`(?m)^` + regexp.QuoteMeta(definition)),
			})
		default:
			return nil, fmt.Errorf("no provenance expectations for target %q", target)
		}
	}
	return out, nil
}

type provenanceRegion struct {
	inside  string
	outside string
}

func splitProvenanceRegion(content, begin, end string) (provenanceRegion, error) {
	if strings.Count(content, begin) != 1 || strings.Count(content, end) != 1 {
		return provenanceRegion{}, fmt.Errorf("want exactly one %q/%q region, found %d/%d",
			begin, end, strings.Count(content, begin), strings.Count(content, end))
	}
	start := strings.Index(content, begin)
	stop := strings.Index(content, end)
	if stop < start {
		return provenanceRegion{}, fmt.Errorf("%q region ends before it begins", begin)
	}
	return provenanceRegion{
		inside:  content[start:stop],
		outside: content[:start] + content[stop:],
	}, nil
}

func countDefinitionLines(text, definition string) int {
	count := strings.Count(text, "\n"+definition)
	if strings.HasPrefix(text, definition) {
		count++
	}
	return count
}

// AuditProvenance verifies that, for the given target, every Core-owned
// function in the registry is defined exactly once inside the emitted-region
// markers of its expected generated file and nowhere else in the package.
// files maps package-relative paths to contents.
func AuditProvenance(model AxRuntimeModel, target string, files map[string]string) (ProvenanceReport, error) {
	report := ProvenanceReport{
		Target:   target,
		Enforced: provenanceEnforcedFor(target),
		Files:    map[string]ProvenanceFileMetrics{},
	}
	specs, err := BuildCoreFuncRegistry(model)
	if err != nil {
		return report, err
	}
	if target == "rust" {
		report.Violations = append(report.Violations,
			fmt.Sprintf("rust does not emit Core bodies yet: 0/%d registry functions emitted (hand-written template port, fixture-verified only)", len(specs)))
		return report, nil
	}
	expectations, err := provenanceExpectations(model, target, specs)
	if err != nil {
		return report, err
	}

	expectedFiles := map[string]bool{}
	for _, exp := range expectations {
		expectedFiles[exp.file] = true
	}
	regions := map[string]provenanceRegion{}
	for file := range expectedFiles {
		content, ok := files[file]
		if !ok {
			report.Violations = append(report.Violations, fmt.Sprintf("%s: expected generated file is missing", file))
			continue
		}
		region, err := splitProvenanceRegion(content, provenanceBeginFunctions, provenanceEndFunctions)
		if err != nil {
			report.Violations = append(report.Violations, fmt.Sprintf("%s: %v", file, err))
			continue
		}
		regions[file] = region
		report.Files[file] = ProvenanceFileMetrics{
			EmittedLines: strings.Count(region.inside, "\n"),
			TotalLines:   strings.Count(content, "\n") + 1,
		}
	}

	var sourceFiles []string
	for name := range files {
		switch filepath.Ext(name) {
		case ".py", ".go", ".java", ".cpp", ".hpp", ".rs":
			sourceFiles = append(sourceFiles, name)
		}
	}
	sort.Strings(sourceFiles)

	for _, exp := range expectations {
		region, ok := regions[exp.file]
		if !ok {
			continue // file-level violation already recorded
		}
		if got := countDefinitionLines(region.inside, exp.inside); got != 1 {
			report.Violations = append(report.Violations,
				fmt.Sprintf("%s: %s defined %d times inside the emitted region, want exactly once", exp.file, exp.name, got))
			continue
		}
		report.EmittedFunctions++
		if exp.outside == nil {
			continue
		}
		for _, name := range sourceFiles {
			text := files[name]
			if name == exp.file {
				text = region.outside
			}
			if loc := exp.outside.FindStringIndex(text); loc != nil {
				report.Violations = append(report.Violations,
					fmt.Sprintf("%s: %s is also defined outside the emitted region in %s (hand-written shadow of a Core-owned function)", exp.file, exp.name, name))
			}
		}
	}

	if target == "cpp" {
		if content, ok := files["axllm/axllm.hpp"]; !ok {
			report.Violations = append(report.Violations, "axllm/axllm.hpp: expected generated header is missing")
		} else if region, err := splitProvenanceRegion(content, provenanceBeginDeclarations, provenanceEndDeclarations); err != nil {
			report.Violations = append(report.Violations, fmt.Sprintf("axllm/axllm.hpp: %v", err))
		} else {
			for _, spec := range specs {
				args, err := cppSpecArgs(model, spec)
				if err != nil {
					return report, err
				}
				decl := fmt.Sprintf("static Value %s(%s);", spec.Name, args)
				if got := countDefinitionLines(strings.ReplaceAll(region.inside, "  static Value", "static Value"), decl); got != 1 {
					report.Violations = append(report.Violations,
						fmt.Sprintf("axllm/axllm.hpp: declaration for %s found %d times inside the declarations region, want exactly once", spec.Name, got))
				}
			}
		}
	}

	sort.Strings(report.Violations)
	return report, nil
}

// AuditProvenanceDir audits a written package directory.
func AuditProvenanceDir(model AxRuntimeModel, target, dir string) (ProvenanceReport, error) {
	files := map[string]string{}
	err := filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return err
		}
		switch filepath.Ext(path) {
		case ".py", ".go", ".java", ".cpp", ".hpp", ".rs":
			rel, err := filepath.Rel(dir, path)
			if err != nil {
				return err
			}
			content, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			files[filepath.ToSlash(rel)] = string(content)
		}
		return nil
	})
	if err != nil {
		return ProvenanceReport{Target: target}, err
	}
	return AuditProvenance(model, target, files)
}

// WriteProvenanceManifest records the audit metrics next to the package's
// capability manifest.
func WriteProvenanceManifest(dir string, report ProvenanceReport) error {
	payload, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, "axir-provenance.json"), append(payload, '\n'), 0o644)
}
