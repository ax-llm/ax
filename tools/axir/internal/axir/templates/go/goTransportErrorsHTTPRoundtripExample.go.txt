package main

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"sync/atomic"
	"time"

	ax "github.com/ax-llm/ax/packages/go"
)

// transport_errors_http_roundtrip sends requests through the REAL
// HTTPTransport to in-process loopback servers that fail the way networks do,
// and checks that the failures surface as TypeScript's apiCall reports fetch's:
// a refused or dropped connection is AxAIServiceNetworkError ("Network Error:
// ..."), which a stream's request layer retries under the call's retry
// options; a timeout is AxAIServiceTimeoutError, which the request layer never
// retries; and AxGen retries both as infrastructure errors. It panics on any
// mismatch so `axir verify` fails if it regresses.
func main() {
	request := map[string]ax.Value{"chat_prompt": ax.Array(ax.Object("role", "user", "content", "hi"))}
	fastRetry := ax.Object("maxRetries", 2, "initialDelayMs", 10, "maxDelayMs", 20)

	// A refused connection.
	refused := closedAddress()
	client := newClient(refused, nil)
	_, err := client.Chat(context.Background(), request, map[string]ax.Value{"stream": false})
	expectType("refused chat", err, "AxAIServiceNetworkError", "Network Error: ")
	_, err = client.Stream(context.Background(), request, map[string]ax.Value{"retry": fastRetry})
	expectType("refused stream", err, "AxAIServiceNetworkError", "Network Error: ")

	// A server that closes each connection without a response. The stream's
	// request layer retries it: the first request and two retries.
	closing, closed := serve("close")
	client = newClient(closing, nil)
	_, err = client.Chat(context.Background(), request, map[string]ax.Value{"stream": false})
	expectType("closed chat", err, "AxAIServiceNetworkError", "Network Error: ")
	before := closed.Load()
	_, err = client.Stream(context.Background(), request, map[string]ax.Value{"retry": fastRetry})
	expectType("closed stream", err, "AxAIServiceNetworkError", "Network Error: ")
	expectCount("closed stream", closed.Load()-before, 3)

	// A server that sends one event and drops the connection: the stream ends
	// in an infrastructure error after the event, and is not retried.
	dropping, dropped := serve("drop")
	events, err := newClient(dropping, nil).StreamEvents(context.Background(), request, map[string]ax.Value{"retry": fastRetry})
	if err != nil {
		panic(fmt.Sprintf("dropped stream: %v", err))
	}
	delivered := 0
	for events.Next() {
		delivered++
	}
	err = events.Err()
	events.Close()
	expectType("dropped stream", err, "AxAIServiceStreamTerminatedError", "")
	expectCount("dropped stream events", int32(delivered), 1)
	expectCount("dropped stream", dropped.Load(), 1)

	// The Typesafe client types the same failures, and does not retry its own
	// timeout (in seconds).
	_, err = ax.Typesafe(map[string]ax.Value{"api_key": "test-key", "base_url": "http://" + closedAddress(), "retry": fastRetry}).ListModels(context.Background(), nil)
	expectType("Typesafe refused", err, "AxAIServiceNetworkError", "Network Error: ")
	silent, held := serve("hold")
	before = held.Load()
	_, err = ax.Typesafe(map[string]ax.Value{"api_key": "test-key", "base_url": "http://" + silent, "timeout": 0.3, "retry": fastRetry}).ListModels(context.Background(), nil)
	expectType("Typesafe timeout", err, "AxAIServiceTimeoutError", "Request timed out after 300ms")
	expectCount("Typesafe timeout", held.Load()-before, 1)

	// AxGen retries a network error and a timeout as infrastructure errors.
	// The client's own retries are off, so each request is one AxGen attempt:
	// maxRetries 1 is the first attempt and one retry.
	noRequestRetry := map[string]ax.Value{"retry": ax.Object("maxRetries", 0)}
	for _, stream := range []bool{false, true} {
		before = closed.Load()
		_, err = ax.NewAx("question:string -> answer:string", nil).Forward(context.Background(), newClient(closing, noRequestRetry), map[string]ax.Value{"question": "hi"}, map[string]ax.Value{"maxRetries": 1, "stream": stream})
		expectType(fmt.Sprintf("AxGen network (stream %v)", stream), err, "AxAIServiceNetworkError", "Network Error: ")
		expectCount(fmt.Sprintf("AxGen network (stream %v)", stream), closed.Load()-before, 2)
		before = held.Load()
		_, err = ax.NewAx("question:string -> answer:string", nil).Forward(context.Background(), newClient(silent, noRequestRetry), map[string]ax.Value{"question": "hi"}, map[string]ax.Value{"maxRetries": 1, "stream": stream, "timeoutMs": 200})
		expectType(fmt.Sprintf("AxGen timeout (stream %v)", stream), err, "AxAIServiceTimeoutError", "Request timed out after 200ms")
		expectCount(fmt.Sprintf("AxGen timeout (stream %v)", stream), held.Load()-before, 2)
	}
	fmt.Println("transport-errors-http-roundtrip-ok")
}

func newClient(address string, options map[string]ax.Value) *ax.OpenAICompatibleClient {
	config := map[string]ax.Value{"api_key": "test-key", "base_url": "http://" + address, "model": "gpt-5.4-mini"}
	for key, value := range options {
		config[key] = value
	}
	return ax.NewOpenAICompatibleClient(config)
}

// expectType checks that err, or an error it wraps, is the Ax error type with
// a message that starts with prefix.
func expectType(label string, err error, errorType string, prefix string) {
	for current := err; current != nil; current = errors.Unwrap(current) {
		if typed, ok := ax.AsAxError(current); ok && typed.Type == errorType {
			if !strings.HasPrefix(typed.Message, prefix) {
				panic(fmt.Sprintf("%s: %q does not start with %q", label, typed.Message, prefix))
			}
			return
		}
	}
	panic(fmt.Sprintf("%s: want %s, got %T %v", label, errorType, err, err))
}

func expectCount(label string, got int32, want int32) {
	if got != want {
		panic(fmt.Sprintf("%s: %d requests, want %d", label, got, want))
	}
}

// A loopback address nothing listens on.
func closedAddress() string {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		panic(err)
	}
	address := listener.Addr().String()
	listener.Close()
	return address
}

const dropEvent = `data: {"id":"chatcmpl_drop","object":"chat.completion.chunk","created":0,"model":"gpt-5.4-mini","choices":[{"index":0,"delta":{"content":"Hel"},"finish_reason":null}]}` + "\n\n"

// serve accepts connections and counts them. "close" closes each one without
// a response, "drop" sends one stream event and drops it, and "hold" never
// answers.
func serve(mode string) (string, *atomic.Int32) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		panic(err)
	}
	var connections atomic.Int32
	go func() {
		var held []net.Conn
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			connections.Add(1)
			if mode == "hold" {
				held = append(held, conn)
				continue
			}
			// Read the whole request before answering or closing.
			if request, err := http.ReadRequest(bufio.NewReader(conn)); err == nil {
				io.Copy(io.Discard, request.Body)
			}
			if mode == "drop" {
				fmt.Fprintf(conn, "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\n\r\n%x\r\n%s\r\n", len(dropEvent), dropEvent)
				time.Sleep(50 * time.Millisecond)
			}
			conn.Close()
		}
	}()
	return listener.Addr().String(), &connections
}
