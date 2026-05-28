package axir

import (
	"fmt"
	"sort"
	"strconv"
	"strings"
)

type FormatOptions struct {
	CompactCore bool
}

func FormatModule(mod Module) string {
	return FormatModuleWithOptions(mod, FormatOptions{})
}

func FormatModuleCompact(mod Module) string {
	return FormatModuleWithOptions(mod, FormatOptions{CompactCore: true})
}

func FormatModuleWithOptions(mod Module, opts FormatOptions) string {
	var b strings.Builder
	fmt.Fprintf(&b, "module @%s version %s {\n", mod.Name, quote(mod.Version))
	for _, imp := range mod.Imports {
		fmt.Fprintf(&b, "  import @%s from %s\n", imp.Symbol, quote(imp.Path))
	}
	if len(mod.Imports) > 0 && (len(mod.Dialects) > 0 || len(mod.Ops) > 0) {
		b.WriteByte('\n')
	}
	for _, dialect := range mod.Dialects {
		fmt.Fprintf(&b, "  dialect @%s version %s\n", dialect.Name, quote(dialect.Version))
	}
	for _, op := range mod.Ops {
		b.WriteByte('\n')
		formatOp(&b, op, 2, opts)
	}
	b.WriteString("}\n")
	return b.String()
}

func FormatBundle(bundle Bundle) string {
	var b strings.Builder
	for i, mod := range bundle.Modules {
		if i > 0 {
			b.WriteByte('\n')
		}
		b.WriteString(FormatModule(mod))
	}
	return b.String()
}

func formatOp(b *strings.Builder, op Operation, indent int, opts FormatOptions) {
	pad := strings.Repeat(" ", indent)
	fmt.Fprintf(b, "%sop %s", pad, op.Name)
	if op.Symbol != "" {
		fmt.Fprintf(b, " @%s", op.Symbol)
	}
	b.WriteString(" {\n")
	attrs := append([]Attribute(nil), op.Attributes...)
	sort.SliceStable(attrs, func(i, j int) bool {
		if attrs[i].Kind == attrs[j].Kind {
			return attrs[i].Name < attrs[j].Name
		}
		return attrs[i].Kind < attrs[j].Kind
	})
	for _, attr := range attrs {
		formatAttr(b, attr, indent+2)
	}
	for _, child := range op.Ops {
		formatOp(b, child, indent+2, opts)
	}
	for _, region := range op.Regions {
		formatRegion(b, region, indent+2, opts)
	}
	fmt.Fprintf(b, "%s}\n", pad)
}

func formatAttr(b *strings.Builder, attr Attribute, indent int) {
	pad := strings.Repeat(" ", indent)
	if attr.Kind == "tag" {
		fmt.Fprintf(b, "%stag %s\n", pad, quote(fmt.Sprint(attr.Value)))
		return
	}
	fmt.Fprintf(b, "%s%s %s = ", pad, attr.Kind, attr.Name)
	if len(attr.Values) > 0 {
		b.WriteByte('[')
		for i, value := range attr.Values {
			if i > 0 {
				b.WriteString(", ")
			}
			b.WriteString(formatValue(value))
		}
		b.WriteString("]\n")
		return
	}
	fmt.Fprintf(b, "%s\n", formatValue(attr.Value))
}

func formatRegion(b *strings.Builder, region Region, indent int, opts FormatOptions) {
	pad := strings.Repeat(" ", indent)
	if opts.CompactCore && region.Name == "body" && len(region.Blocks) == 1 {
		block := region.Blocks[0]
		fmt.Fprintf(b, "%sbody @%s", pad, block.Name)
		formatBlockArgs(b, block.Args)
		b.WriteString(" {\n")
		for _, op := range block.Ops {
			formatBlockOp(b, op, indent+2, opts)
		}
		fmt.Fprintf(b, "%s}\n", pad)
		return
	}
	fmt.Fprintf(b, "%sregion @%s {\n", pad, region.Name)
	for _, block := range region.Blocks {
		fmt.Fprintf(b, "%s  block @%s", pad, block.Name)
		formatBlockArgs(b, block.Args)
		b.WriteString(" {\n")
		for _, op := range block.Ops {
			formatBlockOp(b, op, indent+4, opts)
		}
		fmt.Fprintf(b, "%s  }\n", pad)
	}
	fmt.Fprintf(b, "%s}\n", pad)
}

