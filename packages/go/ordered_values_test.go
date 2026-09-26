package axllm

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

type orderedValuesClient struct{ responses []Value }

func (c *orderedValuesClient) Chat(context.Context, map[string]Value, map[string]Value) (Value, error) {
	out := c.responses[0]
	c.responses = c.responses[1:]
	return out, nil
}
func (c *orderedValuesClient) Embed(context.Context, map[string]Value, map[string]Value) (Value, error) {
	return nil, nil
}
func (c *orderedValuesClient) Stream(context.Context, map[string]Value, map[string]Value) ([]Value, error) {
	return nil, nil
}

func orderedValuesReply(content string) *orderedValuesClient {
	return &orderedValuesClient{responses: []Value{Object("results", Array(Object("content", content, "function_calls", Array())))}}
}

// orderIssues reports maps that list a key twice in "__order", or that carry
// "__order" at all when the value is meant for callers.
func orderIssues(path string, value Value, public bool, issues *[]string) {
	switch v := value.(type) {
	case map[string]Value:
		if raw, ok := v["__order"]; ok {
			if public {
				*issues = append(*issues, path+" exposes __order")
			}
			seen := map[string]bool{}
			for _, item := range asSlice(raw) {
				if key := display(item); seen[key] {
					*issues = append(*issues, fmt.Sprintf("%s lists %q twice: %v", path, key, asSlice(raw)))
				} else {
					seen[key] = true
				}
			}
		}
		for _, key := range orderedKeys(v) {
			orderIssues(path+"."+key, v[key], public, issues)
		}
	case []Value:
		for i, item := range v {
			orderIssues(fmt.Sprintf("%s[%d]", path, i), item, public, issues)
		}
	case *AxArray:
		orderIssues(path, asSlice(v), public, issues)
	}
}

const orderedValuesPlan = `{"plan":{"city":"Paris","advice":"Wear layers","tips":{"umbrella":false}}}`

func TestForwardReturnsPlainMaps(t *testing.T) {
	gen := NewAx("question:string -> plan:object", nil)
	out, err := gen.Forward(context.Background(), orderedValuesReply(orderedValuesPlan), map[string]Value{"question": "q"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	var issues []string
	orderIssues("output", out, true, &issues)
	if len(issues) > 0 {
		t.Fatalf("AxGen output: %v", issues)
	}
	data, _ := json.Marshal(out)
	if want := `{"plan":{"advice":"Wear layers","city":"Paris","tips":{"umbrella":false}}}`; string(data) != want {
		t.Fatalf("json.Marshal(output) = %s, want %s", data, want)
	}

	flow := NewFlow(Object("id", "plain-flow"))
	flow.Execute("plan", NewAx("question:string -> plan:object", nil), nil)
	flowOut, err := flow.Forward(context.Background(), orderedValuesReply(orderedValuesPlan), map[string]Value{"question": "q"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	issues = nil
	orderIssues("flow output", flowOut, true, &issues)
	if len(issues) > 0 {
		t.Fatalf("AxFlow output: %v", issues)
	}
}

// Flow steps, agent stages and optimizers call forward, which keeps the model's
// key order for the values they pass along.
func TestInternalForwardKeepsKeyOrder(t *testing.T) {
	gen := NewAx("question:string -> plan:object", nil)
	out, err := gen.forward(context.Background(), orderedValuesReply(orderedValuesPlan), map[string]Value{"question": "q"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(orderedKeys(asMap(coreGet(out, "plan", nil))), ","); got != "city,advice,tips" {
		t.Fatalf("internal plan keys = %s, want city,advice,tips", got)
	}
	var issues []string
	orderIssues("output", out, false, &issues)
	if len(issues) > 0 {
		t.Fatalf("internal output: %v", issues)
	}
}

func TestMapCopiesListEachKeyOnce(t *testing.T) {
	source := asMap(parseJSON(`{"city":"Paris","advice":"Wear layers","tips":{"umbrella":false,"coat":true}}`))
	// Go randomizes map iteration, so copy repeatedly, including copies of copies.
	for i := 0; i < 100; i++ {
		copies := map[string]Value{"asMap": asMap(source), "normalizeJSON": normalizeJSON(source), "cloneValue": cloneValue(source), "cloneMap": cloneMap(source)}
		for name, copied := range copies {
			var issues []string
			orderIssues(name, copied, false, &issues)
			if len(issues) > 0 {
				t.Fatalf("copy %d: %v", i, issues)
			}
			if got := strings.Join(orderedKeys(asMap(copied)), ","); got != "city,advice,tips" {
				t.Fatalf("%s keys = %s, want city,advice,tips", name, got)
			}
		}
		source = asMap(source)
	}
}

func TestDeleteThenSetListsKeyOnceAtTheEnd(t *testing.T) {
	m := Object("a", 1, "b", 2)
	_core_map_delete(m, "a")
	coreSet(m, "a", 3)
	if got := stableStringify(asSlice(m["__order"])); got != `["b","a"]` {
		t.Fatalf("__order after delete and set = %s, want [\"b\",\"a\"]", got)
	}
	coreSet(m, "__order", Array("x"))
	if got := stableStringify(asSlice(m["__order"])); got != `["b","a"]` {
		t.Fatalf("setting __order replaced the key order: %s", got)
	}
}

func TestJSONTextOmitsOrderListsAndHTMLEscapes(t *testing.T) {
	typed := []map[string]Value{Object("k", "<x> & y")}
	if got := stableStringify(typed); got != `[{"k":"<x> & y"}]` {
		t.Fatalf("stableStringify(typed slice) = %s", got)
	}
	if got := orderedStringify(typed); got != `[{"k":"<x> & y"}]` {
		t.Fatalf("orderedStringify(typed slice) = %s", got)
	}
	if got := display(Object("a", 1, "b", Array(Object("c", true)))); got != `{"a":1,"b":[{"c":true}]}` {
		t.Fatalf("display(map) = %s", got)
	}
	if got := display(_core_json_pretty(parseJSON(`{"tag":"<b>&","n":1}`))); got != "{\n  \"n\": 1,\n  \"tag\": \"<b>&\"\n}" {
		t.Fatalf("json.pretty = %q", got)
	}
}

// MCP messages go out through the same encoder as provider requests: keys sorted,
// no "__order" lists, RFC 8259 escapes for control characters only, everything
// else as UTF-8, and U+FFFD for invalid UTF-8.
func TestMCPWireJSONOmitsOrderListsAndEscapesControlCharacters(t *testing.T) {
	text := "tab\t cr\r ctl\x01 del\x7f <b>&   emoji\U0001F600 bad\xff"
	got := AxMCPStdioEncode(Object("jsonrpc", "2.0", "id", 1, "method", "tools/call", "params", Object("arguments", Object("q", text))))
	want := "{\"id\":1,\"jsonrpc\":\"2.0\",\"method\":\"tools/call\",\"params\":{\"arguments\":{\"q\":\"tab\\t cr\\r ctl\\u0001 del\x7f <b>&   emoji\U0001F600 bad�\"}}}\n"
	if got != want {
		t.Fatalf("AxMCPStdioEncode = %q\nwant %q", got, want)
	}
	if !json.Valid([]byte(strings.TrimSuffix(got, "\n"))) {
		t.Fatalf("AxMCPStdioEncode produced invalid JSON: %q", got)
	}
}
