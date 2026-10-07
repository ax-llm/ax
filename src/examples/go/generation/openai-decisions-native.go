// ax-example:start
// title: Go OpenAI Native Decisions
// group: generation
// description: Uses ordered predicate, choice, and score questions with explicit rubrics and raw probabilities.
// provider: openai-decisions
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: advanced
// order: 45
// ax-example:end
package main

import (
	"context"
	"encoding/json"
	"fmt"
	ax "github.com/ax-llm/ax/packages/go"
	"os"
	"time"
)

func main() {
	apiKey := os.Getenv("OPENAI_API_KEY")
	if apiKey == "" {
		apiKey = os.Getenv("OPENAI_APIKEY")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	client := ax.OpenAIDecisions(map[string]ax.Value{"api_key": apiKey})
	var request map[string]ax.Value
	if err := json.Unmarshal([]byte(`{"input": "Checkout is unavailable for all customers after the latest deployment.", "questions": [{"type": "predicate", "name": "urgent", "instructions": "Are customers unable to complete a core task?"}, {"type": "choice", "name": "team", "instructions": "Who should handle the ticket?", "choices": [{"value": "support", "description": "Usage guidance"}, {"value": "billing", "description": "Invoices and payments"}, {"value": "engineering", "description": "Product failures"}]}, {"type": "score", "name": "severity", "instructions": "Rate customer impact", "levels": [{"label": "Minor inconvenience"}, {"label": "One task blocked"}, {"label": "Core task unavailable"}, {"label": "Widespread outage"}]}]}`), &request); err != nil {
		panic(err)
	}
	response, err := client.Create(ctx, request, nil)
	if err != nil {
		panic(err)
	}
	// Handle per-question refusals before using probability, choice, or score.
	output, err := json.MarshalIndent(response, "", "  ")
	if err != nil {
		panic(err)
	}
	fmt.Println(string(output))
}
