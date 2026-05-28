package axir

import (
	"fmt"
	"sort"
	"strconv"
	"strings"
)

func FormatModule(mod Module) string {
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
		formatOp(&b, op, 2)
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

func formatOp(b *strings.Builder, op Operation, indent int) {
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
		formatOp(b, child, indent+2)
	}
	for _, region := range op.Regions {
		formatRegion(b, region, indent+2)
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

func formatRegion(b *strings.Builder, region Region, indent int) {
	pad := strings.Repeat(" ", indent)
	fmt.Fprintf(b, "%sregion @%s {\n", pad, region.Name)
	for _, block := range region.Blocks {
		fmt.Fprintf(b, "%s  block @%s", pad, block.Name)
		if len(block.Args) > 0 {
			b.WriteByte('(')
			for i, arg := range block.Args {
				if i > 0 {
					b.WriteString(", ")
				}
				fmt.Fprintf(b, "%%%s: %s", arg.Name, formatType(arg.Type))
			}
			b.WriteByte(')')
		}
		b.WriteString(" {\n")
		for _, op := range block.Ops {
			formatOp(b, op, indent+4)
		}
		fmt.Fprintf(b, "%s  }\n", pad)
	}
	fmt.Fprintf(b, "%s}\n", pad)
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
