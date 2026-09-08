// ax-example:start
// title: Go Agent Background Tools
// group: short-agents
// description: Runs declared background agent tools with steering and verifies final result incorporation.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: advanced
// order: 12
// ax-example:end
package main

import (
	"context"
	"fmt"
	ax "github.com/ax-llm/ax/packages/go"
	axgoja "github.com/ax-llm/ax/packages/go/runtime/goja"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

func main() {
	key := os.Getenv("OPENAI_API_KEY")
	if key == "" {
		key = os.Getenv("OPENAI_APIKEY")
	}
	if key == "" {
		panic("Set OPENAI_API_KEY or OPENAI_APIKEY.")
	}
	client := ax.NewAI("openai", ax.Object("api_key", key, "model", "gpt-6-astra", "model_config", ax.Object("thinkingTokenBudget", "low", "max_tokens", 4096)))
	pending := make(chan struct{})
	var finished, overlap atomic.Bool
	var queued, pendingOnce sync.Once
	var applied atomic.Int32
	control := ax.RunControl()
	control.OnEvent(func(event map[string]ax.Value) {
		if event["type"] == "tool.started" {
			queued.Do(func() {
				if err := control.Steer("Include the word VERIFIED in the final answer."); err != nil {
					panic(err)
				}
				if err := control.SetThinkingTokenBudget("medium"); err != nil {
					panic(err)
				}
			})
		}
		if event["type"] == "applied" {
			applied.Add(1)
		}
	})
	slow := ax.Fn("slow_reference").Execution("background").WithContextHandler(func(ctx context.Context, _ map[string]ax.Value) (ax.Value, error) {
		pendingOnce.Do(func() { close(pending) })
		select {
		case <-time.After(6 * time.Second):
			finished.Store(true)
			return "REF-42", nil
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	})
	label := ax.Fn("local_label").Execution("background").WithHandler(func(_ map[string]ax.Value) (ax.Value, error) {
		select {
		case <-pending:
			if !finished.Load() {
				overlap.Store(true)
			}
		case <-time.After(3 * time.Second):
		}
		return "LAUNCH", nil
	})
	program := ax.NewAgent("question -> answer", ax.Object("runtime", ax.Object("language", "JavaScript"), "directResponse", "off", "functions", ax.Array(slow, label)))
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	result, err := program.Forward(ctx, client, ax.Object("question", "Use the native tools tools_slow_reference and tools_local_label. First call tools_slow_reference. While it is pending, call tools_local_label. Call each tool only once; do not call a tool again while its result is pending. In the executor, call the native tools directly rather than invoking them from actor code; then use final(...) in the code runtime to pass their results to the responder. Return both exact results in one sentence."), ax.Object("runtime", axgoja.NewRuntime(), "max_actor_steps", 12, "control", control, "serviceTier", "standard", "maxSteps", 6))
	if err != nil {
		panic(err)
	}
	answer := fmt.Sprint(result)
	for _, word := range []string{"REF-42", "LAUNCH", "VERIFIED"} {
		if !strings.Contains(answer, word) {
			panic("Missing final result: " + answer)
		}
	}
	if !overlap.Load() {
		panic("No independent model work while background tool was pending")
	}
	if applied.Load() < 2 {
		panic("Control updates were not applied")
	}
	fmt.Println(answer)
	fmt.Println("Background overlap verified; steering and reasoning applied at the next response.")
}
