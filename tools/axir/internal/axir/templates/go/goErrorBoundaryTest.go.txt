package axllm

import (
	"context"
	"errors"
	"fmt"
	"encoding/base64"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"testing"
)

type metaDuplexProbe struct {
	frames chan Value
	closed chan struct{}
	once sync.Once
	chunks atomic.Int32
	ended atomic.Bool
	failSend bool
	closeEarly bool
}
func (p *metaDuplexProbe) Send(event Value) {
	if coreGet(event, "authorization", nil) != nil { p.frames <- Object("sessionId", "duplex"); return }
	if coreGet(event, "type", nil) == "binary" {
		if p.failSend { panic(AxError{Category: "network", Message: "audio send failed"}) }
		if p.closeEarly { p.Close(); return }
		if p.chunks.Add(1) == 1 { p.frames <- Object("type", "transcript", "transcript", "wrong hypothesis") }
	}
	if coreGet(event, "type", nil) == "endStream" { p.ended.Store(true); p.frames <- Object("type", "transcript", "transcript", "Correct final.", "final", true); p.frames <- nil }
}
func (p *metaDuplexProbe) Recv() (Value, bool) {
	select { case v := <-p.frames: return v, v != nil; case <-p.closed: return nil, false; case <-time.After(3*time.Second): panic("receiver timed out") }
}
func (p *metaDuplexProbe) Close() { p.once.Do(func() { close(p.closed) }) }

func TestMetaDuplexTranscriptAndSenderFailure(t *testing.T) {
	client := NewAI("meta", map[string]Value{"model": "muse-voice-transcribe-1.0", "api_key": "test"}).(*OpenAIResponsesClient)
	request := map[string]Value{"model": "muse-voice-transcribe-1.0", "audio": Object("input", Object("sampleRate", 16000, "channels", 1)), "chat_prompt": Array(Object("role", "user", "content", Array(Object("type", "audio", "format", "pcm16", "data", base64.StdEncoding.EncodeToString(make([]byte, 9600))))))}
	for _, mode := range []string{"complete", "sender-error", "early-close"} {
		failSend := mode == "sender-error"
		probe := &metaDuplexProbe{frames: make(chan Value, 4), closed: make(chan struct{}), failSend: failSend, closeEarly: mode == "early-close"}
		text := ""
		sawPartial := false
		_, err := client.realtimeChat(context.Background(), request, nil, probe, func(chunk Value) {
			for _, result := range asSlice(coreGet(chunk, "results", Array())) {
				if coreGet(coreGet(result, "transcript", Object()), "text", nil) == "wrong hypothesis" { sawPartial = true; if probe.ended.Load() { t.Error("partial delayed until endStream") } }
				text += display(coreGet(result, "content", ""))
			}
		})
		if failSend { if err == nil || err.Error() != "audio send failed" { t.Fatalf("sender error lost: %v", err) }; continue }
		if probe.closeEarly { if err == nil || err.Error() != "Meta Voice closed before audio upload completed" { t.Fatalf("early close accepted: %v", err) }; continue }
		if err != nil || !sawPartial || text != "Correct final." || probe.chunks.Load() != 4 || !probe.ended.Load() { t.Fatalf("duplex failure: %v %q %v %d", err, text, sawPartial, probe.chunks.Load()) }
	}
}

func TestMetaReplayAndRealtimeCredentials(t *testing.T) {
	previous := Object("thought_blocks", Array(Object("id", "r", "data", "Plan")), "images", Array(Object("id", "image", "data", "partial")))
	incoming := Object("thought_blocks", Array(Object("id", "r", "data", "Plan.", "summary", "Plan.", "encrypted_content", "opaque")))
	merged, err := ai_merge_replay_metadata(previous, incoming)
	if err != nil { t.Fatal(err) }
	blocks := asSlice(coreGet(merged, "thought_blocks", Array()))
	if len(blocks) != 1 || coreGet(blocks[0], "data", nil) != "Plan." || coreGet(blocks[0], "encrypted_content", nil) != "opaque" || len(asSlice(coreGet(merged, "images", Array()))) != 1 { t.Fatalf("replay state lost: %v", merged) }
	provider := AxCredentialProviderFunc(func(_ context.Context, request AxCredentialRequest) (map[string]string, error) {
		if request.Operation != "realtime" || request.Method != "WS" || request.URL != "wss://proxy.example/v1/asr/realtime" { t.Fatalf("bad credential request: %+v", request) }
		return map[string]string{"authorization": "Bearer refreshed"}, nil
	})
	client := NewAI("meta", map[string]Value{"model": "muse-voice-transcribe-1.0", "credential_provider": provider, "base_url": "https://proxy.example/v1/"}).(*OpenAIResponsesClient)
	transport := NewScriptedRealtimeTransport([]Value{Object("sessionId", "session")})
	_, err = client.RealtimeChat(context.Background(), map[string]Value{"model": "muse-voice-transcribe-1.0", "chat_prompt": Array(Object("role", "user", "content", Array(Object("type", "audio", "data", "AAE=", "format", "pcm16"))))}, nil, transport)
	if err != nil { t.Fatal(err) }
	if coreGet(coreGet(transport.Sent[0], "authorization", nil), "accessToken", nil) != "Bearer refreshed" { t.Fatalf("renewed credential not used: %v", transport.Sent[0]) }
}

