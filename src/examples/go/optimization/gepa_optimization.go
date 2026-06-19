// ax-example:start
// title: Go GEPA Optimization
// group: optimization
// description: Pairs a real OpenAI baseline with a local GEPA optimization pass.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: intermediate
// order: 20
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

type localEvaluator struct{}
func (localEvaluator) Evaluate(candidateMap map[string]ax.Value, options map[string]ax.Value) (ax.Value, error) { return ax.Object("rows", ax.Array(ax.Object("prediction", ax.Object("answer", "Ax composes typed LLM programs."), "scores", ax.Object("quality", 0.9), "scalar", 0.9)), "avg", 0.9, "count", 1), nil }

func openAIClient() *ax.OpenAICompatibleClient {
	apiKey := os.Getenv("OPENAI_API_KEY")
	if apiKey == "" { apiKey = os.Getenv("OPENAI_APIKEY") }
	if apiKey == "" { panic("Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.") }
	model := os.Getenv("AX_OPENAI_MODEL")
	if model == "" { model = "gpt-4.1-mini" }
	return ax.NewOpenAICompatibleClient(map[string]ax.Value{"api_key": apiKey, "model": model, "model_config": ax.Object("temperature", 0)})
}

func printJSON(value ax.Value) {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil { panic(err) }
	fmt.Println(string(data))
}

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	client := openAIClient()
	program := ax.NewAx("emailText:string -> priority:class \"high, normal, low\", rationale:string", map[string]ax.Value{"id": "priority", "instruction": "Classify the email priority."})
	baseline, err := program.Forward(ctx, client, map[string]ax.Value{"emailText": "Production checkout is failing for enterprise customers."}, nil)
	if err != nil { panic(err) }
	request := map[string]ax.Value{"programKind": "axgen", "components": ax.Array(ax.Object("id", "priority::instruction", "owner", "priority", "kind", "instruction", "current", "Classify priority clearly.")), "dataset": ax.Object("train", ax.Array(ax.Object("emailText", "URGENT: checkout is down"))), "options": ax.Object("numTrials", 0, "maxMetricCalls", 4, "seed", 7)}
	artifact, err := ax.NewGEPA(nil, map[string]ax.Value{"seed": 7}).Optimize(request, localEvaluator{})
	if err != nil { panic(err) }
	printJSON(ax.Object("baseline", baseline, "artifact", artifact))
}
