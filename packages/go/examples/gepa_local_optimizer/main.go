package main

import (
	"encoding/json"
	"fmt"
	"strings"

	ax "github.com/ax-llm/ax/packages/go"
)

type localEvaluator struct{}

func (localEvaluator) Evaluate(candidateMap map[string]ax.Value, options map[string]ax.Value) (ax.Value, error) {
	instruction, _ := candidateMap["qa::instruction"].(string)
	examples := values(options["dataset"].(map[string]ax.Value)["train"])
	rows := []ax.Value{}
	total := 0.0
	for _, example := range examples {
		quality := 0.65
		if strings.Contains(strings.ToLower(instruction), "concise") {
			quality = 0.9
		}
		brevity := 0.8
		scalar := (quality + brevity) / 2.0
		total += scalar
		rows = append(rows, ax.Object(
			"input", example,
			"prediction", ax.Object("answer", "Ax composes typed LLM programs."),
			"scores", ax.Object("quality", quality, "brevity", brevity),
			"scalar", scalar,
		))
	}
	return ax.Object("rows", rows, "avg", total/float64(len(rows)), "sum", total, "count", len(rows)), nil
}

func main() {
	request := map[string]ax.Value{
		"programKind": "axgen",
		"components": ax.Array(ax.Object(
			"id", "qa::instruction",
			"owner", "qa",
			"kind", "instruction",
			"current", "Answer clearly and concisely.",
		)),
		"dataset": ax.Object(
			"train", ax.Array(
				ax.Object("question", "What is Ax?"),
				ax.Object("question", "Why use typed signatures?"),
			),
			"validation", ax.Array(ax.Object("question", "Summarize Ax.")),
		),
		"options": ax.Object("numTrials", 0, "maxMetricCalls", 8, "seed", 7),
	}
	artifact, err := ax.NewGEPA(nil, map[string]ax.Value{"seed": 7}).Optimize(request, localEvaluator{})
	if err != nil {
		panic(err)
	}
	out := ax.Object(
		"componentMap", artifact.(map[string]ax.Value)["componentMap"],
		"metadata", artifact.(map[string]ax.Value)["metadata"],
	)
	data, err := json.MarshalIndent(out, "", "  ")
	if err != nil {
		panic(err)
	}
	fmt.Println(string(data))
}

func values(value ax.Value) []ax.Value {
	switch v := value.(type) {
	case []ax.Value:
		return v
	case *ax.AxArray:
		return v.Items
	default:
		return nil
	}
}