// Hosts that map Ax failures onto their own error vocabulary can only see
// Error(), which renders Message alone and drops the status the provider
// actually reported. These tests lock the structured path: the envelope stays
// reachable through every concrete Ax error type and through wrapping, so a
// host classifies on Status rather than on provider message wording.
func TestErrorsAsReachesAxErrorThroughServiceError(t *testing.T) {
	throttled := error(AIServiceError{AxError{
		Category:  "ai",
		Type:      "AxAIServiceStatusError",
		Message:   "Tokens per minute limit exceeded - too many tokens processed.",
		Status:    429,
		Code:      "rate_limit_exceeded",
		Retryable: true,
	}})
	cases := map[string]error{
		"direct":  throttled,
		"wrapped": fmt.Errorf("chat failed: %w", throttled),
	}
	for name, err := range cases {
		var envelope AxError
		if !errors.As(err, &envelope) {
			t.Fatalf("%s: errors.As did not reach the AxError envelope", name)
		}
		if envelope.Status != 429 || envelope.Code != "rate_limit_exceeded" || !envelope.Retryable {
			t.Fatalf("%s: envelope = %+v, want a retryable 429", name, envelope)
		}
	}
}

func TestAsAxErrorReportsEnvelopePresence(t *testing.T) {
	envelope, ok := AsAxError(ValidationError{AxError{Category: "validation", Message: "bad field"}})
	if !ok || envelope.Category != "validation" {
		t.Fatalf("AsAxError(ValidationError) = %+v, %v", envelope, ok)
	}
	if envelope, ok := AsAxError(errors.New("plain")); ok {
		t.Fatalf("AsAxError(plain) = %+v, want no envelope", envelope)
	}
	if envelope, ok := AsAxError(nil); ok {
		t.Fatalf("AsAxError(nil) = %+v, want no envelope", envelope)
	}
}

