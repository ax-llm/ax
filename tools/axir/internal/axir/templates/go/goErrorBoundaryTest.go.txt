package axllm

import (
	"errors"
	"fmt"
	"testing"
)

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
