package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"strings"

	ax "github.com/ax-llm/ax/packages/go"
)

type trackingReadCloser struct {
	io.Reader
	closed *bool
}

func (r *trackingReadCloser) Close() error { *r.closed = true; return nil }

type oneByteReader struct{ io.Reader }

func (r *oneByteReader) Read(target []byte) (int, error) {
	if len(target) > 1 {
		target = target[:1]
	}
	return r.Reader.Read(target)
}

type incrementalTransport struct{ closed bool }

func (t *incrementalTransport) Call(context.Context, ax.Value) (ax.Value, error) {
	return ax.Object("status", 200, "body", ""), nil
}

type errorAfterReader struct{ io.Reader }

func (r *errorAfterReader) Read(target []byte) (int, error) {
	n, err := r.Reader.Read(target)
	if n > 0 {
		return n, nil
	}
	if errors.Is(err, io.EOF) {
		return 0, errors.New("upstream closed")
	}
	return n, err
}

type failingTransport struct{ attempts int }

func (t *failingTransport) Call(context.Context, ax.Value) (ax.Value, error) {
	return ax.Object("status", 200, "body", ""), nil
}

func (t *failingTransport) Stream(context.Context, ax.Value) (ax.AxHTTPStreamResponse, error) {
	t.attempts++
	body := "data: {\"id\":\"chatcmpl_failure\",\"model\":\"gpt-5.4-mini\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"delivered\"}}]}\n\n"
	return ax.AxHTTPStreamResponse{Status: 200, Body: &trackingReadCloser{Reader: &errorAfterReader{Reader: strings.NewReader(body)}, closed: new(bool)}}, nil
}

func (t *incrementalTransport) Stream(context.Context, ax.Value) (ax.AxHTTPStreamResponse, error) {
	body := "data: {\"id\":\"chatcmpl_cancel\",\"model\":\"gpt-5.4-mini\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"first 🌍\"}}]}\r\n\r\n" +
		"data: {\"id\":\"chatcmpl_cancel\",\"model\":\"gpt-5.4-mini\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"second\"}}]}\r\n\r\n"
	return ax.AxHTTPStreamResponse{Status: 200, Body: &trackingReadCloser{Reader: &oneByteReader{Reader: strings.NewReader(body)}, closed: &t.closed}}, nil
}

func main() {
	transport := ax.NewScriptedTransport([]ax.Value{
		ax.Object(
			"status", 200,
			"body", "data: {\"id\":\"chatcmpl_stream\",\"model\":\"gpt-5.4-mini\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"hel\"}}]}\n\n"+
				"data: {\"id\":\"chatcmpl_stream\",\"model\":\"gpt-5.4-mini\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"lo\"},\"finish_reason\":\"stop\"}]}\n\n"+
				"data: {\"id\":\"chatcmpl_stream\",\"model\":\"gpt-5.4-mini\",\"choices\":[],\"usage\":{\"prompt_tokens\":1,\"completion_tokens\":2,\"total_tokens\":3}}\n\n"+
				"data: [DONE]\n\n",
		),
	})
	client := ax.NewOpenAICompatibleClient(map[string]ax.Value{
		"api_key":   "test-key",
		"model":     "gpt-5.4-mini",
		"transport": transport,
	})
	usageEvents := []ax.AxUsageEvent{}
	ax.SetUsageObserver(func(event ax.AxUsageEvent) { usageEvents = append(usageEvents, event) })
	events, err := client.Stream(context.Background(), map[string]ax.Value{
		"chat_prompt": ax.Array(ax.Object("role", "user", "content", "stream")),
	}, nil)
	if err != nil {
		panic(err)
	}
	ax.SetUsageObserver(nil)
	text := ""
	for _, event := range events {
		results := resultsOf(event)
		if len(results) == 0 {
			continue
		}
		first := results[0].(map[string]ax.Value)
		if content, ok := first["content"].(string); ok {
			text += content
		}
	}
	if text != "hello" {
		panic(fmt.Sprintf("bad stream: %s", text))
	}
	if len(usageEvents) != 1 {
		panic(fmt.Sprintf("usage was not delivered after completion: %v", usageEvents))
	}
	incremental := &incrementalTransport{}
	cancelClient := ax.NewOpenAICompatibleClient(map[string]ax.Value{"api_key": "test-key", "model": "gpt-5.4-mini", "transport": incremental})
	stream, err := cancelClient.StreamEvents(context.Background(), map[string]ax.Value{
		"chat_prompt": ax.Array(ax.Object("role", "user", "content", "cancel")),
	}, nil)
	if err != nil || !stream.Next() {
		panic(fmt.Sprintf("incremental stream failed: %v", err))
	}
	if err := stream.Close(); err != nil {
		panic(err)
	}
	if !incremental.closed {
		panic("consumer cancellation did not close the upstream stream")
	}
	failing := &failingTransport{}
	failureClient := ax.NewOpenAICompatibleClient(map[string]ax.Value{"api_key": "test-key", "model": "gpt-5.4-mini", "transport": failing})
	failureStream, err := failureClient.StreamEvents(context.Background(), map[string]ax.Value{
		"chat_prompt": ax.Array(ax.Object("role", "user", "content", "fail")),
	}, nil)
	if err != nil || !failureStream.Next() {
		panic(fmt.Sprintf("missing first event: %v", err))
	}
	if failureStream.Next() || failureStream.Err() == nil {
		panic("mid-stream failure was not surfaced")
	}
	if failing.attempts != 1 {
		panic("mid-stream failure replayed the request")
	}
	fmt.Println("go-provider-stream-no-key", text)
}

func resultsOf(value ax.Value) []ax.Value {
	raw := value.(map[string]ax.Value)["results"]
	switch values := raw.(type) {
	case []ax.Value:
		return values
	case *ax.AxArray:
		return values.Items
	default:
		panic(fmt.Sprintf("unexpected results type %T", raw))
	}
}
