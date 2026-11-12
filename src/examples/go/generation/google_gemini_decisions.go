// ax-example:start
// title: Go Google Gemini Decision Evidence
// group: generation
// description: Classify a support ticket through signatures with native decision evidence.
// provider: google-gemini-decisions
// env: GEMINI_API_KEY, GOOGLE_API_KEY, GOOGLE_APIKEY
// level: intermediate
// order: 47
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
	key := os.Getenv("GEMINI_API_KEY")
	if key == "" {
		key = os.Getenv("GOOGLE_API_KEY")
	}
	if key == "" {
		key = os.Getenv("GOOGLE_APIKEY")
	}
	if key == "" {
		panic("Set a Google API key.")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	model := ax.NewAI("google-gemini-decisions", map[string]ax.Value{"api_key": key})
	triage := ax.NewAx(`ticket:string -> urgent:boolean(evidence, threshold 0.9) "Does a core task fail for all customers?", team:class "support, billing, engineering"(evidence) "Which team should investigate?", severity:score "Minor inconvenience, Feature impaired, Core task blocked"(evidence) "How severe is the customer impact?"`, nil)
	result, err := triage.Forward(ctx, model, map[string]ax.Value{"ticket": "Checkout is unavailable for all customers after the latest deployment."}, nil)
	if err != nil {
		panic(err)
	}
	output, err := json.MarshalIndent(result, "", "  ")
	if err != nil {
		panic(err)
	}
	fmt.Println(string(output))
}