// intrinsic.exception.rewrap makes "Generate failed: ..." from the error it
// wraps: same class and category, the new message, and the original as the
// cause that errors.Unwrap, errors.Is and errors.As reach.
func TestExceptionRewrapKeepsClassAndCause(t *testing.T) {
	// The IR hands a caught error over as its error value.
	caught := errorValue(ValidationError{AxError{Category: "validation", Message: "Field 'Count' has an invalid value 'lots'"}})
	unfixed := _core_exception_rewrap(caught, "Unable to fix validation error: Field 'Count' has an invalid value 'lots'")
	failed := _core_exception_rewrap(unfixed, "Generate failed: "+display(_core_exception_message(unfixed)))
	err := asError(failed)
	envelope, ok := AsAxError(err)
	if !ok || envelope.Category != "validation" || err.Error() != "Generate failed: Unable to fix validation error: Field 'Count' has an invalid value 'lots'" {
		t.Fatalf("rewrapped error = %T %+v %q, want a validation error with the new message", err, envelope, err.Error())
	}
	if _, isAxError := err.(AxError); !isAxError {
		t.Fatalf("rewrapped error is %T, want the AxError the original raises as", err)
	}
	cause := errors.Unwrap(err)
	if cause == nil || cause.Error() != "Unable to fix validation error: Field 'Count' has an invalid value 'lots'" || !errors.Is(err, cause) {
		t.Fatalf("errors.Unwrap = %v, want the rewrap it was made from", cause)
	}
	original := errors.Unwrap(cause)
	if original == nil || original.Error() != "Field 'Count' has an invalid value 'lots'" || asAxError(original).Category != "validation" || errors.Unwrap(original) != nil {
		t.Fatalf("errors.Unwrap twice = %v, want the original validation error", original)
	}
	if coreTruthy(_core_exception_is_aborted(failed)) || display(coreGet(errorValue(err), "message", nil)) != err.Error() {
		t.Fatalf("rewrapped error value = %v", errorValue(err))
	}

	// A Go error keeps its concrete type, and errors.Is and errors.As reach it.
	unavailable := AIServiceError{AxError{Category: "ai", Type: "AxAIServiceStatusError", Message: "Service Unavailable", Status: 503, Retryable: true}}
	wrapped := asError(_core_exception_rewrap(unavailable, "Generate failed: Service Unavailable"))
	var service AIServiceError
	if !errors.As(wrapped, &service) || service.Message != "Generate failed: Service Unavailable" || service.Type != "AxAIServiceStatusError" || service.Status != 503 || !service.Retryable {
		t.Fatalf("errors.As(AIServiceError) = %+v, want the rewrapped status error", service)
	}
	if !errors.Is(wrapped, unavailable) || axErrorCause(wrapped) != error(unavailable) || !coreTruthy(_core_exception_is_infrastructure(wrapped)) {
		t.Fatalf("rewrapped status error does not reach its cause: %v", axErrorCause(wrapped))
	}

	// An Ax error behind another wrapper keeps its class and category, and
	// the error value is the rewrap's, not its cause's.
	behind := fmt.Errorf("chat failed: %w", unavailable)
	rewrapped := asError(_core_exception_rewrap(behind, "Generate failed: chat failed: Service Unavailable"))
	value := errorValue(rewrapped)
	if coreGet(value, "__type", nil) != "AxAIServiceStatusError" || coreGet(value, "__error", nil) != "ai" || coreGet(value, "message", nil) != "Generate failed: chat failed: Service Unavailable" {
		t.Fatalf("error value of a rewrapped wrapper = %v", value)
	}
	if errors.Unwrap(rewrapped) != behind || !errors.Is(rewrapped, unavailable) {
		t.Fatalf("rewrapped wrapper does not unwrap to it: %v", errors.Unwrap(rewrapped))
	}
}

// cachingTestClient answers each chat with the next reply and counts the
// requests.
type cachingTestClient struct {
	replies  []string
	requests int
}

func (c *cachingTestClient) Chat(context.Context, map[string]Value, map[string]Value) (Value, error) {
	if c.requests >= len(c.replies) {
		return nil, errors.New("caching test client exhausted")
	}
	c.requests++
	return Object("results", Array(Object("content", c.replies[c.requests-1], "function_calls", Array()))), nil
}
func (c *cachingTestClient) Embed(context.Context, map[string]Value, map[string]Value) (Value, error) {
	return nil, nil
}
func (c *cachingTestClient) Stream(context.Context, map[string]Value, map[string]Value) ([]Value, error) {
	return nil, nil
}

// memoryCache is an in-memory caching function: a nil map is a miss.
type memoryCache struct {
	entries       map[string]map[string]Value
	reads, writes int
}

func newMemoryCache() *memoryCache { return &memoryCache{entries: map[string]map[string]Value{}} }

func (m *memoryCache) cache(key string, value map[string]Value) (map[string]Value, error) {
	if value != nil {
		m.writes++
		m.entries[key] = value
		return nil, nil
	}
	m.reads++
	return m.entries[key], nil
}

