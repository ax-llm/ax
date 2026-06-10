package axir

import (
	"strings"
)

// CheckOptions controls the optional strictness of the typed checker.
type CheckOptions struct {
	// StrictTypes additionally reports advisory findings: core functions
	// called without a declared signature, and rebinds that change a
	// binding's concrete kind.
	StrictTypes bool
}

// kind classes used for coarse dataflow checking. "json" and "unknown" are
// permissive tops; only definite concrete mismatches are reported.
func kindOfTypeName(name string) string {
	switch name {
	case "list":
		return "list"
	case "map":
		return "map"
	case "string":
		return "string"
	case "bool":
		return "bool"
	case "i64", "f64", "number":
		return "number"
	case "void":
		return "void"
	case "json":
		return "json"
	default:
		return "unknown"
	}
}

func kindOfTypeExpr(expr TypeExpr) string {
	switch expr.Kind {
	case "builtin":
		return kindOfTypeName(expr.Name)
	case "generic":
		return kindOfTypeName(expr.Name)
	default:
		return "unknown"
	}
}

func concreteKind(kind string) bool {
	switch kind {
	case "list", "map", "string", "bool", "number":
		return true
	}
	return false
}

// CheckTypeUsage walks every Core body and validates call arity against the
// callee's declared signature, throws-effect propagation (a call to a
// throwing function must be wrapped in core.try or made from a function that
// itself declares throws), and coarse kind discipline for container and
// string operations.
func CheckTypeUsage(bundle Bundle, symbols map[string]Operation, opts CheckOptions) Diagnostics {
	specs := map[string]*SignatureSpec{}
	throws := map[string]bool{}
	for sym, op := range symbols {
		if AttrString(op, "effect") == "throws" {
			throws[sym] = true
		}
		raw := AttrString(op, "signature")
		if raw == "" || !strings.HasPrefix(strings.TrimSpace(raw), "(") {
			continue
		}
		if spec, err := ParseSignatureString(raw); err == nil {
			spec := spec
			specs[sym] = &spec
			if spec.HasEffect("throws") {
				throws[sym] = true
			}
		}
	}
	var d Diagnostics
	for _, module := range bundle.Modules {
		for _, op := range module.Ops {
			if _, ok := findRegion(op, "body"); !ok {
				continue
			}
			body, err := BuildCoreBody(op)
			if err != nil {
				continue // the structural checker reports body errors
			}
			w := &typeUsageWalker{
				file:         module.File,
				owner:        op.Symbol,
				specs:        specs,
				throws:       throws,
				symbols:      symbols,
				callerThrows: throws[op.Symbol],
				strict:       opts.StrictTypes,
			}
			for _, block := range body.Blocks {
				kinds := map[string]string{}
				for _, arg := range block.Args {
					kinds["%"+arg.Name] = kindOfTypeName(arg.Type.Name)
				}
				w.walk(block.Stmts, kinds, false)
			}
			d = append(d, w.diags...)
		}
	}
	return d
}

type typeUsageWalker struct {
	file         string
	owner        string
	specs        map[string]*SignatureSpec
	throws       map[string]bool
	symbols      map[string]Operation
	callerThrows bool
	strict       bool
	diags        Diagnostics
}

func (w *typeUsageWalker) errorf(line int, format string, args ...interface{}) {
	w.diags = append(w.diags, diag("error", w.file, line, "@"+w.owner+": "+format, args...))
}

func (w *typeUsageWalker) warnf(line int, format string, args ...interface{}) {
	w.diags = append(w.diags, diag("warning", w.file, line, "@"+w.owner+": "+format, args...))
}

func copyKindMap(in map[string]string) map[string]string {
	out := make(map[string]string, len(in))
	for k, v := range in {
		out[k] = v
	}
	return out
}

func (w *typeUsageWalker) setKind(kinds map[string]string, ref, kind string, line int) {
	if ref == "" {
		return
	}
	if w.strict {
		if prev, ok := kinds[ref]; ok && concreteKind(prev) && concreteKind(kind) && prev != kind {
			w.warnf(line, "rebinds %s from %s to %s", ref, prev, kind)
		}
	}
	kinds[ref] = kind
}

// requireKind flags refs whose tracked kind is concretely different from the
// expected one; json/unknown bindings always pass.
func (w *typeUsageWalker) requireKind(kinds map[string]string, ref, want, context string, line int) {
	if !strings.HasPrefix(ref, "%") {
		return
	}
	kind, ok := kinds[ref]
	if !ok || !concreteKind(kind) {
		return
	}
	if kind != want {
		w.warnf(line, "%s is %s, which has kind %s (want %s)", context, ref, kind, want)
	}
}

func (w *typeUsageWalker) requireContainer(kinds map[string]string, ref, context string, line int) {
	if !strings.HasPrefix(ref, "%") {
		return
	}
	kind, ok := kinds[ref]
	if !ok || !concreteKind(kind) {
		return
	}
	if kind != "map" && kind != "list" {
		w.warnf(line, "%s is %s, which has kind %s (want map or list)", context, ref, kind)
	}
}

