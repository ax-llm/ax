package axllm

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/coder/websocket"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

type paritySocket struct {
	incoming chan string
	sent     chan string
	closed   chan struct{}
	once     sync.Once
	fail     atomic.Bool
}

func newParitySocket() *paritySocket {
	return &paritySocket{incoming: make(chan string, 8), sent: make(chan string, 8), closed: make(chan struct{})}
}
func (s *paritySocket) Send(text string) error {
	if s.fail.Load() {
		return fmt.Errorf("send failed")
	}
	s.sent <- text
	return nil
}
func (s *paritySocket) Receive() (string, error) {
	select {
	case text := <-s.incoming:
		return text, nil
	case <-s.closed:
		return "", fmt.Errorf("socket closed")
	}
}
func (s *paritySocket) Close() error { s.once.Do(func() { close(s.closed) }); return nil }
func parityWaitSent(t *testing.T, s *paritySocket) {
	t.Helper()
	select {
	case <-s.sent:
	case <-time.After(time.Second):
		t.Fatal("request did not start")
	}
}
func parityWaitResult(t *testing.T, done chan error, want string) {
	t.Helper()
	select {
	case err := <-done:
		if err == nil || !strings.Contains(err.Error(), want) {
			t.Fatalf("expected %q, got %v", want, err)
		}
	case <-time.After(time.Second):
		t.Fatal("pending request leaked")
	}
}
func TestMCPWebSocketCleanup(t *testing.T) {
	socket := newParitySocket()
	transport := NewAxMCPWebSocketTransport("ws://example.test", map[string]Value{"webSocketFactory": AxMCPWebSocketFactory(func(string, []string) (AxMCPWebSocket, error) { return socket, nil })})
	defer transport.Close()
	transport.SetProtocolVersion("2025-03-26")
	request := map[string]Value{"jsonrpc": "2.0", "id": 1, "method": "ping"}
	socket.fail.Store(true)
	if _, err := transport.Send(request); err == nil {
		t.Fatal("missing synchronous send failure")
	}
	if _, err := transport.SendBatch(context.Background(), []Value{request, map[string]Value{"id": 2, "method": "ping"}}); err == nil {
		t.Fatal("missing batch failure")
	}
	if len(transport.pending) != 0 {
		t.Fatal("send failure retained pending work")
	}
	socket.fail.Store(false)
	old, cancelOld := context.WithCancel(context.Background())
	defer cancelOld()
	done := make(chan error, 1)
	go func() { _, err := transport.SendWithContext(old, request, nil); done <- err }()
	parityWaitSent(t, socket)
	socket.incoming <- `{"id":1,"result":"first"}`
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	go func() {
		result, err := transport.Send(request)
		if err == nil && result["result"] != "second" {
			err = fmt.Errorf("wrong response")
		}
		done <- err
	}()
	parityWaitSent(t, socket)
	cancelOld()
	if _, err := transport.Send(request); err == nil {
		t.Fatal("overwrote pending request")
	}
	socket.incoming <- `{"id":1,"result":"second"}`
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		_, err := transport.SendBatch(ctx, []Value{request, map[string]Value{"id": 2, "method": "ping"}})
		done <- err
	}()
	parityWaitSent(t, socket)
	cancel()
	parityWaitResult(t, done, "canceled")
	go func() {
		_, err := transport.SendBatch(context.Background(), []Value{request, map[string]Value{"id": 2, "method": "ping"}})
		done <- err
	}()
	parityWaitSent(t, socket)
	_ = transport.Close()
	parityWaitResult(t, done, "closed")
	transport.mu.Lock()
	defer transport.mu.Unlock()
	if len(transport.pending) != 0 {
		t.Fatal("close retained pending work")
	}
}
func TestTypesafeNativeHTTP(t *testing.T) {
	var calls atomic.Int32
	started := make(chan struct{}, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v1/models" {
			if r.Method != "GET" || r.ContentLength != 0 {
				t.Error("model discovery must use bodyless GET")
			}
			if r.Header.Get("Authorization") != "Bearer test" {
				t.Error("missing credentials")
			}
			if calls.Add(1) == 1 {
				w.WriteHeader(429)
				_, _ = w.Write([]byte(`{"error":"retry"}`))
				return
			}
			_, _ = w.Write([]byte(`{"models":[{"name":"jev-latest","description":"Jev","release_date":"2026-09-01"}]}`))
			return
		}
		var body map[string]Value
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
			return
		}
		if body["state"] == "stall" {
			w.Header().Set("Content-Length", "10000")
			w.WriteHeader(200)
			w.(http.Flusher).Flush()
			started <- struct{}{}
			<-r.Context().Done()
			return
		}
		answers := map[string]Value{}
		for key := range body["questions"].(map[string]Value) {
			answers[key] = map[string]Value{"type": "noul", "noul": body["state"].(map[string]Value)["probability"]}
		}
		_ = json.NewEncoder(w).Encode(map[string]Value{"model": body["model"], "answers": answers, "usage": map[string]Value{"input_tokens": 1, "output_tokens": 1}})
	}))
	defer server.Close()
	client := Typesafe(map[string]Value{"api_key": "test", "base_url": server.URL, "retry": map[string]Value{"maxRetries": 1, "initialDelayMs": 1}})
	models, err := client.ListModels(context.Background(), nil)
	if err != nil || len(models) != 1 || calls.Load() != 2 {
		t.Fatalf("model discovery/retry: %v %v", models, err)
	}
	var wg sync.WaitGroup
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			key := fmt.Sprintf("question%d", i)
			probability := float64(i) / 10
			result, err := client.SystemOne(context.Background(), TypesafeRequest{State: map[string]Value{"probability": probability}, Questions: map[string]TypesafeQuestion{key: {Type: "noul"}}}, nil)
			if err != nil || result.Answers[key].Noul != probability {
				t.Errorf("request isolation: %v %v", result, err)
			}
		}(i)
	}
	wg.Wait()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() {
		_, err := client.SystemOne(ctx, TypesafeRequest{State: "stall", Questions: map[string]TypesafeQuestion{"flag": {Type: "noul"}}}, nil)
		done <- err
	}()
	select {
	case <-started:
	case <-time.After(2 * time.Second):
		t.Fatal("native call did not start")
	}
	cancel()
	parityWaitResult(t, done, "abort")
}

