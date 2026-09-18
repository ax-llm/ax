// ax-example:start
// title: Go Jev Native Questions
// group: generation
// description: Uses structured criteria, native scoring, model discovery, and probability-based decisions.
// provider: typesafe
// env: TYPESAFE_APIKEY
// level: advanced
// order: 36
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
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	client := ax.Typesafe(map[string]ax.Value{"api_key": os.Getenv("TYPESAFE_APIKEY")})
	models, err := client.ListModels(ctx, nil)
	if err != nil {
		panic(err)
	}
	if len(models) == 0 {
		panic("Empty model catalog")
	}
	request := ax.TypesafeRequest{
		State: map[string]ax.Value{
			"ticket":  "Checkout is unavailable for all customers after the latest deployment.",
			"account": map[string]ax.Value{"tier": "enterprise", "notes": nil},
		},
		Questions: map[string]ax.TypesafeQuestion{
			"urgent": {Type: "noul",
				Instructions: map[string]ax.Value{"question": "Does this need immediate attention?"},
				Criteria:     map[string]ax.Value{"true": "Customers cannot complete a core task", "false": "Routine request"}},
			"team": {Type: "choice", Instructions: "Who should handle the ticket?",
				Criteria: map[string]ax.Value{"support": "Usage guidance",
					"billing": map[string]ax.Value{"scope": "Invoices and payments"}, "engineering": "Product failures"}},
			"severity": {Type: "score", Instructions: "Rate customer impact",
				Criteria: []ax.Value{"Minor inconvenience", "One task blocked", "Core task unavailable", "Widespread outage"}},
		},
	}
	response, err := client.SystemOne(ctx, request, nil)
	if err != nil {
		panic(err)
	}
	probability := response.Answers["urgent"].Noul
	score := response.Answers["severity"].Score
	if probability < 0 || probability > 1 || score < 0 || score > 3 {
		panic("Invalid answer bounds")
	}
	// Apply thresholds and custom score scales in application code.
	output := map[string]any{"page_on_call": probability >= 0.9, "severity_1_to_5": 1 + 4*score/3, "response": response}
	data, err := json.MarshalIndent(output, "", "  ")
	if err != nil {
		panic(err)
	}
	fmt.Println(string(data))
}