func literalKind(value interface{}, kinds map[string]string) string {
	switch v := value.(type) {
	case string:
		if strings.HasPrefix(v, "%") {
			if kind, ok := kinds[v]; ok {
				return kind
			}
			return "unknown"
		}
		return "string"
	case bool:
		return "bool"
	case float64, int, int64:
		return "number"
	default:
		return "unknown"
	}
}

func (w *typeUsageWalker) walkRegions(stmt CoreStmt, kinds map[string]string, inTry bool, extraBindings ...string) {
	for i, region := range stmt.Regions {
		childInTry := inTry
		if stmt.Kind == "try" {
			// statements in the try region are protected; the catch region
			// (and anything after) is not.
			childInTry = inTry || i == 0
		}
		child := copyKindMap(kinds)
		for _, binding := range extraBindings {
			if binding != "" {
				child[binding] = "json"
			}
		}
		for _, block := range region.Blocks {
			for _, arg := range block.Args {
				child["%"+arg.Name] = kindOfTypeName(arg.Type.Name)
			}
			w.walk(block.Stmts, child, childInTry)
		}
	}
}

func (w *typeUsageWalker) walk(stmts []CoreStmt, kinds map[string]string, inTry bool) {
	for _, stmt := range stmts {
		line := stmt.Line
		switch stmt.Kind {
		case "call":
			w.checkCall(stmt, kinds, inTry)
		case "list":
			w.setKind(kinds, stmt.Result, "list", line)
		case "map":
			w.setKind(kinds, stmt.Result, "map", line)
		case "string_join":
			if ref, ok := stmt.Value.(string); ok {
				w.requireKind(kinds, ref, "list", "core.string_join value", line)
			}
			w.setKind(kinds, stmt.Result, "string", line)
		case "string_trim":
			w.setKind(kinds, stmt.Result, "string", line)
		case "type_is", "regex_match":
			w.setKind(kinds, stmt.Result, "bool", line)
		case "get":
			w.requireContainer(kinds, stmt.Target, "core.get target", line)
			w.setKind(kinds, stmt.Result, "json", line)
		case "set":
			w.requireContainer(kinds, stmt.Target, "core.set target", line)
		case "append":
			w.requireKind(kinds, stmt.Target, "list", "core.append target", line)
		case "const", "let":
			value, _ := Attr(stmt.Op, "value")
			w.setKind(kinds, stmt.Result, literalKind(value.Value, kinds), line)
		case "for":
			w.requireKind(kinds, stmt.Iter, "list", "core.for iterable", line)
			w.walkRegions(stmt, kinds, inTry, stmt.Item)
		case "if", "loop", "switch":
			w.walkRegions(stmt, kinds, inTry)
		case "try":
			w.walkRegions(stmt, kinds, inTry)
		case "raise":
			if !inTry && !w.callerThrows {
				w.errorf(line, "raises but does not declare throws (and is not inside core.try)")
			}
		}
	}
}

func (w *typeUsageWalker) checkCall(stmt CoreStmt, kinds map[string]string, inTry bool) {
	line := stmt.Line
	callee := stmt.Callee
	if strings.HasPrefix(callee, "intrinsic.") {
		if info, ok := coreIntrinsicInfo[callee]; ok && stmt.Result != "" {
			w.setKind(kinds, stmt.Result, kindOfTypeName(info.ReturnKind), line)
		}
		return
	}
	if !strings.HasPrefix(callee, "@") {
		return
	}
	sym := Symbol(callee)
	spec := w.specs[sym]
	if spec == nil {
		if _, declared := w.symbols[sym]; declared && w.strict {
			w.warnf(line, "calls @%s which has no parseable type signature", sym)
		}
		if w.throws[sym] && !inTry && !w.callerThrows {
			w.errorf(line, "calls @%s which throws, but neither declares throws nor wraps the call in core.try", sym)
		}
		return
	}
	argc := len(stmt.Args)
	if argc < spec.RequiredParams() || argc > len(spec.Params) {
		w.errorf(line, "calls @%s with %d argument(s); signature %s takes %d required and %d total",
			sym, argc, signatureSummary(*spec), spec.RequiredParams(), len(spec.Params))
	}
	if w.throws[sym] && !inTry && !w.callerThrows {
		w.errorf(line, "calls @%s which throws, but neither declares throws nor wraps the call in core.try", sym)
	}
	if stmt.Result != "" {
		kind := kindOfTypeExpr(spec.Return)
		if kind == "void" {
			w.warnf(line, "assigns the result of @%s, which returns void", sym)
			kind = "unknown"
		}
		w.setKind(kinds, stmt.Result, kind, line)
	}
}

func signatureSummary(spec SignatureSpec) string {
	var parts []string
	for _, param := range spec.Params {
		text := param.Name
		if text == "" {
			text = "_"
		}
		if param.Optional {
			text += "?"
		}
		parts = append(parts, text)
	}
	return "(" + strings.Join(parts, ", ") + ")"
}
