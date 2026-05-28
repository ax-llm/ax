package axir

import (
	"fmt"
	"strings"
)

var knownDialects = map[string]bool{
	"core":         true,
	"ax.api":       true,
	"ax.signature": true,
	"ax.schema":    true,
	"ax.validate":  true,
	"ax.template":  true,
	"ax.ai":        true,
	"ax.tool":      true,
	"ax.gen":       true,
	"ax.stream":    true,
	"ax.provider":  true,
	"ax.agent":     true,
}

var coreBodyOps = map[string]bool{
	"core.append":       true,
	"core.break":        true,
	"core.call":         true,
	"core.continue":     true,
	"core.const":        true,
	"core.for":          true,
	"core.get":          true,
	"core.if":           true,
	"core.let":          true,
	"core.list":         true,
	"core.loop":         true,
	"core.map":          true,
	"core.raise":        true,
	"core.regex_match":  true,
	"core.return":       true,
	"core.set":          true,
	"core.string_split": true,
	"core.string_join":  true,
	"core.string_trim":  true,
	"core.switch":       true,
	"core.try":          true,
	"core.type_is":      true,
}

func Check(bundle Bundle) Diagnostics {
	var d Diagnostics
	if len(bundle.Modules) == 0 {
		return append(d, diag("error", "", 0, "bundle has no modules"))
	}
	modNames := map[string]Module{}
	symbols := map[string]Operation{}
	for _, mod := range bundle.Modules {
		if mod.Name == "" {
			d = append(d, diag("error", mod.File, 0, "module name is required"))
		}
		if mod.Version == "" {
			d = append(d, diag("error", mod.File, 0, "module version is required"))
		}
		if _, ok := modNames[mod.Name]; ok {
			d = append(d, diag("error", mod.File, 0, "duplicate module @%s", mod.Name))
		}
		modNames[mod.Name] = mod
		for _, dialect := range mod.Dialects {
			if !knownDialects[dialect.Name] {
				d = append(d, diag("error", mod.File, dialect.Line, "unknown dialect @%s", dialect.Name))
			}
		}
		for _, op := range mod.Ops {
			for _, item := range allOpTree(op) {
				if item.Symbol != "" {
					if prev, ok := symbols[item.Symbol]; ok {
						d = append(d, diag("error", mod.File, item.Line, "duplicate symbol @%s; first defined by %s", item.Symbol, prev.Name))
					}
					symbols[item.Symbol] = item
				}
			}
		}
	}
	for _, mod := range bundle.Modules {
		for _, op := range mod.Ops {
			d = append(d, checkOp(mod.File, op, symbols)...)
		}
	}
	d = append(d, checkRequiredAPISymbols(symbols)...)
	return d
}

func checkOp(file string, op Operation, symbols map[string]Operation) Diagnostics {
	var d Diagnostics
	dialect := opDialect(op.Name)
	if dialect == "" {
		d = append(d, diag("error", file, op.Line, "operation %q has no dialect prefix", op.Name))
	} else if !knownDialects[dialect] {
		d = append(d, diag("error", file, op.Line, "operation %q uses unknown dialect @%s", op.Name, dialect))
	}
	if op.Name == "ax.agent.runtime" {
		d = append(d, diag("error", file, op.Line, "ax.agent runtime lowering is reserved in V1"))
	}
	if op.Symbol == "" && AttrString(op, "public") == "true" {
		d = append(d, diag("error", file, op.Line, "public operation %q must have a symbol", op.Name))
	}
	for _, attr := range op.Attributes {
		if attr.Kind == "ref" {
			ref := strings.TrimPrefix(fmt.Sprint(attr.Value), "@")
			if _, ok := symbols[ref]; !ok {
				d = append(d, diag("error", file, attr.Line, "missing ref @%s", ref))
			}
		}
		if attr.Name == "callee" {
			callee := fmt.Sprint(attr.Value)
			if strings.HasPrefix(callee, "@") {
				ref := strings.TrimPrefix(callee, "@")
				if _, ok := symbols[ref]; !ok {
					d = append(d, diag("error", file, attr.Line, "missing callee @%s", ref))
				}
			}
		}
		if attr.Name == "core_kind" {
			kind := fmt.Sprint(attr.Value)
			if !oneOf(kind, "package", "record", "enum", "interface", "func", "method", "error", "semantic") {
				d = append(d, diag("error", file, attr.Line, "invalid core_kind %q", kind))
			}
		}
	}
	for _, child := range op.Ops {
		d = append(d, checkOp(file, child, symbols)...)
	}
	for _, region := range op.Regions {
		d = append(d, checkRegion(file, op, region)...)
		for _, block := range region.Blocks {
			for _, child := range block.Ops {
				d = append(d, checkOp(file, child, symbols)...)
			}
		}
	}
	return d
}

func checkRegion(file string, parent Operation, region Region) Diagnostics {
	var d Diagnostics
	if region.Name != "body" {
		return d
	}
	if parent.Symbol == "" {
		return d
	}
	if len(region.Blocks) == 0 {
		return append(d, diag("error", file, region.Line, "region @body on @%s must contain at least one block", parent.Symbol))
	}
	if _, err := BuildCoreBody(parent); err != nil {
		d = append(d, diag("error", file, region.Line, "%s", err))
	}
	for _, block := range region.Blocks {
		if len(block.Ops) == 0 {
			d = append(d, diag("error", file, block.Line, "block @%s must contain a terminator", block.Name))
			continue
		}
		last := block.Ops[len(block.Ops)-1]
		if last.Name != "core.return" && last.Name != "core.raise" {
			d = append(d, diag("error", file, last.Line, "block @%s missing terminator", block.Name))
		}
	}
	return d
}

func valueRefs(op Operation) []string {
	var out []string
	for _, attr := range op.Attributes {
		for _, value := range attr.Values {
			if s, ok := value.(string); ok && strings.HasPrefix(s, "%") {
				out = append(out, s)
			}
		}
		if s, ok := attr.Value.(string); ok && strings.HasPrefix(s, "%") && attr.Name != "result" {
			out = append(out, s)
		}
	}
	return out
}

func checkRequiredAPISymbols(symbols map[string]Operation) Diagnostics {
	var d Diagnostics
	for _, symbol := range betaRuntimeSymbols {
		if _, ok := symbols[symbol]; !ok {
			d = append(d, diag("error", "", 0, "required Ax API symbol @%s is missing", symbol))
		}
	}
	return d
}

func allOpTree(op Operation) []Operation {
	var out []Operation
	return appendOps(out, op)
}

func opDialect(name string) string {
	idx := strings.LastIndex(name, ".")
	if idx <= 0 {
		return ""
	}
	return name[:idx]
}

func diag(severity, file string, line int, format string, args ...interface{}) Diagnostic {
	return Diagnostic{
		Severity: severity,
		File:     file,
		Line:     line,
		Message:  fmt.Sprintf(format, args...),
	}
}

func oneOf(value string, values ...string) bool {
	for _, item := range values {
		if value == item {
			return true
		}
	}
	return false
}
