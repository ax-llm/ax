package goja

import (
	"strings"
	"testing"

	ax "github.com/ax-llm/ax/packages/go"
)

func newTestSession(t *testing.T) *Session {
	t.Helper()
	runtime := NewRuntime()
	runtime.RegisterHostCallable("query_catalog", func(params ax.Value) (ax.Value, error) {
		return map[string]ax.Value{"cards": []ax.Value{map[string]ax.Value{"id": "table:app:main.accounts"}}}, nil
	})
	session, err := runtime.CreateSession(map[string]ax.Value{}, map[string]ax.Value{})
	if err != nil {
		t.Fatal(err)
	}
	return session.(*Session)
}

func payloadMap(t *testing.T, v ax.Value) map[string]ax.Value {
	t.Helper()
	m, ok := v.(map[string]ax.Value)
	if !ok {
		t.Fatalf("payload is %T, want map: %v", v, v)
	}
	return m
}

func logsOf(t *testing.T, payload map[string]ax.Value) []string {
	t.Helper()
	raw, ok := payload["logs"]
	if !ok {
		return nil
	}
	list, ok := raw.([]ax.Value)
	if !ok {
		t.Fatalf("logs is %T, want list: %v", raw, raw)
	}
	out := make([]string, 0, len(list))
	for _, entry := range list {
		out = append(out, entry.(string))
	}
	return out
}

// The observation loop of the REPL contract: an intermediate step's console
// output must come back on the result as `logs`. Measured on 339 recorded
// episodes before this fix, 34 intermediate steps called console.log and every
// one received empty output, after which the model re-fetched data it already
// held.
func TestExecuteSurfacesConsoleLogsOnIntermediateStep(t *testing.T) {
	session := newTestSession(t)
	result := session.Execute(`const detail = await query_catalog({id: "table:app:main.accounts"});
console.log("cards:", detail.cards.length);`, nil)
	payload := payloadMap(t, result)
	logs := logsOf(t, payload)
	if len(logs) != 1 || !strings.Contains(logs[0], "cards:") || !strings.Contains(logs[0], "1") {
		t.Fatalf("intermediate step logs = %v, want the printed card count", logs)
	}
}

// Completion payloads carry the turn's logs too, mirroring the Python runtime.
func TestExecuteSurfacesConsoleLogsOnCompletion(t *testing.T) {
	session := newTestSession(t)
	result := session.Execute(`console.log("about to finalize");
await final("done", {ok: true});`, nil)
	payload := payloadMap(t, result)
	if logs := logsOf(t, payload); len(logs) != 1 || logs[0] != "about to finalize" {
		t.Fatalf("completion logs = %v", logs)
	}
}

// Logs are per turn: a second Execute must not replay the first turn's output.
func TestExecuteResetsLogsBetweenTurns(t *testing.T) {
	session := newTestSession(t)
	first := payloadMap(t, session.Execute(`console.log("turn one");`, nil))
	if logs := logsOf(t, first); len(logs) != 1 || logs[0] != "turn one" {
		t.Fatalf("first turn logs = %v", logs)
	}
	second := payloadMap(t, session.Execute(`const x = 1;`, nil))
	if logs := logsOf(t, second); logs != nil {
		t.Fatalf("silent second turn leaked logs = %v", logs)
	}
	third := payloadMap(t, session.Execute(`console.log("turn three");`, nil))
	if logs := logsOf(t, third); len(logs) != 1 || logs[0] != "turn three" {
		t.Fatalf("third turn logs = %v", logs)
	}
}

// A failed turn reports its error alone, matching the Python and C++ runtimes.
func TestExecuteErrorCarriesNoLogs(t *testing.T) {
	session := newTestSession(t)
	result := session.Execute(`console.log("before the throw");
throw new Error("boom");`, nil)
	payload := payloadMap(t, result)
	if payload["is_error"] != true {
		t.Fatalf("expected an error payload: %v", payload)
	}
	if _, ok := payload["logs"]; ok {
		t.Fatalf("error payload must not carry logs: %v", payload)
	}
}

// Every sibling runtime's console shim defines warn/info/debug; an undefined
// method here turned a model's console.info into a TypeError that failed the
// whole turn.
func TestConsoleVariantsDoNotThrow(t *testing.T) {
	session := newTestSession(t)
	result := session.Execute(`console.warn("w"); console.info("i"); console.debug("d"); console.error("e");`, nil)
	payload := payloadMap(t, result)
	if payload["is_error"] == true {
		t.Fatalf("console variants threw: %v", payload)
	}
	logs := logsOf(t, payload)
	if len(logs) != 4 {
		t.Fatalf("console variants logs = %v, want all four captured", logs)
	}
}

// A single line over the diagnostics budget used to delete itself: the budget
// loop dropped entries until the total fit, and with one oversized entry that
// left nothing. To the actor that is indistinguishable from console.log doing
// nothing. Measured downstream: logging a 25KB discovery seed against the 16KB
// default produced no output at all, in 14 of 17 remaining blind steps.
func TestOversizedLogIsTruncatedNotDropped(t *testing.T) {
	session := newTestSession(t)
	result := session.Execute(`const big = "x".repeat(40000); console.log(big);`, nil)
	payload := payloadMap(t, result)
	logs := logsOf(t, payload)
	if len(logs) != 1 {
		t.Fatalf("oversized log produced %d entries, want it kept and trimmed: %v", len(logs), logs)
	}
	if !strings.Contains(logs[0], "truncated") || !strings.Contains(logs[0], "40000") {
		t.Fatalf("truncated line must say what happened: %q", logs[0][max(0, len(logs[0])-160):])
	}
	if len(logs[0]) > 16384 {
		t.Fatalf("truncated line is %d bytes, over the 16384 budget", len(logs[0]))
	}
	if !strings.HasPrefix(logs[0], "xxxx") {
		t.Fatalf("truncation must keep the head of the value: %q", logs[0][:40])
	}
}

// Many small lines still evict oldest-first, and the newest always survives.
func TestDiagnosticBudgetEvictsOldestAndKeepsNewest(t *testing.T) {
	session := newTestSession(t)
	result := session.Execute(`for (let i = 0; i < 40; i++) { console.log("line" + i + ":" + "y".repeat(1000)); }`, nil)
	payload := payloadMap(t, result)
	logs := logsOf(t, payload)
	if len(logs) == 0 {
		t.Fatal("budget eviction removed every line")
	}
	if !strings.HasPrefix(logs[len(logs)-1], "line39:") {
		t.Fatalf("newest line was evicted; last entry starts %q", logs[len(logs)-1][:12])
	}
	if total := len(strings.Join(logs, "\n")); total > 16384 {
		t.Fatalf("retained logs are %d bytes, over budget", total)
	}
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}
