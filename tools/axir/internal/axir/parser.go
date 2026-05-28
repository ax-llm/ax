package axir

import (
	"fmt"
	"strconv"
	"strings"
	"unicode"
)

type token struct {
	kind string
	text string
	line int
}

type parser struct {
	tokens []token
	pos    int
	file   string
}

func ParseModule(src, file string) (Module, error) {
	p := parser{tokens: lex(src), file: file}
	return p.parseModule()
}

func lex(src string) []token {
	var out []token
	line := 1
	for i := 0; i < len(src); {
		ch := rune(src[i])
		if ch == '\n' {
			line++
			i++
			continue
		}
		if unicode.IsSpace(ch) {
			i++
			continue
		}
		if ch == '#' {
			for i < len(src) && src[i] != '\n' {
				i++
			}
			continue
		}
		if strings.HasPrefix(src[i:], "//") {
			for i < len(src) && src[i] != '\n' {
				i++
			}
			continue
		}
		if strings.ContainsRune("{}()[],:=<>", ch) {
			out = append(out, token{kind: string(ch), text: string(ch), line: line})
			i++
			continue
		}
		if ch == '@' || ch == '%' {
			kind := "symbol"
			if ch == '%' {
				kind = "value"
			}
			start := i
			i++
			for i < len(src) && isIdentRune(rune(src[i])) {
				i++
			}
			out = append(out, token{kind: kind, text: src[start+1 : i], line: line})
			continue
		}
		if ch == '"' {
			startLine := line
			if strings.HasPrefix(src[i:], `"""`) {
				i += 3
				start := i
				for i < len(src) && !strings.HasPrefix(src[i:], `"""`) {
					if src[i] == '\n' {
						line++
					}
					i++
				}
				text := src[start:i]
				if i < len(src) {
					i += 3
				}
				out = append(out, token{kind: "string", text: text, line: startLine})
				continue
			}
			i++
			var b strings.Builder
			for i < len(src) {
				if src[i] == '\n' {
					line++
				}
				if src[i] == '"' {
					i++
					break
				}
				if src[i] == '\\' && i+1 < len(src) {
					i++
					switch src[i] {
					case 'n':
						b.WriteByte('\n')
					case 't':
						b.WriteByte('\t')
					case '"', '\\':
						b.WriteByte(src[i])
					default:
						b.WriteByte(src[i])
					}
					i++
					continue
				}
				b.WriteByte(src[i])
				i++
			}
			out = append(out, token{kind: "string", text: b.String(), line: startLine})
			continue
		}
		if unicode.IsDigit(ch) || (ch == '-' && i+1 < len(src) && unicode.IsDigit(rune(src[i+1]))) {
			start := i
			i++
			for i < len(src) && (unicode.IsDigit(rune(src[i])) || src[i] == '.') {
				i++
			}
			out = append(out, token{kind: "number", text: src[start:i], line: line})
			continue
		}
		if isIdentStart(ch) {
			start := i
			i++
			for i < len(src) && isIdentRune(rune(src[i])) {
				i++
			}
			out = append(out, token{kind: "ident", text: src[start:i], line: line})
			continue
		}
		out = append(out, token{kind: string(ch), text: string(ch), line: line})
		i++
	}
	out = append(out, token{kind: "eof", line: line})
	return out
}

func isIdentStart(r rune) bool {
	return unicode.IsLetter(r) || r == '_'
}

func isIdentRune(r rune) bool {
	return unicode.IsLetter(r) || unicode.IsDigit(r) || r == '_' || r == '-' || r == '.'
}