// TestAxGenCachingFunction uses the public caching API: the constructor's
// function, a forward call's function, which comes first, and the
// process-wide one.
func TestAxGenCachingFunction(t *testing.T) {
	ctx := context.Background()
	question := map[string]Value{"question": "Capital of France?"}
	answer := func(out Value) Value { return coreGet(out, "answer", nil) }

	// The constructor's function: the first forward stores, the second hits.
	constructorCache := newMemoryCache()
	gen := NewAx("question:string -> answer:string", map[string]Value{"cachingFunction": AxCachingFunction(constructorCache.cache)})
	client := &cachingTestClient{replies: []string{"Answer: Paris"}}
	for i := 0; i < 2; i++ {
		if out, err := gen.Forward(ctx, client, question, nil); err != nil || answer(out) != "Paris" {
			t.Fatalf("constructor cache forward %d = %v, %v", i, out, err)
		}
	}
	if client.requests != 1 || constructorCache.reads != 2 || constructorCache.writes != 1 {
		t.Fatalf("constructor cache: %d requests, %d reads, %d writes", client.requests, constructorCache.reads, constructorCache.writes)
	}
	for key, stored := range constructorCache.entries {
		if _, internal := stored["__order"]; internal || len(key) != 64 || strings.Trim(key, "0123456789abcdef") != "" {
			t.Fatalf("stored %q = %v, want a plain map under a lowercase hex SHA-256 key", key, stored)
		}
	}

	// StreamingForward yields a hit as one delta, without a request.
	var deltas []AxGenDelta
	for delta, err := range gen.StreamingForward(ctx, client, question, nil) {
		if err != nil {
			t.Fatal(err)
		}
		deltas = append(deltas, delta)
	}
	if len(deltas) != 1 || deltas[0].Version != 0 || deltas[0].Index != 0 || answer(deltas[0].Delta) != "Paris" || client.requests != 1 {
		t.Fatalf("streaming cache hit = %+v after %d requests", deltas, client.requests)
	}

	// A forward call's function, here a plain func under the snake_case key,
	// comes before the constructor's.
	callCache := newMemoryCache()
	var callFunction func(string, map[string]Value) (map[string]Value, error) = callCache.cache
	callClient := &cachingTestClient{replies: []string{"Answer: Paris, France"}}
	for i := 0; i < 2; i++ {
		if out, err := gen.Forward(ctx, callClient, question, map[string]Value{"caching_function": callFunction}); err != nil || answer(out) != "Paris, France" {
			t.Fatalf("call cache forward %d = %v, %v", i, out, err)
		}
	}
	if callClient.requests != 1 || callCache.reads != 2 || callCache.writes != 1 || constructorCache.reads != 3 {
		t.Fatalf("call cache: %d requests, %d reads, %d writes; constructor cache read %d times", callClient.requests, callCache.reads, callCache.writes, constructorCache.reads)
	}

	// A run control bypasses the cache.
	controlClient := &cachingTestClient{replies: []string{"Answer: Lyon"}}
	if out, err := gen.Forward(ctx, controlClient, question, map[string]Value{"control": RunControl()}); err != nil || answer(out) != "Lyon" || constructorCache.reads != 3 {
		t.Fatalf("controlled forward = %v, %v after %d cache reads", out, err, constructorCache.reads)
	}

	// An empty output is stored as an empty map, which is a hit.
	emptyCache := newMemoryCache()
	optional := NewAx("question:string -> answer?:string, note?:string", map[string]Value{"cachingFunction": AxCachingFunction(emptyCache.cache)})
	emptyClient := &cachingTestClient{replies: []string{"Nothing to report."}}
	for i := 0; i < 2; i++ {
		if out, err := optional.Forward(ctx, emptyClient, question, nil); err != nil || len(out.(map[string]Value)) != 0 {
			t.Fatalf("empty output forward %d = %v, %v", i, out, err)
		}
	}
	if emptyClient.requests != 1 || emptyCache.writes != 1 {
		t.Fatalf("empty output: %d requests, %d writes", emptyClient.requests, emptyCache.writes)
	}

	// The process-wide function, for an AxGen and a call that set none; nil
	// clears it.
	globalCache := newMemoryCache()
	SetCachingFunction(globalCache.cache)
	defer SetCachingFunction(nil)
	plain := NewAx("question:string -> answer:string", nil)
	globalClient := &cachingTestClient{replies: []string{"Answer: Paris", "Answer: Paris again"}}
	for i := 0; i < 2; i++ {
		if out, err := plain.Forward(ctx, globalClient, question, nil); err != nil || answer(out) != "Paris" {
			t.Fatalf("global cache forward %d = %v, %v", i, out, err)
		}
	}
	SetCachingFunction(nil)
	if out, err := plain.Forward(ctx, globalClient, question, nil); err != nil || answer(out) != "Paris again" {
		t.Fatalf("forward after clearing the global cache = %v, %v", out, err)
	}
	if globalClient.requests != 2 || globalCache.reads != 2 || globalCache.writes != 1 {
		t.Fatalf("global cache: %d requests, %d reads, %d writes", globalClient.requests, globalCache.reads, globalCache.writes)
	}
}

