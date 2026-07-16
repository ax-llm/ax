// ax-example:start
// title: Go Agent Playbook — Learn And Verify
// group: optimization
// description: Attach a persistent playbook, add validated hidden citations and stage guidance, then mine a task set into playbook rules with a verification gate.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: advanced
// order: 42
// ax-example:end
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"time"

	ax "github.com/ax-llm/ax/packages/go"
	axgoja "github.com/ax-llm/ax/packages/go/runtime/goja"
)

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	apiKey := os.Getenv("OPENAI_API_KEY")
	if apiKey == "" {
		apiKey = os.Getenv("OPENAI_APIKEY")
	}
	if apiKey == "" {
		panic("Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.")
	}
	model := os.Getenv("AX_OPENAI_MODEL")
	if model == "" {
		model = "gpt-5.4-mini"
	}
	client := ax.NewOpenAICompatibleClient(map[string]ax.Value{"api_key": apiKey, "model": model})

	bullet := ax.Object(
		"id", "failures-to-avoid-00001",
		"section", "failures_to_avoid",
		"content", "Check the available evidence before answering.",
		"helpfulCount", 0,
		"harmfulCount", 0,
		"createdAt", "2026-07-15T00:00:00.000Z",
		"updatedAt", "2026-07-15T00:00:00.000Z",
	)
	seed := ax.Object(
		"playbook", ax.Object(
			"version", 1,
			"sections", ax.Object("failures_to_avoid", ax.Array(bullet)),
			"updatedAt", "2026-07-15T00:00:00.000Z",
		),
		"artifact", ax.Object("feedback", ax.Array(), "history", ax.Array()),
	)

	var observedCitations []ax.Value
	var playbookUpdates []ax.Value
	assistant := ax.NewAgent(
		"question:string -> answer:string",
		ax.Object(
			"contextFields", ax.Array(),
			"runtime", ax.Object("language", "JavaScript"),
			"playbook", ax.Object(
				"seed", seed,
				"onUpdate", func(value ax.Value) { playbookUpdates = append(playbookUpdates, value) },
			),
			"citations", ax.Object(
				"surface", "hidden",
				"onCitations", func(value []ax.Value) { observedCitations = value },
			),
		),
	)
	assistant.
		SetInstruction("Answer from evidence and state uncertainty plainly.").
		AddActorInstruction("Before finishing, verify the answer against the collected evidence.")

	runtime := axgoja.NewRuntime()
	answer, err := assistant.Forward(
		ctx,
		client,
		map[string]ax.Value{"question": "What should a support agent verify before answering?"},
		map[string]ax.Value{"runtime": runtime, "max_actor_steps": 8},
	)
	if err != nil {
		panic(err)
	}

	dataset := ax.Object(
		"train", ax.Array(ax.Object(
			"input", ax.Object("question", "Give a concise evidence-first answer."),
			"score", 0,
		)),
	)
	evolution, err := assistant.GetPlaybook().EvolveAgent(
		ctx,
		dataset,
		map[string]ax.Value{"verify": true, "maxProposals": 1, "runtime": runtime},
	)
	if err != nil {
		panic(err)
	}

	encoded, _ := json.MarshalIndent(answer, "", "  ")
	fmt.Println(string(encoded))
	fmt.Println("citations:", observedCitations)
	fmt.Println("run-end updates:", len(playbookUpdates))
	fmt.Println("outcomes:", evolution.(map[string]ax.Value)["outcomes"])
	fmt.Println(assistant.GetPlaybook().Render())
}
