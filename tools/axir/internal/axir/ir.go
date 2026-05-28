package axir

import (
	"encoding/json"
	"fmt"
	"strings"
)

const Version = "0.1"

type Bundle struct {
	Root    string   `json:"root"`
	Modules []Module `json:"modules"`
}

type Module struct {
	Name     string      `json:"name"`
	Version  string      `json:"version"`
	File     string      `json:"file,omitempty"`
	Imports  []Import    `json:"imports,omitempty"`
	Dialects []Dialect   `json:"dialects,omitempty"`
	Ops      []Operation `json:"ops,omitempty"`
}

type Import struct {
	Symbol string `json:"symbol"`
	Path   string `json:"path"`
	Line   int    `json:"-"`
}

type Dialect struct {
	Name    string `json:"name"`
	Version string `json:"version"`
	Line    int    `json:"-"`
}

type Operation struct {
	Name       string      `json:"name"`
	Symbol     string      `json:"symbol,omitempty"`
	Attributes []Attribute `json:"attributes,omitempty"`
	Regions    []Region    `json:"regions,omitempty"`
	Ops        []Operation `json:"ops,omitempty"`
	Line       int         `json:"-"`
}

type Attribute struct {
	Kind   string        `json:"kind"`
	Name   string        `json:"name"`
	Value  interface{}   `json:"value,omitempty"`
	Values []interface{} `json:"values,omitempty"`
	Line   int           `json:"-"`
}

type Region struct {
	Name   string  `json:"name"`
	Blocks []Block `json:"blocks,omitempty"`
	Line   int     `json:"-"`
}

type Block struct {
	Name string      `json:"name"`
	Args []Value     `json:"args,omitempty"`
	Ops  []Operation `json:"ops,omitempty"`
	Line int         `json:"-"`
}

type Value struct {
	Name string `json:"name"`
	Type Type   `json:"type"`
}

type Type struct {
	Name string `json:"name"`
	Args []Type `json:"args,omitempty"`
}

type Diagnostic struct {
	Severity string `json:"severity"`
	Message  string `json:"message"`
	File     string `json:"file,omitempty"`
	Line     int    `json:"line,omitempty"`
}

func (d Diagnostic) Error() string {
	loc := ""
	if d.File != "" {
		loc = d.File
	}
	if d.Line > 0 {
		if loc != "" {
			loc += ":"
		}
		loc += fmt.Sprintf("%d", d.Line)
	}
	if loc != "" {
		return fmt.Sprintf("%s: %s: %s", loc, d.Severity, d.Message)
	}
	return fmt.Sprintf("%s: %s", d.Severity, d.Message)
}

type Diagnostics []Diagnostic

func (d Diagnostics) HasErrors() bool {
	for _, item := range d {
		if item.Severity == "error" {
			return true
		}
	}
	return false
}

func (d Diagnostics) Error() string {
	var b strings.Builder
	for i, item := range d {
		if i > 0 {
			b.WriteByte('\n')
		}
		b.WriteString(item.Error())
	}
	return b.String()
}

func DumpJSON(v interface{}) ([]byte, error) {
	return json.MarshalIndent(v, "", "  ")
}

func Symbol(name string) string {
	return strings.TrimPrefix(strings.TrimSpace(name), "@")
}

func Ref(name string) string {
	if name == "" {
		return ""
	}
	return "@" + Symbol(name)
}

func Attr(op Operation, name string) (Attribute, bool) {
	for _, attr := range op.Attributes {
		if attr.Name == name {
			return attr, true
		}
	}
	return Attribute{}, false
}

func AttrString(op Operation, name string) string {
	attr, ok := Attr(op, name)
	if !ok {
		return ""
	}
	if v, ok := attr.Value.(string); ok {
		return v
	}
	return fmt.Sprint(attr.Value)
}

func AttrStringList(op Operation, name string) []string {
	attr, ok := Attr(op, name)
	if !ok {
		return nil
	}
	var out []string
	for _, v := range attr.Values {
		out = append(out, fmt.Sprint(v))
	}
	return out
}

func AllOps(bundle Bundle) []Operation {
	var ops []Operation
	for _, mod := range bundle.Modules {
		for _, op := range mod.Ops {
			ops = appendOps(ops, op)
		}
	}
	return ops
}

func appendOps(out []Operation, op Operation) []Operation {
	out = append(out, op)
	for _, child := range op.Ops {
		out = appendOps(out, child)
	}
	for _, region := range op.Regions {
		for _, block := range region.Blocks {
			for _, child := range block.Ops {
				out = appendOps(out, child)
			}
		}
	}
	return out
}
