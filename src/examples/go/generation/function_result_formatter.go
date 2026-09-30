// ax-example:start
// title: Go Tool Result Formatting
// group: generation
// description: Formats a structured inventory tool result as concise text for the model.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: intermediate
// order: 48
// ax-example:end
package main

import (
	"context"
	"fmt"
	ax "github.com/ax-llm/ax/packages/go"
	"os"
)

func main() {
	key := os.Getenv("OPENAI_API_KEY")
	if key == "" {
		key = os.Getenv("OPENAI_APIKEY")
	}
	if key == "" {
		panic("Set OPENAI_API_KEY or OPENAI_APIKEY.")
	}
	model := os.Getenv("AX_OPENAI_MODEL")
	if model == "" {
		model = "gpt-6-luna"
	}
	client := ax.NewAI("openai", ax.Object("api_key", key, "model", model))
	inventory := ax.Fn("inventory").WithHandler(func(_ map[string]ax.Value) (ax.Value, error) {
		return ax.Object("available", 12, "warehouse", "A"), nil
	})
	inventory.Description = "Read the current stock count."
	program := ax.NewAx("question:string -> answer:string", nil)
	program.Functions = []ax.Tool{inventory}
	// The model receives this text; tool traces retain the original object.
	program.SetFunctionResultFormatter(func(result ax.Value) (string, error) {
		return fmt.Sprintf("%v units available", result.(map[string]ax.Value)["available"]), nil
	})
	result, err := program.Forward(context.Background(), client, ax.Object("question", "Call inventory and report how many units are available."), nil)
	if err != nil {
		panic(err)
	}
	fmt.Println(result["answer"])
}