// cacheTelemetryTracer records the name of each span started.
type cacheTelemetryTracer struct {
	mu    sync.Mutex
	spans []string
}

func (r *cacheTelemetryTracer) StartSpan(start AxSpanStart) AxSpan {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.spans = append(r.spans, start.Name)
	return cacheTelemetrySpan{}
}

// take returns the spans started since the last take.
func (r *cacheTelemetryTracer) take() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	spans := r.spans
	r.spans = nil
	return spans
}

type cacheTelemetrySpan struct{}

func (cacheTelemetrySpan) SetAttributes(map[string]Value)    {}
func (cacheTelemetrySpan) AddEvent(string, map[string]Value) {}
func (cacheTelemetrySpan) RecordException(error)             {}
func (cacheTelemetrySpan) SetStatus(string, string)          {}
func (cacheTelemetrySpan) End()                              {}

// cacheTelemetryMeter records the name of each metric written.
type cacheTelemetryMeter struct {
	mu      sync.Mutex
	metrics []string
}

type cacheTelemetryInstrument struct {
	meter *cacheTelemetryMeter
	name  string
}

func (i cacheTelemetryInstrument) Add(float64, map[string]Value)    { i.meter.record(i.name) }
func (i cacheTelemetryInstrument) Record(float64, map[string]Value) { i.meter.record(i.name) }

func (m *cacheTelemetryMeter) record(name string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.metrics = append(m.metrics, name)
}

// take returns the metrics written since the last take.
func (m *cacheTelemetryMeter) take() []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	metrics := m.metrics
	m.metrics = nil
	return metrics
}

func (m *cacheTelemetryMeter) CreateCounter(name string, _ AxMetricInstrumentOptions) AxCounter {
	return cacheTelemetryInstrument{m, name}
}
func (m *cacheTelemetryMeter) CreateHistogram(name string, _ AxMetricInstrumentOptions) AxHistogram {
	return cacheTelemetryInstrument{m, name}
}
func (m *cacheTelemetryMeter) CreateGauge(name string, _ AxMetricInstrumentOptions) AxGauge {
	return cacheTelemetryInstrument{m, name}
}

// TestAxGenCacheReadPrecedesTelemetry: as in TypeScript, AxGen reads the cache
// before it opens the run's ax_gen_forward span and ax_gen_generation
// metrics, so a hit from Forward (with or without stream) or StreamingForward
// records neither, and nor does a read error that fails Forward; a miss
// records both.
func TestAxGenCacheReadPrecedesTelemetry(t *testing.T) {
	ctx := context.Background()
	tracer, meter := &cacheTelemetryTracer{}, &cacheTelemetryMeter{}
	cache := newMemoryCache()
	gen := NewAx("question:string -> answer:string", map[string]Value{"cachingFunction": AxCachingFunction(cache.cache)})
	gen.SetTracer(tracer).SetMeter(meter)
	client := &cachingTestClient{replies: []string{"Answer: Paris", "Answer: Rome"}}
	france := map[string]Value{"question": "Capital of France?"}
	italy := map[string]Value{"question": "Capital of Italy?"}
	answer := func(out Value) Value { return coreGet(out, "answer", nil) }
	// expectTelemetry checks what the calls since the last check recorded.
	expectTelemetry := func(label string, recorded bool) {
		t.Helper()
		spans, metrics := tracer.take(), meter.take()
		span, metric := false, false
		for _, name := range spans {
			span = span || name == "ax_gen_forward"
		}
		for _, name := range metrics {
			metric = metric || strings.HasPrefix(name, "ax_gen_generation_")
		}
		if span != recorded || metric != recorded {
			t.Fatalf("%s recorded spans %v and metrics %v; want the ax_gen_forward span and ax_gen_generation metrics: %v", label, spans, metrics, recorded)
		}
	}
	// streamedAnswer runs StreamingForward and joins the answer deltas.
	streamedAnswer := func(values map[string]Value) (string, int, error) {
		text, count := "", 0
		for delta, err := range gen.StreamingForward(ctx, client, values, nil) {
			if err != nil {
				return text, count, err
			}
			text += display(delta.Delta["answer"])
			count++
		}
		return text, count, nil
	}

	if out, err := gen.Forward(ctx, client, france, nil); err != nil || answer(out) != "Paris" {
		t.Fatalf("Forward miss = %v, %v", out, err)
	}
	expectTelemetry("Forward miss", true)
	if out, err := gen.Forward(ctx, client, france, nil); err != nil || answer(out) != "Paris" {
		t.Fatalf("Forward hit = %v, %v", out, err)
	}
	expectTelemetry("Forward hit", false)
	if out, err := gen.Forward(ctx, client, france, map[string]Value{"stream": true}); err != nil || answer(out) != "Paris" {
		t.Fatalf("Forward hit with stream = %v, %v", out, err)
	}
	expectTelemetry("Forward hit with stream", false)
	if text, count, err := streamedAnswer(france); err != nil || text != "Paris" || count != 1 {
		t.Fatalf("StreamingForward hit = %q in %d deltas, %v", text, count, err)
	}
	expectTelemetry("StreamingForward hit", false)
	if text, _, err := streamedAnswer(italy); err != nil || text != "Rome" {
		t.Fatalf("StreamingForward miss = %q, %v", text, err)
	}
	expectTelemetry("StreamingForward miss", true)
	if out, err := gen.Forward(ctx, client, italy, nil); err != nil || answer(out) != "Rome" {
		t.Fatalf("Forward hit after StreamingForward = %v, %v", out, err)
	}
	expectTelemetry("Forward hit after StreamingForward", false)
	// One read per call: the forward does not read again after the host.
	if client.requests != 2 || cache.reads != 6 || cache.writes != 2 {
		t.Fatalf("%d requests, %d cache reads and %d cache writes, want 2, 6 and 2", client.requests, cache.reads, cache.writes)
	}

	failing := AxCachingFunction(func(string, map[string]Value) (map[string]Value, error) {
		return nil, errors.New("cache offline")
	})
	if _, err := gen.Forward(ctx, client, france, map[string]Value{"cachingFunction": failing}); err == nil || err.Error() != "cache offline" {
		t.Fatalf("Forward read error = %v, want cache offline", err)
	}
	expectTelemetry("Forward read error", false)
}

