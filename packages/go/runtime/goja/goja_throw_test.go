package goja

import (
	"errors"
	"strings"
	"testing"

	ax "github.com/ax-llm/ax/packages/go"
)

// A host callable error must surface in the model's JavaScript as a thrown
// exception, matching the TypeScript runtime (runtimeGlobals.ts rethrows).
// The old behavior returned an {is_error: true} object, which straight-line
// generated code — `const res = await tool(...); await final("done")` —
// treated as success: in JavaScript, no exception reads as success.
func TestHostCallableErrorThrowsIntoScript(t *testing.T) {
	runtime := NewRuntime().RegisterCallable("failing_tool", func(ax.Value) (ax.Value, error) {
		return nil, errors.New("this write did NOT execute: fix X then retry")
	})
	session, err := runtime.CreateSession(nil, nil)
	if err != nil {
		t.Fatal(err)
	}

	// try/catch observes the error text, so a model that handles the failure
	// can read the teaching out of the exception.
	caught := asMap(session.Execute(`
let seen = "";
try {
  failing_tool({a: 1});
  seen = "no-throw";
} catch (e) {
  seen = String(e);
}
await final(seen);
`, nil))
	text := ""
	if args, ok := caught["args"].([]ax.Value); ok && len(args) > 0 {
		text, _ = args[0].(string)
	}
	if text == "" {
		// Completion payload shapes vary; fall back to scanning the envelope.
		flat := strings.ToLower(strings.TrimSpace(stringOption(valueFromMap(caught, "result"), "")))
		text = flat
	}
	lower := strings.ToLower(text)
	if lower == "no-throw" || !strings.Contains(lower, "did not execute") {
		t.Fatalf("catch should observe the thrown error text, got %#v", caught)
	}

	// Uncaught, the exception fails the turn, and the turn envelope carries
	// the tool's message for the next actor step to read.
	failed := asMap(session.Execute(`failing_tool({a: 1}); await final("unreachable");`, nil))
	if failed["is_error"] != true {
		t.Fatalf("an uncaught tool error must fail the turn: %#v", failed)
	}
	if message, _ := failed["error"].(string); !strings.Contains(message, "did NOT execute") {
		t.Fatalf("the turn failure must carry the tool's message: %#v", failed)
	}
}
