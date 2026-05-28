package axir

import (
	"fmt"
	"sort"
	"strings"
)

func Explain(bundle Bundle, symbol string) (string, error) {
	symbol = Symbol(symbol)
	core := LowerToCore(bundle)
	op, ok := findSymbol(core, symbol)
	if !ok {
		return "", fmt.Errorf("symbol @%s not found", symbol)
	}
	var b strings.Builder
	fmt.Fprintf(&b, "symbol @%s\n", symbol)
	fmt.Fprintf(&b, "operation %s\n", op.Name)
	for _, name := range []string{"core_kind", "body_source", "emit_module", "effect", "private", "public"} {
		if value := AttrString(op, name); value != "" {
			fmt.Fprintf(&b, "%s %s\n", name, value)
		}
	}
	if signature := AttrString(op, "signature"); signature != "" {
		fmt.Fprintf(&b, "signature %s\n", signature)
	}
	refs, intrinsics := explainCalls(op)
	if len(refs) > 0 {
		b.WriteString("calls\n")
		for _, ref := range refs {
			fmt.Fprintf(&b, "- @%s\n", strings.TrimPrefix(ref, "@"))
		}
	}
	if len(intrinsics) > 0 {
		b.WriteString("intrinsics\n")
		for _, intrinsic := range intrinsics {
			info := ""
			if meta, ok := coreIntrinsicInfo[intrinsic]; ok && meta.HostBoundary {
				info = " host-boundary"
			}
			fmt.Fprintf(&b, "- %s%s\n", intrinsic, info)
		}
	}
	tags := opTags(op)
	if len(tags) > 0 {
		b.WriteString("tags\n")
		for _, tag := range tags {
			fmt.Fprintf(&b, "- %s\n", tag)
		}
	}
	b.WriteString("normalized_core\n")
	b.WriteString(FormatModule(Module{Name: core.Name, Version: core.Version, Ops: []Operation{op}}))
	return b.String(), nil
}

func findSymbol(bundle Module, symbol string) (Operation, bool) {
	for _, op := range bundle.Ops {
		if found, ok := findSymbolInOp(op, symbol); ok {
			return found, true
		}
	}
	return Operation{}, false
}

func findSymbolInOp(op Operation, symbol string) (Operation, bool) {
	if op.Symbol == symbol {
		return op, true
	}
	for _, child := range op.Ops {
		if found, ok := findSymbolInOp(child, symbol); ok {
			return found, true
		}
	}
	for _, region := range op.Regions {
		for _, block := range region.Blocks {
			for _, child := range block.Ops {
				if found, ok := findSymbolInOp(child, symbol); ok {
					return found, true
				}
			}
		}
	}
	return Operation{}, false
}

func explainCalls(op Operation) ([]string, []string) {
	refSet := map[string]bool{}
	intrinsicSet := map[string]bool{}
	collectCalls(op, refSet, intrinsicSet)
	return sortedSet(refSet), sortedSet(intrinsicSet)
}

func collectCalls(op Operation, refs, intrinsics map[string]bool) {
	if op.Name == "core.call" {
		callee := AttrString(op, "callee")
		if strings.HasPrefix(callee, "@") {
			refs[callee] = true
		} else if strings.HasPrefix(callee, "intrinsic.") {
			intrinsics[callee] = true
		} else if callee != "" && !strings.HasPrefix(callee, "_") {
			refs["@"+callee] = true
		}
	}
	for _, child := range op.Ops {
		collectCalls(child, refs, intrinsics)
	}
	for _, region := range op.Regions {
		for _, block := range region.Blocks {
			for _, child := range block.Ops {
				collectCalls(child, refs, intrinsics)
			}
		}
	}
}

func opTags(op Operation) []string {
	var tags []string
	for _, attr := range op.Attributes {
		if attr.Kind == "tag" {
			tags = append(tags, fmt.Sprint(attr.Value))
		}
	}
	sort.Strings(tags)
	return tags
}

func sortedSet(values map[string]bool) []string {
	out := make([]string, 0, len(values))
	for value := range values {
		out = append(out, value)
	}
	sort.Strings(out)
	return out
}
