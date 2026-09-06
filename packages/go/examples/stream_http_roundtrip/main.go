package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"time"

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
	// normal single-line delta accepted at EOF without a trailing delimiter.
	const event1a = `{"id":"chatcmpl_stream","model":"gpt-5.4-mini","choices":[{"index":0,"delta":`
	const event1b = `{"content":"Hello 🌍 "}}]}`
	const event2 = `{"id":"chatcmpl_stream","model":"gpt-5.4-mini","choices":[{"index":0,"delta":{"content":"world"},"finish_reason":"stop"}]}`
	sseFirst := "\ufeffdatabase: ignored\r\n" +
		"data: " + event1a + "\r\n" +
		"data: " + event1b + "\r\n" +
		"\r\n"
	sseRest := "data: " + event2

	var requests atomic.Int32
	cancelObserved := make(chan struct{}, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		io.Copy(io.Discard, r.Body)
		w.Header().Set("Content-Type", "text/event-stream")
		flusher := w.(http.Flusher)
		for _, b := range []byte(sseFirst) {
			w.Write([]byte{b})
			flusher.Flush()
		}
		if requests.Add(1) == 2 {
			select {
			case <-r.Context().Done():
				cancelObserved <- struct{}{}
			case <-time.After(5 * time.Second):
			}
			return
		}
		time.Sleep(300 * time.Millisecond)
		io.WriteString(w, sseRest)
		flusher.Flush()
	}))
	defer server.Close()

	client := ax.NewOpenAICompatibleClient(map[string]ax.Value{
		"api_key":  "test-key",
		"base_url": server.URL,
		"model":    "gpt-5.4-mini",
	})
	started := time.Now()
	stream, err := client.StreamEvents(context.Background(), map[string]ax.Value{
		"chat_prompt": ax.Array(ax.Object("role", "user", "content", "stream")),
	}, nil)
	if err != nil {
		panic(err)
	}

	defer stream.Close()
	if !stream.Next() {
		panic(fmt.Sprintf("stream ended before first event: %v", stream.Err()))
	}
	ttft := time.Since(started)
	events := []ax.Value{stream.Value()}
	for stream.Next() {
		events = append(events, stream.Value())
	}
	if stream.Err() != nil {
		panic(stream.Err())
	}
	completion := time.Since(started)
	if completion-ttft < 200*time.Millisecond {
		panic(fmt.Sprintf("first event was not incremental: ttft=%s completion=%s", ttft, completion))
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
	if len(deltas) == 0 || deltas[0] != "Hello 🌍 " {
		panic(fmt.Sprintf("multi-line data: event was not folded into one JSON value: %v", deltas))
	}
	text := ""
	for _, d := range deltas {
		text += d
	}
	if text != "Hello 🌍 world" {
		panic(fmt.Sprintf("bad stream fold: %q", text))
	}

	// A second real request proves that cancelling after the first SSE event
	// aborts the HTTP body instead of waiting for the server's next bytes.
	cancelCtx, cancel := context.WithCancelCause(context.Background())
	cancelStream, err := client.StreamEvents(cancelCtx, map[string]ax.Value{
		"chat_prompt": ax.Array(ax.Object("role", "user", "content", "cancel stream")),
	}, nil)
	if err != nil {
		panic(err)
	}
	defer cancelStream.Close()
	if !cancelStream.Next() {
		panic(fmt.Sprintf("cancel stream ended before first event: %v", cancelStream.Err()))
	}
	cancelStarted := time.Now()
	cancel(errors.New("loopback stopped"))
	if cancelStream.Next() {
		panic("cancelled stream yielded another event")
	}
	var aborted ax.AxAIServiceAbortedError
	if !errors.As(cancelStream.Err(), &aborted) || aborted.Retryable || !strings.Contains(cancelStream.Err().Error(), "loopback stopped") {
		panic(fmt.Sprintf("wrong cancellation error: %v", cancelStream.Err()))
	}
	if time.Since(cancelStarted) > time.Second {
		panic("cancelled stream did not return promptly")
	}
	select {
	case <-cancelObserved:
	case <-time.After(time.Second):
		panic("server did not observe the cancelled request context")
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