// TestAxFlowCacheReadPrecedesTelemetry: as in TypeScript, AxFlow reads its
// cache before it opens its ax_gen_flow_forward span and ax_gen_flow metrics,
// so a hit, from Forward or StreamingForward, runs no node and records
// nothing, while a miss records both.
func TestAxFlowCacheReadPrecedesTelemetry(t *testing.T) {
	ctx := context.Background()
	tracer, meter := &cacheTelemetryTracer{}, &cacheTelemetryMeter{}
	cache := newMemoryCache()
	flow := NewFlow(Object("id", "cached-flow"))
	flow.Execute("qa", NewAx("question:string -> answer:string", nil), nil)
	flow.Returns(Object("answer", "answer"))
	flow.SetTracer(tracer).SetMeter(meter)
	client := &cachingTestClient{replies: []string{"Answer: Paris"}}
	question := map[string]Value{"question": "Capital of France?"}
	options := map[string]Value{"cachingFunction": AxCachingFunction(cache.cache)}

	if out, err := flow.Forward(ctx, client, question, options); err != nil || coreGet(out, "answer", nil) != "Paris" {
		t.Fatalf("flow miss = %v, %v", out, err)
	}
	spans, metrics := tracer.take(), meter.take()
	span, metric := false, false
	for _, name := range spans {
		span = span || name == "ax_gen_flow_forward"
	}
	for _, name := range metrics {
		metric = metric || strings.HasPrefix(name, "ax_gen_flow_")
	}
	if !span || !metric {
		t.Fatalf("flow miss recorded spans %v and metrics %v, want the ax_gen_flow_forward span and ax_gen_flow metrics", spans, metrics)
	}

	if out, err := flow.Forward(ctx, client, question, options); err != nil || coreGet(out, "answer", nil) != "Paris" {
		t.Fatalf("flow hit = %v, %v", out, err)
	}
	if spans, metrics := tracer.take(), meter.take(); len(spans) != 0 || len(metrics) != 0 {
		t.Fatalf("flow Forward hit recorded spans %v and metrics %v, want none", spans, metrics)
	}
	var deltas []AxGenDelta
	for delta, err := range flow.StreamingForward(ctx, client, question, options) {
		if err != nil {
			t.Fatal(err)
		}
		deltas = append(deltas, delta)
	}
	if len(deltas) != 1 || deltas[0].Version != 1 || deltas[0].Index != 0 || coreGet(deltas[0].Delta, "answer", nil) != "Paris" {
		t.Fatalf("flow StreamingForward hit = %+v, want one {1, 0} delta", deltas)
	}
	if _, internal := deltas[0].Delta["__order"]; internal {
		t.Fatalf("flow StreamingForward hit delta = %v, want a plain map", deltas[0].Delta)
	}
	if spans, metrics := tracer.take(), meter.take(); len(spans) != 0 || len(metrics) != 0 {
		t.Fatalf("flow StreamingForward hit recorded spans %v and metrics %v, want none", spans, metrics)
	}
	if client.requests != 1 {
		t.Fatalf("%d requests, want the node to run once", client.requests)
	}
}

