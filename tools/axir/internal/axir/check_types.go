package axir

import (
	"fmt"
	"strings"
)

// typeAttrValueAllowlist names type-slot attributes whose values are known
// config-value abuses ("type default_base_url = ..."), tolerated until the
// planned migration to attr slots. Everything else in a type slot must parse
// as a type expression, a field list, or a function signature.
var typeAttrValueAllowlist = map[string]bool{
	"default_base_url": true,
	"value":            true,
}

// knownTypeNames collects the symbols usable as named types in signature and
// fields strings: declared records, enums, interfaces, and error shapes,
// whether marked via core_kind or via the operation name itself.
func knownTypeNames(symbols map[string]Operation) map[string]bool {
	known := map[string]bool{}
	for sym, op := range symbols {
		switch AttrString(op, "core_kind") {
		case "record", "enum", "interface", "error":
			known[sym] = true
			continue
		}
		for _, suffix := range []string{".record", ".enum", ".interface", ".error", ".class"} {
			if strings.HasSuffix(op.Name, suffix) {
				known[sym] = true
				break
			}
		}
	}
	return known
}

// CheckTypes validates every `type ...` attribute in the bundle: signature
// strings and method types must parse as signatures, fields strings as field
// lists, and all referenced named types must resolve to declared symbols.
func CheckTypes(bundle Bundle, symbols map[string]Operation) Diagnostics {
	known := knownTypeNames(symbols)
	var d Diagnostics
	for _, module := range bundle.Modules {
		for _, op := range module.Ops {
			d = append(d, checkOpTypeAttrs(module.File, op, known)...)
		}
	}
	return d
}

func checkOpTypeAttrs(file string, op Operation, known map[string]bool) Diagnostics {
	var d Diagnostics
	for _, attr := range op.Attributes {
		if attr.Kind != "type" {
			continue
		}
		value, ok := attr.Value.(string)
		if !ok {
			continue
		}
		owner := op.Symbol
		if owner == "" {
			owner = op.Name
		}
		report := func(format string, args ...interface{}) {
			d = append(d, diag("error", file, attr.Line, "@%s type %s: %s", owner, attr.Name, fmt.Sprintf(format, args...)))
		}
		var named []string
		switch {
		case strings.HasPrefix(strings.TrimSpace(value), "("):
			spec, err := ParseSignatureString(value)
			if err != nil {
				report("%v", err)
				continue
			}
			for _, param := range spec.Params {
				named = append(named, param.Type.NamedTypes()...)
			}
			named = append(named, spec.Return.NamedTypes()...)
		case attr.Name == "fields":
			fields, err := ParseFieldsString(value)
			if err != nil {
				report("%v", err)
				continue
			}
			for _, field := range fields {
				named = append(named, field.Type.NamedTypes()...)
			}
		case typeAttrValueAllowlist[attr.Name]:
			continue
		default:
			expr, err := ParseTypeExpr(value)
			if err != nil {
				report("value is not a type expression; config values belong in attr slots (%v)", err)
				continue
			}
			named = expr.NamedTypes()
		}
		for _, name := range named {
			if !known[name] {
				report("references unknown type %q (no record/enum/interface/error symbol declares it)", name)
			}
		}
	}
	for _, region := range op.Regions {
		for _, block := range region.Blocks {
			for _, child := range block.Ops {
				d = append(d, checkOpTypeAttrs(file, child, known)...)
			}
		}
	}
	for _, child := range op.Ops {
		d = append(d, checkOpTypeAttrs(file, child, known)...)
	}
	return d
}
