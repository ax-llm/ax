// ax-example:start
// title: Go Native Google Gemini Decisions
// group: generation
// description: Evaluate named yes/no, choice and score questions with native probabilities and confidence.
// provider: google-gemini-decisions
// env: GEMINI_API_KEY, GOOGLE_API_KEY, GOOGLE_APIKEY
// level: intermediate
// order: 48
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
	client := ax.GoogleGeminiDecisions(map[string]ax.Value{"api_key": key})
	var request map[string]ax.Value
	if err := json.Unmarshal([]byte(`{"input": "Checkout is unavailable for all customers after the latest deployment.", "questions": {"urgent": {"type": "noul", "instructions": "Are customers unable to complete a core task?"}, "team": {"type": "choice", "instructions": "Which team should investigate?", "criteria": {"support": "Usage guidance", "billing": "Individual invoice disputes", "engineering": "Broken functionality or service outages"}}, "severity": {"type": "score", "instructions": "How severe is the customer impact?", "criteria": ["Minor inconvenience", "Feature impaired", "Core task blocked"]}}}`), &request); err != nil {
		panic(err)
	}
	result, err := client.Create(ctx, request, nil)
	if err != nil {
		panic(err)
	}
	output, err := json.MarshalIndent(result, "", "  ")
	if err != nil {
		panic(err)
	}
	fmt.Println(string(output))
}
