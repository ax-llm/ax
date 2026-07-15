package axir

import (
	"fmt"
	"strings"
)

var knownDialects = map[string]bool{
	"core":         true,
	"ax.api":       true,
	"ax.program":   true,
	"ax.signature": true,
	"ax.schema":    true,
	"ax.validate":  true,
	"ax.template":  true,
	"ax.ai":        true,
	"ax.tool":      true,
	"ax.gen":       true,
	"ax.optimize":  true,
	"ax.stream":    true,
	"ax.provider":  true,
	"ax.agent":     true,
	"ax.flow":      true,
	"ax.mcp":       true,
	"ax.event":     true,
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

var knownOperationNames = map[string]bool{
	"core.package":          true,
	"core.enum":             true,
	"core.record":           true,
	"core.interface":        true,
	"core.func":             true,
	"core.method":           true,
	"core.error":            true,
	"core.semantic":         true,
	"ax.agent.error":        true,
	"ax.agent.policy":       true,
	"ax.agent.record":       true,
	"ax.agent.runtime":      true,
	"ax.agent.semantic":     true,
	"ax.agent.stub":         true,
	"ax.agent.trace":        true,
	"ax.ai.error":           true,
	"ax.ai.interface":       true,
	"ax.ai.record":          true,
	"ax.ai.semantic":        true,
	"ax.api.class":          true,
	"ax.api.function":       true,
	"ax.api.package":        true,
	"ax.program.interface":  true,
	"ax.program.semantic":   true,
	"ax.gen.semantic":       true,
	"ax.flow.record":        true,
	"ax.flow.semantic":      true,
	"ax.mcp.interface":      true,
	"ax.mcp.record":         true,
	"ax.mcp.semantic":       true,
	"ax.event.interface":    true,
	"ax.event.record":       true,
	"ax.event.semantic":     true,
	"ax.optimize.artifact":  true,
	"ax.optimize.component": true,
	"ax.optimize.semantic":  true,
	"ax.provider.class":     true,
	"ax.provider.semantic":  true,
	"ax.schema.record":      true,
	"ax.schema.semantic":    true,
	"ax.signature.record":   true,
	"ax.signature.semantic": true,
	"ax.stream.semantic":    true,
	"ax.template.record":    true,
	"ax.template.semantic":  true,
	"ax.tool.interface":     true,
	"ax.tool.record":        true,
	"ax.tool.semantic":      true,
	"ax.validate.error":     true,
	"ax.validate.semantic":  true,
}

func Check(bundle Bundle) Diagnostics {
	return CheckWithOptions(bundle, CheckOptions{})
}

func CheckWithOptions(bundle Bundle, opts CheckOptions) Diagnostics {
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
	d = append(d, CheckTypes(bundle, symbols)...)
	d = append(d, CheckTypeUsage(bundle, symbols, opts)...)
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
	if !knownOperationNames[op.Name] && !coreBodyOps[op.Name] {
		if suggestion := closestString(op.Name, sortedOperationNames()); suggestion != "" {
			d = append(d, diag("error", file, op.Line, "unknown operation %q; did you mean %q?", op.Name, suggestion))
		} else {
			d = append(d, diag("error", file, op.Line, "unknown operation %q", op.Name))
		}
	}
	if op.Symbol == "" && AttrString(op, "public") == "true" {
		d = append(d, diag("error", file, op.Line, "public operation %q must have a symbol", op.Name))
	}
	if strings.HasPrefix(op.Name, "ax.") && AttrString(op, "core_kind") == "" {
		d = append(d, diag("error", file, op.Line, "Ax dialect operation %q must declare attr core_kind", op.Name))
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
			} else if strings.HasPrefix(callee, "intrinsic.") {
				if !knownCoreIntrinsics[callee] {
					d = append(d, diag("error", file, attr.Line, "%s", unknownCoreIntrinsicError(callee)))
				}
			} else if !strings.HasPrefix(callee, "_") {
				if _, ok := symbols[callee]; !ok && !isGeneratedCoreFunctionName(symbols, callee) {
					d = append(d, diag("error", file, attr.Line, "missing callee @%s; use @%s for symbol calls or define @%s", callee, callee, callee))
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

func isGeneratedCoreFunctionName(symbols map[string]Operation, name string) bool {
	for sym, op := range symbols {
		if sym == name {
			return true
		}
		private := AttrString(op, "private") == "true"
		if nativeCoreFuncName(sym, op, private) == name {
			return true
		}
	}
	return false
}

func sortedOperationNames() []string {
	keys := make([]string, 0, len(knownOperationNames)+len(coreBodyOps))
	for key := range knownOperationNames {
		keys = append(keys, key)
	}
	for key := range coreBodyOps {
		keys = append(keys, key)
	}
	return sortedStrings(keys)
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