func formatBlockArgs(b *strings.Builder, args []Value) {
	if len(args) == 0 {
		return
	}
	b.WriteByte('(')
	for i, arg := range args {
		if i > 0 {
			b.WriteString(", ")
		}
		fmt.Fprintf(b, "%%%s: %s", arg.Name, formatType(arg.Type))
	}
	b.WriteByte(')')
}

func formatBlockOp(b *strings.Builder, op Operation, indent int, opts FormatOptions) {
	if opts.CompactCore && formatCompactCoreOp(b, op, indent, opts) {
		return
	}
	formatOp(b, op, indent, opts)
}

func formatCompactCoreOp(b *strings.Builder, op Operation, indent int, opts FormatOptions) bool {
	if !strings.HasPrefix(op.Name, "core.") {
		return false
	}
	pad := strings.Repeat(" ", indent)
	result := AttrString(op, "result")
	switch op.Name {
	case "core.list", "core.map":
		if result == "" {
			return false
		}
		fmt.Fprintf(b, "%s%s = %s\n", pad, result, op.Name)
		return true
	case "core.call":
		callee := AttrString(op, "callee")
		if callee == "" {
			return false
		}
		if result != "" {
			fmt.Fprintf(b, "%s%s = ", pad, result)
		} else {
			b.WriteString(pad)
		}
		fmt.Fprintf(b, "core.call %s(", callee)
		values := attrValuesForFormat(op, "args")
		for i, value := range values {
			if i > 0 {
				b.WriteString(", ")
			}
			b.WriteString(formatValue(value))
		}
		b.WriteString(")\n")
		return true
	case "core.get":
		target, key := AttrString(op, "target"), attrRaw(op, "key")
		if result == "" || target == "" || key == nil {
			return false
		}
		fmt.Fprintf(b, "%s%s = core.get %s[%s]", pad, result, target, formatValue(key))
		if value, ok := attrMaybe(op, "default"); ok {
			fmt.Fprintf(b, " default %s", formatValue(value))
		}
		b.WriteByte('\n')
		return true
	case "core.const", "core.let", "core.string_trim":
		value, ok := attrMaybe(op, "value")
		if result == "" || !ok {
			return false
		}
		fmt.Fprintf(b, "%s%s = %s %s\n", pad, result, op.Name, formatValue(value))
		return true
	case "core.string_join":
		value, ok := attrMaybe(op, "value")
		if result == "" || !ok {
			return false
		}
		fmt.Fprintf(b, "%s%s = core.string_join %s", pad, result, formatValue(value))
		if sep, ok := attrMaybe(op, "sep"); ok {
			fmt.Fprintf(b, " sep %s", formatValue(sep))
		}
		b.WriteByte('\n')
		return true
	case "core.regex_match":
		value, valueOK := attrMaybe(op, "value")
		pattern, patternOK := attrMaybe(op, "pattern")
		if result == "" || !valueOK || !patternOK {
			return false
		}
		fmt.Fprintf(b, "%s%s = core.regex_match %s pattern %s\n", pad, result, formatValue(value), formatValue(pattern))
		return true
	case "core.type_is":
		value, valueOK := attrMaybe(op, "value")
		typ, typeOK := attrMaybe(op, "type")
		if result == "" || !valueOK || !typeOK {
			return false
		}
		fmt.Fprintf(b, "%s%s = core.type_is %s type %s\n", pad, result, formatValue(value), formatValue(typ))
		return true
	case "core.set":
		target, key, value := AttrString(op, "target"), attrRaw(op, "key"), attrRaw(op, "value")
		if target == "" || key == nil || value == nil {
			return false
		}
		fmt.Fprintf(b, "%score.set %s[%s] = %s\n", pad, target, formatValue(key), formatValue(value))
		return true
	case "core.append":
		target, value := AttrString(op, "target"), attrRaw(op, "value")
		if target == "" || value == nil {
			return false
		}
		fmt.Fprintf(b, "%score.append %s, %s\n", pad, target, formatValue(value))
		return true
	case "core.return":
		if value, ok := attrMaybe(op, "value"); ok {
			fmt.Fprintf(b, "%score.return %s\n", pad, formatValue(value))
		} else {
			fmt.Fprintf(b, "%score.return\n", pad)
		}
		return true
	case "core.raise":
		if value, ok := attrMaybe(op, "error"); ok {
			fmt.Fprintf(b, "%score.raise %s\n", pad, formatValue(value))
			return true
		}
		if value, ok := attrMaybe(op, "message"); ok {
			fmt.Fprintf(b, "%score.raise %s\n", pad, formatValue(value))
			return true
		}
		return false
	case "core.break", "core.continue":
		fmt.Fprintf(b, "%s%s\n", pad, op.Name)
		return true
	case "core.if":
		cond := AttrString(op, "condition")
		if cond == "" || len(op.Regions) != 2 {
			return false
		}
		fmt.Fprintf(b, "%score.if %s {\n", pad, cond)
		formatSingleRegionBody(b, op.Regions[0], indent+2, opts)
		fmt.Fprintf(b, "%s} else {\n", pad)
		formatSingleRegionBody(b, op.Regions[1], indent+2, opts)
		fmt.Fprintf(b, "%s}\n", pad)
		return true
	case "core.for":
		item, iter := AttrString(op, "item"), AttrString(op, "in")
		if item == "" || iter == "" || len(op.Regions) != 1 {
			return false
		}
		fmt.Fprintf(b, "%score.for %s in %s {\n", pad, item, iter)
		formatSingleRegionBody(b, op.Regions[0], indent+2, opts)
		fmt.Fprintf(b, "%s}\n", pad)
		return true
	case "core.loop":
		if len(op.Regions) != 1 {
			return false
		}
		fmt.Fprintf(b, "%score.loop {\n", pad)
		formatSingleRegionBody(b, op.Regions[0], indent+2, opts)
		fmt.Fprintf(b, "%s}\n", pad)
		return true
	case "core.try":
		if len(op.Regions) != 2 {
			return false
		}
		errRef := AttrString(op, "error")
		if errRef == "" {
			return false
		}
		fmt.Fprintf(b, "%score.try {\n", pad)
		formatSingleRegionBody(b, op.Regions[0], indent+2, opts)
		fmt.Fprintf(b, "%s} catch %s {\n", pad, errRef)
		formatSingleRegionBody(b, op.Regions[1], indent+2, opts)
		fmt.Fprintf(b, "%s}\n", pad)
		return true
	default:
		return false
	}
}

