package axir

import (
	"fmt"
	"os"
	"regexp"
	"strings"
)

func Lint(bundle Bundle, profile string) Diagnostics {
	if profile != "llm-core" {
		return Diagnostics{diag("error", "", 0, "unknown lint profile %q", profile)}
	}
	var d Diagnostics
	for _, mod := range bundle.Modules {
		d = append(d, lintModuleSource(mod)...)
		for _, op := range mod.Ops {
			d = append(d, lintOp(mod.File, op)...)
		}
	}
	return d
}

var emptyElsePattern = regexp.MustCompile(`\} else \{\s*\}`)

// lintModuleSource applies source-text rules: written-out empty else blocks
// are errors (the compact form omits them), non-canonical formatting and
// oversized modules are warnings.
func lintModuleSource(mod Module) Diagnostics {
	var d Diagnostics
	raw, err := os.ReadFile(mod.File)
	if err != nil {
		return Diagnostics{diag("error", mod.File, 0, "cannot read module source: %v", err)}
	}
	text := string(raw)
	if loc := emptyElsePattern.FindStringIndex(text); loc != nil {
		line := strings.Count(text[:loc[0]], "\n") + 1
		d = append(d, diag("error", mod.File, line, "empty else block; omit it (run axir fmt)"))
	}
	if FormatModuleCompact(mod) != text {
		d = append(d, diag("warning", mod.File, 0, "module is not canonically formatted; run axir fmt"))
	}
	if lines := strings.Count(text, "\n"); lines > 4000 {
		d = append(d, diag("warning", mod.File, 0, "module has %d lines; consider splitting or extracting data", lines))
	}
	return d
}

func lintOp(file string, op Operation) Diagnostics {
	var d Diagnostics
	if stringsHasAxSemanticPrefix(op.Name) && AttrString(op, "core_kind") != "" && !hasTag(op) {
		d = append(d, diag("warning", file, op.Line, "semantic operation @%s should include a source or conformance tag", op.Symbol))
	}
	if region, ok := findRegion(op, "body"); ok {
		count := countCoreOps(region)
		if count > 160 {
			d = append(d, diag("warning", file, op.Line, "@%s has %d Core statements; prefer smaller helpers for LLM maintenance", op.Symbol, count))
		}
	}
	for _, child := range op.Ops {
		d = append(d, lintOp(file, child)...)
	}
	for _, region := range op.Regions {
		for _, block := range region.Blocks {
			for _, child := range block.Ops {
				d = append(d, lintOp(file, child)...)
			}
		}
	}
	return d
}

func stringsHasAxSemanticPrefix(name string) bool {
	switch name {
	case "ax.ai.semantic", "ax.gen.semantic", "ax.mcp.semantic", "ax.optimize.semantic", "ax.provider.semantic", "ax.schema.semantic", "ax.signature.semantic", "ax.stream.semantic", "ax.template.semantic", "ax.tool.semantic", "ax.validate.semantic":
		return true
	default:
		return false
	}
}

func hasTag(op Operation) bool {
	for _, attr := range op.Attributes {
		if attr.Kind == "tag" {
			return true
		}
	}
	return false
}

func countCoreOps(region Region) int {
	total := 0
	for _, block := range region.Blocks {
		for _, op := range block.Ops {
			total += countCoreOp(op)
		}
	}
	return total
}

func countCoreOp(op Operation) int {
	total := 1
	for _, region := range op.Regions {
		total += countCoreOps(region)
	}
	for _, child := range op.Ops {
		total += countCoreOp(child)
	}
	return total
}

func formatDiagnostics(ds Diagnostics) string {
	if len(ds) == 0 {
		return "ok\n"
	}
	return fmt.Sprintf("%s\n", ds.Error())
}
