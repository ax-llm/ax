package axllm

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"unicode/utf8"
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
	for delta, err := range flow.StreamingForward(context.Background(), orderedValuesReply(orderedValuesPlan), map[string]Value{"question": "q"}, nil) {
		if err != nil {
			t.Fatal(err)
		}
		issues = nil
		orderIssues("flow streaming delta", delta.Delta, true, &issues)
		if len(issues) > 0 {
			t.Fatalf("AxFlow streaming delta: %v", issues)
		}
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
	if got := display(_core_json_pretty(parseJSON(`{"tag":"<b>&","n":1}`))); got != "{\n  \"tag\": \"<b>&\",\n  \"n\": 1\n}" {
		t.Fatalf("json.pretty = %q", got)
	}
}

// MCP messages go out through the same encoder as provider requests, as TS's
// JSON.stringify writes the message: keys in insertion order, no "__order"
// lists, RFC 8259 escapes for control characters only, everything else as
// UTF-8, and U+FFFD for invalid UTF-8.
func TestMCPWireJSONOmitsOrderListsAndEscapesControlCharacters(t *testing.T) {
	text := "tab\t cr\r ctl\x01 del\x7f <b>&   emoji\U0001F600 bad\xff"
	got := AxMCPStdioEncode(Object("jsonrpc", "2.0", "id", 1, "method", "tools/call", "params", Object("arguments", Object("q", text))))
	want := "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"arguments\":{\"q\":\"tab\\t cr\\r ctl\\u0001 del\x7f <b>&   emoji\U0001F600 bad�\"}}}\n"
	if got != want {
		t.Fatalf("AxMCPStdioEncode = %q\nwant %q", got, want)
	}
	if !json.Valid([]byte(strings.TrimSuffix(got, "\n"))) {
		t.Fatalf("AxMCPStdioEncode produced invalid JSON: %q", got)
	}
}

// A provider can split a surrogate pair across stream events: "\ud83d" ends one
// event's text and "\ude00" starts the next. JSON decoding keeps each half as
// its WTF-8 bytes, the stream-text intrinsics join them, as JS strings do, and
// a half left alone is written as JS writes it.
func TestLoneSurrogateEscapesKeepTheirHalves(t *testing.T) {
	head := display(coreGet(parseJSON(`{"content":"hi \ud83d"}`), "content", ""))
	tail := display(coreGet(parseJSON(`{"content":"\ude00 there"}`), "content", ""))
	if head != "hi \xed\xa0\xbd" || tail != "\xed\xb8\x80 there" {
		t.Fatalf("halves = %q, %q, want their WTF-8 bytes", head, tail)
	}
	if joined := display(_core_string_concat_stream_text(head, tail)); joined != "hi \U0001F600 there" {
		t.Fatalf("joined = %q", joined)
	}
	if joined := JoinStreamText(head, tail); joined != "hi \U0001F600 there" {
		t.Fatalf("JoinStreamText = %q", joined)
	}
	if held := display(_core_string_drop_trailing_high_surrogate(head)); held != "hi " {
		t.Fatalf("held back = %q", held)
	}
	if units, _ := _core_string_utf16_units(head).([]Value); len(units) != 4 || units[3] != 0xD83D {
		t.Fatalf("utf-16 units = %v, want the half as one unit", units)
	}
	var written strings.Builder
	writeJSONString(&written, head)
	if written.String() != `"hi \ud83d"` {
		t.Fatalf("written = %s", written.String())
	}
	if pair := display(coreGet(parseJSON(`{"content":"\ud83d\ude00"}`), "content", "")); pair != "\U0001F600" {
		t.Fatalf("pair = %q", pair)
	}
	if _, err := parseJSONErr(`{"content":"\u12"}`); err == nil {
		t.Fatal("a bad \\u escape parsed")
	}
}

// A streamed answer whose surrogate pair a provider splits across two SSE
// events arrives whole, and no delta holds half of it.
func TestStreamedSplitSurrogatePairJoins(t *testing.T) {
	events := "data: {\"id\":\"c\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"Answer: hi \\ud83d\"}}]}\n\n" +
		"data: {\"id\":\"c\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"\\ude00 there\"},\"finish_reason\":\"stop\"}]}\n\n" +
		"data: [DONE]\n\n"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte(events))
	}))
	defer server.Close()
	client := NewAI("openai", map[string]Value{"api_key": "sk-test", "base_url": server.URL + "/v1", "model": "gpt-5.4-mini"})
	var deltas []string
	for delta, err := range NewAx("question:string -> answer:string", nil).StreamingForward(context.Background(), client, map[string]Value{"question": "Status?"}, nil) {
		if err != nil {
			t.Fatal(err)
		}
		if text, ok := delta.Delta["answer"].(string); ok {
			deltas = append(deltas, text)
		}
	}
	if joined := strings.Join(deltas, ""); joined != "hi \U0001F600 there" {
		t.Fatalf("streamed answer = %q", joined)
	}
	for _, delta := range deltas {
		if !utf8.ValidString(delta) {
			t.Fatalf("delta %q holds half a character", delta)
		}
	}
	// Raw client Stream deltas carry the halves; JoinStreamText joins them
	// into the character, as the AxGen stream does.
	raw, err := client.Stream(context.Background(), map[string]Value{"chat_prompt": Array(Object("role", "user", "content", "Status?"))}, nil)
	if err != nil {
		t.Fatal(err)
	}
	text := ""
	for _, delta := range raw {
		for _, result := range asSlice(coreGet(delta, "results", Array())) {
			text = JoinStreamText(text, display(coreGet(result, "content", "")))
		}
	}
	if text != "Answer: hi \U0001F600 there" {
		t.Fatalf("raw deltas joined = %q", text)
	}
}