func TestIsRetryableFollowsCoreStatusSet(t *testing.T) {
	for status, want := range map[int]bool{
		408: true, 429: true, 500: true, 502: true, 503: true, 504: true, 529: true,
		400: false, 404: false, 422: false,
	} {
		err := error(AIServiceError{AxError{Type: "AxAIServiceStatusError", Status: status}})
		if got := IsRetryable(err); got != want {
			t.Fatalf("IsRetryable(status %d) = %v, want %v", status, got, want)
		}
	}
	// Credentials never improve by trying again, whatever status carries them.
	if IsRetryable(AIServiceError{AxError{Type: "AxAIServiceAuthenticationError", Status: 429}}) {
		t.Fatal("an authentication failure must not be retryable")
	}
	if !IsRetryable(fmt.Errorf("transport: %w", error(AxError{Category: "network"}))) {
		t.Fatal("a wrapped network failure must be retryable")
	}
	if !IsRetryable(AxError{Category: "provider", Retryable: true}) {
		t.Fatal("an envelope that declares itself retryable must be retryable")
	}
	if IsRetryable(nil) || IsRetryable(errors.New("plain")) {
		t.Fatal("only Ax envelopes classify as retryable")
	}
}

// assertionTestClient answers each request with the next reply and records
// each request's chat prompt.
type assertionTestClient struct {
	replies []string
	prompts []string
}

func (c *assertionTestClient) Chat(_ context.Context, request map[string]Value, _ map[string]Value) (Value, error) {
	if len(c.prompts) >= len(c.replies) {
		return nil, errors.New("assertion test client exhausted")
	}
	c.prompts = append(c.prompts, stableStringify(coreGet(request, "chat_prompt", Array())))
	return Object("results", Array(Object("content", c.replies[len(c.prompts)-1], "function_calls", Array()))), nil
}
func (c *assertionTestClient) Embed(context.Context, map[string]Value, map[string]Value) (Value, error) {
	return nil, nil
}
func (c *assertionTestClient) Stream(context.Context, map[string]Value, map[string]Value) ([]Value, error) {
	return nil, nil
}

// A func assertion works as a TypeScript addAssert function: a message fails
// the attempt and the retry carries it as the correction; false without a
// message ends the forward. (A func used to pass unchecked.)
func TestAxGenFuncAssertionRetriesWithItsMessage(t *testing.T) {
	ctx := context.Background()
	question := map[string]Value{"question": "Capital of France?"}
	client := &assertionTestClient{replies: []string{"Answer: Lyon", "Answer: Paris"}}
	gen := NewAx("question:string -> answer:string", nil)
	gen.AddAssert(AxAssertion(func(values map[string]Value) Value {
		if values["answer"] != "Paris" {
			return "The capital of France is Paris."
		}
		return nil
	}))
	out, err := gen.Forward(ctx, client, question, nil)
	if err != nil || coreGet(out, "answer", nil) != "Paris" {
		t.Fatalf("forward = %v, %v", out, err)
	}
	if len(client.prompts) != 2 || !strings.Contains(client.prompts[1], "The capital of France is Paris.") {
		t.Fatalf("the retry did not carry the assertion's message: %q", client.prompts)
	}

	failing := NewAx("question:string -> answer:string", nil)
	failing.AddAssert(func(map[string]Value) bool { return false })
	if _, err := failing.Forward(ctx, &assertionTestClient{replies: []string{"Answer: Paris"}}, question, nil); err == nil || !strings.Contains(err.Error(), "Assertion failed without message") {
		t.Fatalf("a failure without a message = %v", err)
	}
}
