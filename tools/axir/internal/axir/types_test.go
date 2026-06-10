package axir

import (
	"strings"
	"testing"
)

func TestParseSignatureStringShapes(t *testing.T) {
	cases := []struct {
		input    string
		params   int
		required int
		effects  []string
		ret      string
	}{
		{"(string) -> AxSignature throws", 1, 1, []string{"throws"}, "AxSignature"},
		{"() -> json", 0, 0, nil, "json"},
		{"(options?:json) -> json", 1, 0, nil, "json"},
		{"(flow:json, client:json, values:json, options?:json) -> json throws", 4, 3, []string{"throws"}, "json"},
		{"(profile:string, json, json, string, string) -> AxChatResponse throws", 5, 5, []string{"throws"}, "AxChatResponse"},
		{"(AxModelConfig, AxModelConfig?, AxAIServiceOptions?) -> AxModelConfig", 3, 1, nil, "AxModelConfig"},
		{"(string|AxSignature, options?:json) -> AxGen", 2, 1, nil, "AxGen"},
		{"(list<Field>, json, context:string) -> void throws", 3, 3, []string{"throws"}, "void"},
		{"(bytes) -> stream<json> throws", 1, 1, []string{"throws"}, "stream"},
		{"(json, number) -> string", 2, 2, nil, "string"},
		{"(list<json>, json, error) -> void", 3, 3, nil, "void"},
		{"(external) -> list<Field>", 1, 1, nil, "list"},
		{"(AxAIService, requested?:string, embed?:bool) -> string throws", 3, 1, []string{"throws"}, "string"},
	}
	for _, tc := range cases {
		spec, err := ParseSignatureString(tc.input)
		if err != nil {
			t.Fatalf("%q: %v", tc.input, err)
		}
		if len(spec.Params) != tc.params {
			t.Fatalf("%q: got %d params, want %d", tc.input, len(spec.Params), tc.params)
		}
		if spec.RequiredParams() != tc.required {
			t.Fatalf("%q: got %d required, want %d", tc.input, spec.RequiredParams(), tc.required)
		}
		if len(spec.Effects) != len(tc.effects) {
			t.Fatalf("%q: got effects %v, want %v", tc.input, spec.Effects, tc.effects)
		}
		retName := spec.Return.Name
		if spec.Return.Kind == "union" {
			retName = "union"
		}
		if retName != tc.ret {
			t.Fatalf("%q: got return %q, want %q", tc.input, retName, tc.ret)
		}
	}
}

func TestParseSignatureStringRejects(t *testing.T) {
	for _, input := range []string{
		"validationRetries:i64,infraRetries:i64",
		"program",
		"mcp-transport",
		"(json) ->",
		"(json -> json",
		"(json) -> json maybe",
		"(json) -> set<json>",
	} {
		if _, err := ParseSignatureString(input); err == nil {
			t.Fatalf("expected %q to fail signature parsing", input)
		}
	}
}

func TestParseFieldsStringShapes(t *testing.T) {
	fields, err := ParseFieldsString("name:string,isArray:bool,options?:list<string>,fields?:map<string,FieldType>,constraints?:json")
	if err != nil {
		t.Fatal(err)
	}
	if len(fields) != 5 {
		t.Fatalf("got %d fields, want 5", len(fields))
	}
	if fields[3].Name != "fields" || !fields[3].Optional || fields[3].Type.Name != "map" {
		t.Fatalf("unexpected field spec: %+v", fields[3])
	}
	if got := fields[3].Type.Args[1].Name; got != "FieldType" {
		t.Fatalf("nested generic arg = %q, want FieldType", got)
	}
	if _, err := ParseFieldsString("embeddings:list<list<f64>>"); err != nil {
		t.Fatalf("nested generics: %v", err)
	}
	if _, err := ParseFieldsString("type:string|list<string>,required?:list<string>"); err != nil {
		t.Fatalf("union field: %v", err)
	}
	if _, err := ParseFieldsString("string,json"); err == nil || !strings.Contains(err.Error(), "missing a name") {
		t.Fatalf("expected missing-name error, got %v", err)
	}
}

func TestTypeExprNamedTypes(t *testing.T) {
	spec, err := ParseSignatureString("(AxGen, map<string,FieldType>, string|AxSignature) -> list<ChatMessage>")
	if err != nil {
		t.Fatal(err)
	}
	named := map[string]bool{}
	for _, param := range spec.Params {
		for _, name := range param.Type.NamedTypes() {
			named[name] = true
		}
	}
	for _, name := range spec.Return.NamedTypes() {
		named[name] = true
	}
	for _, want := range []string{"AxGen", "FieldType", "AxSignature", "ChatMessage"} {
		if !named[want] {
			t.Fatalf("named types missing %s: %v", want, named)
		}
	}
	if named["string"] || named["map"] {
		t.Fatalf("builtins leaked into named types: %v", named)
	}
}