func (p *parser) parseModule() (Module, error) {
	var mod Module
	if err := p.expectIdent("module"); err != nil {
		return mod, err
	}
	name, err := p.expectSymbol()
	if err != nil {
		return mod, err
	}
	mod.Name = name
	mod.File = p.file
	if p.matchIdent("version") {
		mod.Version, err = p.expectString()
		if err != nil {
			return mod, err
		}
	} else {
		mod.Version = Version
	}
	if err := p.expect("{"); err != nil {
		return mod, err
	}
	for !p.match("}") {
		switch p.peek().text {
		case "import":
			imp, err := p.parseImport()
			if err != nil {
				return mod, err
			}
			mod.Imports = append(mod.Imports, imp)
		case "dialect":
			dialect, err := p.parseDialect()
			if err != nil {
				return mod, err
			}
			mod.Dialects = append(mod.Dialects, dialect)
		case "op":
			op, err := p.parseOperation()
			if err != nil {
				return mod, err
			}
			mod.Ops = append(mod.Ops, op)
		default:
			return mod, p.errf("expected import, dialect, or op, got %q", p.peek().text)
		}
	}
	if p.peek().kind != "eof" {
		return mod, p.err("unexpected tokens after module")
	}
	return mod, nil
}

func (p *parser) parseImport() (Import, error) {
	line := p.next().line
	symbol, err := p.expectSymbol()
	if err != nil {
		return Import{}, err
	}
	if err := p.expectIdent("from"); err != nil {
		return Import{}, err
	}
	path, err := p.expectString()
	if err != nil {
		return Import{}, err
	}
	return Import{Symbol: symbol, Path: path, Line: line}, nil
}

func (p *parser) parseDialect() (Dialect, error) {
	line := p.next().line
	name, err := p.expectSymbol()
	if err != nil {
		return Dialect{}, err
	}
	version := Version
	if p.matchIdent("version") {
		version, err = p.expectString()
		if err != nil {
			return Dialect{}, err
		}
	}
	return Dialect{Name: name, Version: version, Line: line}, nil
}

func (p *parser) parseOperation() (Operation, error) {
	line := p.next().line
	name, err := p.expectAnyIdent()
	if err != nil {
		return Operation{}, err
	}
	symbol := ""
	if p.peek().kind == "symbol" {
		symbol, err = p.expectSymbol()
		if err != nil {
			return Operation{}, err
		}
	}
	op := Operation{Name: name, Symbol: symbol, Line: line}
	if err := p.expect("{"); err != nil {
		return op, err
	}
	for !p.match("}") {
		switch p.peek().text {
		case "attr", "type", "ref", "tag":
			attr, err := p.parseAttribute()
			if err != nil {
				return op, err
			}
			op.Attributes = append(op.Attributes, attr)
		case "region":
			region, err := p.parseRegion()
			if err != nil {
				return op, err
			}
			op.Regions = append(op.Regions, region)
		case "op":
			child, err := p.parseOperation()
			if err != nil {
				return op, err
			}
			op.Ops = append(op.Ops, child)
		default:
			return op, p.errf("unexpected operation body item %q", p.peek().text)
		}
	}
	return op, nil
}

func (p *parser) parseAttribute() (Attribute, error) {
	kind := p.next()
	attr := Attribute{Kind: kind.text, Line: kind.line}
	if kind.text == "tag" {
		value, err := p.expectString()
		if err != nil {
			return attr, err
		}
		attr.Name = "tag"
		attr.Value = value
		return attr, nil
	}
	name, err := p.expectAnyIdent()
	if err != nil {
		return attr, err
	}
	attr.Name = name
	if err := p.expect("="); err != nil {
		return attr, err
	}
	if p.match("[") {
		for !p.match("]") {
			value, err := p.parseLiteral()
			if err != nil {
				return attr, err
			}
			attr.Values = append(attr.Values, value)
			p.match(",")
		}
		return attr, nil
	}
	value, err := p.parseLiteral()
	if err != nil {
		return attr, err
	}
	attr.Value = value
	return attr, nil
}

func (p *parser) parseRegion() (Region, error) {
	line := p.next().line
	name, err := p.expectSymbol()
	if err != nil {
		return Region{}, err
	}
	region := Region{Name: name, Line: line}
	if err := p.expect("{"); err != nil {
		return region, err
	}
	for !p.match("}") {
		block, err := p.parseBlock()
		if err != nil {
			return region, err
		}
		region.Blocks = append(region.Blocks, block)
	}
	return region, nil
}

