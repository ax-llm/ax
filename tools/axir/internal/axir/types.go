package axir

import (
	"fmt"
	"regexp"
	"strings"
)

// TypeExpr is the canonical model for the type strings carried by `type
// signature` and `type fields` attributes. Until this parser existed those
// strings were unvalidated metadata; the checker now requires every one of
// them to parse and to reference known types.
type TypeExpr struct {
	Kind string // builtin | named | generic | union
	Name string // builtin/named/generic name; empty for union
	Args []TypeExpr
}

type ParamSpec struct {
	Name     string
	Optional bool
	Type     TypeExpr
}

type SignatureSpec struct {
	Params  []ParamSpec
	Return  TypeExpr
	Effects []string
}

// RequiredParams counts the leading non-optional parameters.
func (s SignatureSpec) RequiredParams() int {
	required := 0
	for _, param := range s.Params {
		if !param.Optional {
			required++
		}
	}
	return required
}

func (s SignatureSpec) HasEffect(name string) bool {
	for _, effect := range s.Effects {
		if effect == name {
			return true
		}
	}
	return false
}

var builtinTypeNames = map[string]bool{
	"string": true,
	"bool":   true,
	"i64":    true,
	"f64":    true,
	"json":   true,
	"bytes":  true,
	"void":   true,
	// number is the dynamic numeric type some normalize/score signatures
	// use; error and external are host-boundary placeholders. All three are
	// documented in ir/spec/core-ir.md.
	"number":   true,
	"error":    true,
	"external": true,
}

var genericTypeArity = map[string]int{
	"list":     1,
	"map":      2,
	"optional": 1,
	"result":   2,
	"stream":   1,
}

var typeEffectNames = map[string]bool{
	"pure":   true,
	"throws": true,
	"async":  true,
	"stream": true,
}

var typeIdentRe = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

// splitTopLevel splits s on sep, ignoring separators nested inside <...>.
func splitTopLevel(s string, sep byte) []string {
	var parts []string
	depth := 0
	start := 0
	for i := 0; i < len(s); i++ {
		switch s[i] {
		case '<':
			depth++
		case '>':
			depth--
		case sep:
			if depth == 0 {
				parts = append(parts, s[start:i])
				start = i + 1
			}
		}
	}
	parts = append(parts, s[start:])
	return parts
}

// ParseTypeExpr parses a type expression: a builtin or named identifier, a
// generic application (list<T>, map<K,V>, optional<T>, result<T,E>,
// stream<T>), or a union (A|B).
func ParseTypeExpr(input string) (TypeExpr, error) {
	s := strings.TrimSpace(input)
	if s == "" {
		return TypeExpr{}, fmt.Errorf("empty type")
	}
	if members := splitTopLevel(s, '|'); len(members) > 1 {
		union := TypeExpr{Kind: "union"}
		for _, member := range members {
			arg, err := ParseTypeExpr(member)
			if err != nil {
				return TypeExpr{}, err
			}
			union.Args = append(union.Args, arg)
		}
		return union, nil
	}
	if open := strings.IndexByte(s, '<'); open >= 0 {
		if !strings.HasSuffix(s, ">") {
			return TypeExpr{}, fmt.Errorf("unterminated generic in %q", input)
		}
		name := strings.TrimSpace(s[:open])
		arity, ok := genericTypeArity[name]
		if !ok {
			return TypeExpr{}, fmt.Errorf("unknown generic type %q in %q", name, input)
		}
		argSrc := s[open+1 : len(s)-1]
		argParts := splitTopLevel(argSrc, ',')
		if len(argParts) != arity {
			return TypeExpr{}, fmt.Errorf("generic %s takes %d argument(s), got %d in %q", name, arity, len(argParts), input)
		}
		expr := TypeExpr{Kind: "generic", Name: name}
		for _, part := range argParts {
			arg, err := ParseTypeExpr(part)
			if err != nil {
				return TypeExpr{}, err
			}
			expr.Args = append(expr.Args, arg)
		}
		return expr, nil
	}
	if !typeIdentRe.MatchString(s) {
		return TypeExpr{}, fmt.Errorf("invalid type %q", input)
	}
	if builtinTypeNames[s] {
		return TypeExpr{Kind: "builtin", Name: s}, nil
	}
	return TypeExpr{Kind: "named", Name: s}, nil
}

