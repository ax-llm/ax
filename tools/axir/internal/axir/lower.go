package axir

import "sort"

func LowerToCore(bundle Bundle) Module {
	core := Module{
		Name:    bundle.Root + ".lowered",
		Version: Version,
		Dialects: []Dialect{
			{Name: "core", Version: Version},
		},
	}
	var ops []Operation
	for _, mod := range bundle.Modules {
		for _, op := range mod.Ops {
			ops = append(ops, lowerOpTree(op)...)
		}
	}
	sort.SliceStable(ops, func(i, j int) bool {
		if ops[i].Name == ops[j].Name {
			return ops[i].Symbol < ops[j].Symbol
		}
		return ops[i].Name < ops[j].Name
	})
	core.Ops = ops
	return core
}

func lowerOpTree(op Operation) []Operation {
	var out []Operation
	if lowered, ok := lowerOp(op); ok {
		out = append(out, lowered)
	}
	for _, child := range op.Ops {
		out = append(out, lowerOpTree(child)...)
	}
	return out
}

func lowerOp(op Operation) (Operation, bool) {
	if opDialect(op.Name) == "core" {
		return op, true
	}
	kind := AttrString(op, "core_kind")
	if kind == "" {
		return Operation{}, false
	}
	name := "core." + kind
	attrs := append([]Attribute(nil), op.Attributes...)
	attrs = append(attrs, Attribute{Kind: "attr", Name: "source_op", Value: op.Name})
	if len(op.Regions) > 0 {
		attrs = append(attrs, Attribute{Kind: "attr", Name: "body_source", Value: "core"})
	}
	return Operation{
		Name:       name,
		Symbol:     op.Symbol,
		Attributes: attrs,
		Regions:    copyRegions(op.Regions),
		Line:       op.Line,
	}, true
}

func copyRegions(regions []Region) []Region {
	out := make([]Region, 0, len(regions))
	for _, region := range regions {
		next := Region{Name: region.Name, Line: region.Line}
		for _, block := range region.Blocks {
			nextBlock := Block{Name: block.Name, Args: append([]Value(nil), block.Args...), Line: block.Line}
			nextBlock.Ops = append([]Operation(nil), block.Ops...)
			next.Blocks = append(next.Blocks, nextBlock)
		}
		out = append(out, next)
	}
	return out
}
