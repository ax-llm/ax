// ax-example:start
// title: Go Controlled Background Flow
// group: flows
// description: Uses ordinary generation with background tools, steering, and a reasoning update.
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
	var queued sync.Once
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
	var pendingOnce sync.Once
	slow := ax.Fn("slow_reference").Execution("background").WithContextHandler(func(ctx context.Context, _ map[string]ax.Value) (ax.Value, error) {
		pendingOnce.Do(func(){close(pending)})
		select {
		case <-time.After(6 * time.Second):
			finished.Store(true)
			return "REF-42", nil
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	})
	label := ax.Fn("local_label").WithHandler(func(_ map[string]ax.Value) (ax.Value, error) {
		select {
		case <-pending:
			if !finished.Load() {
				overlap.Store(true)
			}
		case <-time.After(3 * time.Second):
		}
		return "LAUNCH", nil
	})
	program := ax.NewAx("question -> answer", nil)
	program.Functions = []ax.Tool{slow, label}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	workflow:=ax.NewFlow(nil).Execute("lookup",program,ax.Object("writes",ax.Array("answer"))).Execute("verify",ax.NewAx(`answer -> report "Repeat the exact reference, label, and verification word from the answer."`,nil),ax.Object("reads",ax.Array("answer"))).Returns(ax.Object("answer","report"))
    result, err := workflow.Forward(ctx, client, ax.Object("question", "First call slow_reference. While it is pending, call local_label. Call each tool only once; do not call a tool again while its result is pending. If a required tool result is still pending, end this response with a brief progress message. The application will continue with the result when it arrives; do not spend reasoning tokens waiting for it. Once both results arrive, return them in one sentence."), ax.Object("control", control, "serviceTier", "standard", "maxSteps", 6))
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
	if applied.Load() != 4 {
		panic("Control updates were not applied")
	}
	fmt.Println(answer)
	fmt.Println("Background overlap verified; steering and reasoning applied at the next response.")
}
