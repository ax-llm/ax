package axllm

import (
	"context"
	"errors"
	"fmt"
	"encoding/base64"
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
