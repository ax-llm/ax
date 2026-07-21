// ax-example:start
// title: Go Signature Constraints
// group: generation
// description: Builds native constrained fields and runs the signature with OpenAI.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: intermediate
// order: 40
// ax-example:end
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"time"

	ax "github.com/ax-llm/ax/packages/go"
)

func openAIClient() *ax.OpenAICompatibleClient {
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
	return ax.NewOpenAICompatibleClient(map[string]ax.Value{
		"api_key":      apiKey,
		"model":        model,
		"model_config": ax.Object("temperature", 0),
	})
}

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	signature := ax.AxSignature{
		Description: "Extract a constrained restaurant booking",
		Inputs: []ax.Field{
			{
				Name: "requestText", Title: "Request Text", Description: "Booking request",
				Type: ax.FieldType{Name: "string", MinLength: 10, MaxLength: 500},
			},
			{
				Name: "contactEmail", Title: "Contact Email", Description: "Contact email",
				Type: ax.FieldType{Name: "string", Format: "email"},
			},
		},
		Outputs: []ax.Field{
			{
				Name: "partySize", Title: "Party Size", Description: "Guests",
				Type: ax.FieldType{Name: "number", Minimum: 1, Maximum: 12},
			},
			{
				Name: "bookingCode", Title: "Booking Code", Description: "Must look like ABC-1234",
				Type: ax.FieldType{
					Name: "string", Pattern: `^[A-Z]{3}-\d{4}$`,
					PatternDescription: "Three letters, a dash, and four digits",
				},
			},
		},
	}
	program := ax.NewAx("requestText:string -> partySize:number, bookingCode:string", nil)
	program.Signature = signature
	output, err := program.Forward(
		ctx,
		openAIClient(),
		map[string]ax.Value{
			"requestText":  "Book dinner for four people under the name Ada Lovelace.",
			"contactEmail": "ada@example.com",
		},
		nil,
	)
	if err != nil {
		panic(err)
	}
	data, err := json.MarshalIndent(output, "", "  ")
	if err != nil {
		panic(err)
	}
	fmt.Println(string(data))
}