func formatSingleRegionBody(b *strings.Builder, region Region, indent int, opts FormatOptions) {
	if len(region.Blocks) == 0 {
		return
	}
	for _, op := range region.Blocks[0].Ops {
		formatBlockOp(b, op, indent, opts)
	}
}

func attrMaybe(op Operation, name string) (interface{}, bool) {
	attr, ok := Attr(op, name)
	if !ok {
		return nil, false
	}
	return attr.Value, true
}

func attrRaw(op Operation, name string) interface{} {
	value, _ := attrMaybe(op, name)
	return value
}

func attrValuesForFormat(op Operation, name string) []interface{} {
	attr, ok := Attr(op, name)
	if !ok {
		return nil
	}
	return attr.Values
}

func formatType(typ Type) string {
	if len(typ.Args) == 0 {
		return typ.Name
	}
	args := make([]string, 0, len(typ.Args))
	for _, arg := range typ.Args {
		args = append(args, formatType(arg))
	}
	return fmt.Sprintf("%s<%s>", typ.Name, strings.Join(args, ", "))
}

func formatValue(v interface{}) string {
	switch x := v.(type) {
	case nil:
		return "null"
	case string:
		if strings.HasPrefix(x, "@") || strings.HasPrefix(x, "%") {
			return x
		}
		return quote(x)
	case bool:
		if x {
			return "true"
		}
		return "false"
	case int:
		return strconv.Itoa(x)
	case float64:
		return strconv.FormatFloat(x, 'f', -1, 64)
	default:
		return quote(fmt.Sprint(x))
	}
}

func quote(s string) string {
	return strconv.Quote(s)
}