func parseParamSpec(input string, requireName bool) (ParamSpec, error) {
	s := strings.TrimSpace(input)
	if s == "" {
		return ParamSpec{}, fmt.Errorf("empty parameter")
	}
	var param ParamSpec
	if colon := strings.IndexByte(stripGenerics(s), ':'); colon >= 0 {
		name := strings.TrimSpace(s[:colon])
		if strings.HasSuffix(name, "?") {
			param.Optional = true
			name = strings.TrimSuffix(name, "?")
		}
		if !typeIdentRe.MatchString(name) {
			return ParamSpec{}, fmt.Errorf("invalid parameter name %q", name)
		}
		param.Name = name
		s = s[colon+1:]
	} else if requireName {
		return ParamSpec{}, fmt.Errorf("field %q is missing a name", input)
	}
	s = strings.TrimSpace(s)
	if strings.HasSuffix(s, "?") {
		param.Optional = true
		s = strings.TrimSuffix(s, "?")
	}
	typeExpr, err := ParseTypeExpr(s)
	if err != nil {
		return ParamSpec{}, err
	}
	param.Type = typeExpr
	return param, nil
}

// stripGenerics blanks out <...> spans so a top-level ':' can be located
// without tripping over generic arguments.
func stripGenerics(s string) string {
	out := []byte(s)
	depth := 0
	for i := 0; i < len(out); i++ {
		switch out[i] {
		case '<':
			depth++
		case '>':
			depth--
		default:
			if depth > 0 {
				out[i] = '_'
			}
		}
	}
	return string(out)
}

// ParseSignatureString parses "(name:type, type, opt?:type) -> ret throws".
func ParseSignatureString(input string) (SignatureSpec, error) {
	s := strings.TrimSpace(input)
	if !strings.HasPrefix(s, "(") {
		return SignatureSpec{}, fmt.Errorf("signature %q must start with parameter list", input)
	}
	close := strings.IndexByte(s, ')')
	if close < 0 {
		return SignatureSpec{}, fmt.Errorf("signature %q has no closing parenthesis", input)
	}
	var spec SignatureSpec
	paramSrc := strings.TrimSpace(s[1:close])
	if paramSrc != "" {
		for _, part := range splitTopLevel(paramSrc, ',') {
			param, err := parseParamSpec(part, false)
			if err != nil {
				return SignatureSpec{}, fmt.Errorf("signature %q: %w", input, err)
			}
			spec.Params = append(spec.Params, param)
		}
	}
	rest := strings.TrimSpace(s[close+1:])
	if !strings.HasPrefix(rest, "->") {
		return SignatureSpec{}, fmt.Errorf("signature %q is missing '->' return type", input)
	}
	rest = strings.TrimSpace(strings.TrimPrefix(rest, "->"))
	tokens := strings.Fields(rest)
	if len(tokens) == 0 {
		return SignatureSpec{}, fmt.Errorf("signature %q has an empty return type", input)
	}
	// Effects are trailing identifiers after the return type; the return
	// type itself never contains spaces in the corpus grammar.
	returnType, err := ParseTypeExpr(tokens[0])
	if err != nil {
		return SignatureSpec{}, fmt.Errorf("signature %q: %w", input, err)
	}
	spec.Return = returnType
	for _, token := range tokens[1:] {
		if !typeEffectNames[token] {
			return SignatureSpec{}, fmt.Errorf("signature %q has unknown effect %q", input, token)
		}
		spec.Effects = append(spec.Effects, token)
	}
	return spec, nil
}

// ParseFieldsString parses "name:type,opt?:type" record field lists.
func ParseFieldsString(input string) ([]ParamSpec, error) {
	s := strings.TrimSpace(input)
	if s == "" {
		return nil, fmt.Errorf("empty fields list")
	}
	var fields []ParamSpec
	for _, part := range splitTopLevel(s, ',') {
		field, err := parseParamSpec(part, true)
		if err != nil {
			return nil, fmt.Errorf("fields %q: %w", input, err)
		}
		fields = append(fields, field)
	}
	return fields, nil
}

// NamedTypes returns every named (non-builtin) type referenced by the
// expression, for resolution against declared symbols.
func (t TypeExpr) NamedTypes() []string {
	var names []string
	if t.Kind == "named" {
		names = append(names, t.Name)
	}
	for _, arg := range t.Args {
		names = append(names, arg.NamedTypes()...)
	}
	return names
}