// Exercise the built-in socket, including concurrent requests and remote close.
func TestMCPWebSocketNativeRoundTrip(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		socket, err := websocket.Accept(w, r, nil)
		if err != nil {
			t.Error(err)
			return
		}
		defer socket.CloseNow()
		for {
			_, data, err := socket.Read(r.Context())
			if err != nil {
				return
			}
			var request map[string]Value
			if err = json.Unmarshal(data, &request); err != nil {
				t.Error(err)
				return
			}
			if request["method"] == "close" {
				return
			}
			response, _ := json.Marshal(map[string]Value{"jsonrpc": "2.0", "id": request["id"], "result": request["id"]})
			if err = socket.Write(r.Context(), websocket.MessageText, response); err != nil {
				return
			}
		}
	}))
	defer server.Close()
	transport := NewAxMCPWebSocketTransport("ws"+strings.TrimPrefix(server.URL, "http"), nil)
	defer transport.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	var wg sync.WaitGroup
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			response, err := transport.SendWithContext(ctx, map[string]Value{"id": i, "method": "ping"}, nil)
			if err != nil || response["result"] != float64(i) {
				t.Errorf("native socket response: %v %v", response, err)
			}
		}(i)
	}
	wg.Wait()
	if _, err := transport.SendWithContext(ctx, map[string]Value{"id": 11, "method": "close"}, nil); err == nil {
		t.Fatal("remote close did not reject pending request")
	}
	transport.mu.Lock()
	defer transport.mu.Unlock()
	if len(transport.pending) != 0 {
		t.Fatal("native socket close retained pending work")
	}
}

func TestTypesafeNestedBalancerValidation(t *testing.T) {
	typed := NewAI("typesafe", map[string]Value{"api_key": "test", "models": []Value{}}).(AxAIService)
	only, err := NewAxBalancer([]AxAIService{typed}, nil)
	if err != nil {
		t.Fatal(err)
	}
	prose := map[string]Value{"chat_prompt": []Value{map[string]Value{"role": "user", "content": "reply"}}}
	if only.ValidateChatRequest(prose) == nil {
		t.Fatal("nested Typesafe accepted prose")
	}
	var supported map[string]Value
	if err = json.Unmarshal([]byte(`{"chat_prompt":[{"role":"user","content":"outage"}],"response_format":{"type":"json_schema","schema":{"name":"decision","schema":{"type":"object","properties":{"urgent":{"type":"boolean"}},"required":["urgent"]}}}}`), &supported); err != nil {
		t.Fatal(err)
	}
	if err = only.ValidateChatRequest(supported); err != nil {
		t.Fatal(err)
	}
	mixed, err := NewAxBalancer([]AxAIService{only, NewAI("openai", map[string]Value{"api_key": "test", "models": []Value{}}).(AxAIService)}, nil)
	if err != nil {
		t.Fatal(err)
	}
	candidates, err := mixed.candidateServices(prose)
	if err != nil || len(candidates) != 1 {
		t.Fatalf("nested selection: %v %v", candidates, err)
	}
}
