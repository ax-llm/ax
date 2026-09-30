package main

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"time"

	ax "github.com/ax-llm/ax/packages/go"
)

// timeout_http_roundtrip times requests out through the REAL HTTPTransport
// against in-process loopback servers. A call's timeout (TypeScript's
// per-call timeout, in milliseconds) ends a chat or a stream whose response
// has not started, and the request layer does not retry it. A stream whose
// response has started runs past it, because the timer stops at the response
// headers, as in TypeScript's apiCall. It panics on any mismatch so
// `axir verify` fails if it regresses.
func main() {
	// A server that accepts connections and never answers.
	silent, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		panic(err)
	}
	defer silent.Close()
	var accepted atomic.Int32
	go func() {
		var held []net.Conn
		for {
			conn, err := silent.Accept()
			if err != nil {
				return
			}
			accepted.Add(1)
			held = append(held, conn)
		}
	}()
	request := map[string]ax.Value{"chat_prompt": ax.Array(ax.Object("role", "user", "content", "hi"))}
	client := ax.NewOpenAICompatibleClient(map[string]ax.Value{
		"api_key":  "test-key",
		"base_url": "http://" + silent.Addr().String(),
		"model":    "gpt-5.4-mini",
	})
	expectTimeout := func(label string, run func() error) {
		started := time.Now()
		err := run()
		if err == nil {
			panic(label + ": the request did not time out")
		}
		typed, ok := ax.AsAxError(err)
		if !ok || typed.Type != "AxAIServiceTimeoutError" || !strings.Contains(err.Error(), "Request timed out after 200ms") {
			panic(fmt.Sprintf("%s: %T %v", label, err, err))
		}
		if elapsed := time.Since(started); elapsed > 5*time.Second {
			panic(fmt.Sprintf("%s: timed out after %v", label, elapsed))
		}
	}
	expectTimeout("chat", func() error {
		_, err := client.Chat(context.Background(), request, map[string]ax.Value{"timeout": 200})
		return err
	})
	expectTimeout("stream", func() error {
		_, err := client.Stream(context.Background(), request, map[string]ax.Value{"timeout": 200})
		return err
	})
	if count := accepted.Load(); count != 2 {
		panic(fmt.Sprintf("a timed-out request was retried: %d connections", count))
	}

	// A stream whose headers arrive at once and whose second event comes
	// after more than the timeout.
	event := func(content, finish string) string {
		return `{"id":"chatcmpl_slow","model":"gpt-5.4-mini","choices":[{"index":0,"delta":{"content":"` + content + `"},"finish_reason":` + finish + `}]}`
	}
	slow := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		io.Copy(io.Discard, r.Body)
		w.Header().Set("Content-Type", "text/event-stream")
		flusher := w.(http.Flusher)
		io.WriteString(w, "data: "+event("Hel", "null")+"\n\n")
		flusher.Flush()
		time.Sleep(1500 * time.Millisecond)
		io.WriteString(w, "data: "+event("lo", `"stop"`)+"\n\ndata: [DONE]\n\n")
		flusher.Flush()
	}))
	defer slow.Close()
	slowClient := ax.NewOpenAICompatibleClient(map[string]ax.Value{
		"api_key":  "test-key",
		"base_url": slow.URL,
		"model":    "gpt-5.4-mini",
	})
	events, err := slowClient.Stream(context.Background(), request, map[string]ax.Value{"timeout": 1000})
	if err != nil {
		panic(fmt.Sprintf("a started stream was cut off: %v", err))
	}
	text := ""
	for _, event := range events {
		results := resultsOf(event)
		if len(results) == 0 {
			continue
		}
		if content, ok := results[0].(map[string]ax.Value)["content"].(string); ok {
			text += content
		}
	}
	if text != "Hello" {
		panic(fmt.Sprintf("a started stream was cut off: %q", text))
	}
	fmt.Println("timeout-http-roundtrip-ok")
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
