package main

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"

	ax "github.com/ax-llm/ax/packages/go"
)

// stream_http_roundtrip drives a streaming Stream() through the REAL
// HTTPTransport against an in-process loopback server that returns a spec-legal
// text/event-stream body with a MULTI-LINE data: event and CRLF line endings.
// The conformance ScriptedTransport only ever feeds single-line data: JSON, so
// this is the only end-to-end coverage for the SSE line-folding that
// src/ax/util/sse.ts performs. It panics on any mismatch so `axir verify` fails
// if the folding regresses.
func main() {
	// One logical chat-completion delta whose JSON is split across two data:
	// lines (folded with "\n" into ...,"delta":\n{"content":"Hello "}}), then a
	// normal single-line delta, then [DONE]. Every line uses CRLF.
	const event1a = `{"id":"chatcmpl_stream","model":"gpt-4.1-mini","choices":[{"index":0,"delta":`
	const event1b = `{"content":"Hello "}}]}`
	const event2 = `{"id":"chatcmpl_stream","model":"gpt-4.1-mini","choices":[{"index":0,"delta":{"content":"world"},"finish_reason":"stop"}]}`
	sseBody := "data: " + event1a + "\r\n" +
		"data: " + event1b + "\r\n" +
		"\r\n" +
		"data: " + event2 + "\r\n" +
		"\r\n" +
		"data: [DONE]\r\n" +
		"\r\n"

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		io.Copy(io.Discard, r.Body)
		w.Header().Set("Content-Type", "text/event-stream")
		io.WriteString(w, sseBody)
	}))
	defer server.Close()

	client := ax.NewOpenAICompatibleClient(map[string]ax.Value{
		"api_key":  "test-key",
		"base_url": server.URL,
		"model":    "gpt-4.1-mini",
	})
	events, err := client.Stream(context.Background(), map[string]ax.Value{
		"chat_prompt": ax.Array(ax.Object("role", "user", "content", "stream")),
	}, nil)
	if err != nil {
		panic(err)
	}

	var deltas []string
	for _, event := range events {
		results := resultsOf(event)
		if len(results) == 0 {
			continue
		}
		if content, ok := results[0].(map[string]ax.Value)["content"].(string); ok && content != "" {
			deltas = append(deltas, content)
		}
	}
	if len(deltas) == 0 || deltas[0] != "Hello " {
		panic(fmt.Sprintf("multi-line data: event was not folded into one JSON value: %v", deltas))
	}
	text := ""
	for _, d := range deltas {
		text += d
	}
	if text != "Hello world" {
		panic(fmt.Sprintf("bad stream fold: %q", text))
	}
	fmt.Println("stream-http-roundtrip-ok")
}

func resultsOf(value ax.Value) []ax.Value {
	raw := value.(map[string]ax.Value)["results"]
	switch values := raw.(type) {
	case []ax.Value:
		return values
	case *ax.AxArray:
		return values.Items
	default:
		return nil
	}
}
