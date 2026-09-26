// ax-example:start
// title: Go Field Processor Feedback
// group: generation
// description: Sends a field processor's note back to the model for another step, as TypeScript does, and trims the final answer with a field transform.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: intermediate
// order: 47
// ax-example:end
package main

import (
	"context"
	"fmt"
	"os"
	"strings"

	ax "github.com/ax-llm/ax/packages/go"
)

func main() {
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
	client := ax.NewAI("openai", map[string]ax.Value{"api_key": apiKey, "model": model})
	summarize := ax.NewAx("text:string -> summary:string", nil)

	// A non-nil result goes back to the model as a user message, and the next
	// step's answer replaces this one.
	summarize.AddFieldProcessor("summary", func(value ax.Value, _ ax.AxFieldProcessorContext) (ax.Value, error) {
		summary, _ := value.(string)
		if words := len(strings.Fields(summary)); words > 12 {
			return fmt.Sprintf("That summary has %d words; answer again in at most 12 words.", words), nil
		}
		return nil, nil
	})
	summarize.AddFieldTransform("summary", "trim")

	text := "The committee met on Tuesday to review the budget. After a long debate about " +
		"the new library wing, they approved the plan and asked staff to find a builder " +
		"who can start in spring, while keeping the reading room open during the work."
	output, err := summarize.Forward(context.Background(), client, map[string]ax.Value{"text": text}, nil)
	if err != nil {
		panic(err)
	}
	fmt.Println(output.(map[string]ax.Value)["summary"])
}
