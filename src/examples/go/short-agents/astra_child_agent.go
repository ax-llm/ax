// ax-example:start
// title: Go Child Agent Controls
// group: short-agents
// description: Delegates through a real actor runtime and applies controls to the child scope.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: advanced
// order: 13
// ax-example:end
package main

import (
	"context"
	"encoding/json"
	"fmt"
	ax "github.com/ax-llm/ax/packages/go"
	axgoja "github.com/ax-llm/ax/packages/go/runtime/goja"
	"os"
	"strings"
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
	control := ax.RunControl()
	applied := false
	control.OnEvent(func(event map[string]ax.Value) {
		if event["type"] == "applied" && event["path"] == "root/team.researcher/executor" {
			applied = true
		}
	})
	if err := control.Steer("Include VERIFIED in the final answer."); err != nil {
		panic(err)
	}
	if err := control.Steer("Include CHILD-CHECK in the final answer.", "root/team.researcher"); err != nil {
		panic(err)
	}
	if err := control.SetThinkingTokenBudget("medium", "root/team.researcher/executor"); err != nil {
		panic(err)
	}
	runtime := func() *axgoja.Runtime {
		return axgoja.NewRuntime(axgoja.WithRuntimePolicy(ax.Object("timeoutMs", 180000)))
	}
	child := ax.NewAgent("question -> answer", ax.Object("directResponse", "off", "runtime", runtime()))
	parent := ax.NewAgent("question -> answer", ax.Object("directResponse", "off", "runtime", runtime())).AddChildAgent("team", "researcher", child)
	ctx, cancel := context.WithTimeout(context.Background(), 180*time.Second)
	defer cancel()
	result, err := parent.Forward(ctx, client, ax.Object("question", "Delegate to team.researcher exactly once by calling await team.researcher({question: \"Compute 37 + 5 and return the exact sum.\"}) in actor code. Pass the complete child answer as evidence to final(...), then report it in your final answer."), ax.Object("control", control, "serviceTier", "standard", "max_actor_steps", 8))
	if err != nil {
		panic(err)
	}
	for _, word := range []string{"42", "VERIFIED", "CHILD-CHECK"} {
		if !strings.Contains(fmt.Sprint(result), word) {
			panic(fmt.Sprint(result))
		}
	}
	if !applied {
		panic("Child control did not apply")
	}
	fmt.Println(result)
	usage, err := json.Marshal(parent.GetUsage())
	if err != nil {
		panic(err)
	}
	fmt.Println(string(usage))
}
