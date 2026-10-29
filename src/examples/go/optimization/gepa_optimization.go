// ax-example:start
// title: Go GEPA Optimization
// group: optimization
// description: Scores real OpenAI predictions before and after GEPA instruction search.
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

type priorityEvaluator struct {
	program *ax.AxGen
	client  ax.AIClient
}

func (e priorityEvaluator) Evaluate(candidateMap map[string]ax.Value, options map[string]ax.Value) (ax.Value, error) {
	result := e.program.EvaluateOptimization(e.client, options["dataset"], candidateMap, options).(map[string]ax.Value)
	rows := result["rows"].(*ax.AxArray).Items
	sum := 0.0
	for _, item := range rows {
		row := item.(map[string]ax.Value)
		expected := row["input"].(map[string]ax.Value)["expectedOutput"].(map[string]ax.Value)
		output, _ := row["prediction"].(map[string]ax.Value)["output"].(map[string]ax.Value)
		score := 0.0
		if output["priority"] == expected["priority"] {
			score = 1
		}
		row["scores"], row["scalar"] = ax.Object("accuracy", score), score
		sum += score
	}
	result["avg"] = sum / float64(len(rows))
	return result, nil
}
func task(text, priority string) ax.Value {
	return ax.Object("input", ax.Object("emailText", text), "expectedOutput", ax.Object("priority", priority))
}

func openAIClient() ax.AIClient {
	apiKey := os.Getenv("OPENAI_API_KEY")
	if apiKey == "" {
		apiKey = os.Getenv("OPENAI_APIKEY")
	}
	if apiKey == "" {
		panic("Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.")
	}
	model := os.Getenv("AX_OPENAI_MODEL")
	if model == "" {
		model = "gpt-6-luna"
	}
	return ax.NewAI("openai", map[string]ax.Value{"api_key": apiKey, "model": model})
}

func printJSON(value ax.Value) {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		panic(err)
	}
	fmt.Println(string(data))
}

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	client := openAIClient()
	program := ax.NewAx("emailText:string -> priority:class \"high, normal, low\", rationale:string", map[string]ax.Value{"id": "priority", "instruction": "Classify the email priority."})
	baseline, err := program.Forward(ctx, client, map[string]ax.Value{"emailText": "Production checkout is failing for enterprise customers."}, nil)
	if err != nil {
		panic(err)
	}
	request := map[string]ax.Value{
		"programKind": "axgen", "components": program.GetOptimizableComponents(),
		"dataset": ax.Object("train", ax.Array(task("URGENT: checkout is down", "high"), task("Weekly product newsletter", "low")),
			"validation", ax.Array(task("Production payments are failing", "high"), task("Optional community meetup invite", "low"))),
		"options": ax.Object("numTrials", 1, "minibatchSize", 2, "maxMetricCalls", 12, "bootstrap", false, "seed", 7),
	}
	artifact, err := ax.NewGEPA(client, map[string]ax.Value{"seed": 7}).Optimize(request, priorityEvaluator{program, client})
	if err != nil {
		panic(err)
	}
	result := artifact.(map[string]ax.Value)
	original := result["baselineScore"].(float64)
	best := result["metadata"].(map[string]ax.Value)["bestScore"].(float64)
	printJSON(ax.Object("baselinePrediction", baseline, "baselineScore", original, "baselineScores", result["baselineScores"], "optimizedScore", best, "delta", best-original))
}