func (p *parser) parseBlock() (Block, error) {
	if err := p.expectIdent("block"); err != nil {
		return Block{}, err
	}
	line := p.tokens[p.pos-1].line
	name, err := p.expectSymbol()
	if err != nil {
		return Block{}, err
	}
	block := Block{Name: name, Line: line}
	if p.match("(") {
		for !p.match(")") {
			value, err := p.parseValue()
			if err != nil {
				return block, err
			}
			block.Args = append(block.Args, value)
			p.match(",")
		}
	}
	if err := p.expect("{"); err != nil {
		return block, err
	}
	for !p.match("}") {
		op, err := p.parseOperation()
		if err != nil {
			return block, err
		}
		block.Ops = append(block.Ops, op)
	}
	return block, nil
}

func (p *parser) parseValue() (Value, error) {
	nameTok := p.next()
	if nameTok.kind != "value" {
		return Value{}, p.errf("expected value, got %q", nameTok.text)
	}
	if err := p.expect(":"); err != nil {
		return Value{}, err
	}
	typ, err := p.parseType()
	if err != nil {
		return Value{}, err
	}
	return Value{Name: nameTok.text, Type: typ}, nil
}

func (p *parser) parseType() (Type, error) {
	name, err := p.expectAnyIdent()
	if err != nil {
		return Type{}, err
	}
	typ := Type{Name: name}
	if p.match("<") {
		for !p.match(">") {
			arg, err := p.parseType()
			if err != nil {
				return typ, err
			}
			typ.Args = append(typ.Args, arg)
			p.match(",")
		}
	}
	return typ, nil
}

func (p *parser) parseLiteral() (interface{}, error) {
	tok := p.next()
	switch tok.kind {
	case "string":
		return tok.text, nil
	case "symbol":
		return "@" + tok.text, nil
	case "value":
		return "%" + tok.text, nil
	case "number":
		if strings.Contains(tok.text, ".") {
			return strconv.ParseFloat(tok.text, 64)
		}
		return strconv.Atoi(tok.text)
	case "ident":
		if tok.text == "true" {
			return true, nil
		}
		if tok.text == "false" {
			return false, nil
		}
		return tok.text, nil
	default:
		return nil, p.errf("expected literal, got %q", tok.text)
	}
}

func (p *parser) expectAnyIdent() (string, error) {
	tok := p.next()
	if tok.kind == "ident" {
		return tok.text, nil
	}
	return "", p.errf("expected identifier, got %q", tok.text)
}

func (p *parser) expectIdent(s string) error {
	tok := p.next()
	if tok.kind == "ident" && tok.text == s {
		return nil
	}
	return p.errf("expected %q, got %q", s, tok.text)
}

func (p *parser) expectString() (string, error) {
	tok := p.next()
	if tok.kind == "string" {
		return tok.text, nil
	}
	return "", p.errf("expected string, got %q", tok.text)
}

func (p *parser) expectSymbol() (string, error) {
	tok := p.next()
	if tok.kind == "symbol" {
		return tok.text, nil
	}
	return "", p.errf("expected symbol, got %q", tok.text)
}

func (p *parser) expect(kind string) error {
	tok := p.next()
	if tok.kind == kind {
		return nil
	}
	return p.errf("expected %q, got %q", kind, tok.text)
}

func (p *parser) match(kind string) bool {
	if p.peek().kind == kind {
		p.pos++
		return true
	}
	return false
}

func (p *parser) matchIdent(s string) bool {
	if p.peek().kind == "ident" && p.peek().text == s {
		p.pos++
		return true
	}
	return false
}

func (p *parser) peek() token {
	if p.pos >= len(p.tokens) {
		return token{kind: "eof"}
	}
	return p.tokens[p.pos]
}

func (p *parser) next() token {
	tok := p.peek()
	if p.pos < len(p.tokens) {
		p.pos++
	}
	return tok
}

func (p *parser) err(msg string) error {
	if p.file != "" {
		return fmt.Errorf("%s:%d: %s", p.file, p.peek().line, msg)
	}
	return fmt.Errorf("line %d: %s", p.peek().line, msg)
}

func (p *parser) errf(format string, args ...interface{}) error {
	return p.err(fmt.Sprintf(format, args...))
}
