package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"time"

	ax "github.com/ax-llm/ax/go"
)

func main() {
	apiKey := os.Getenv("OPENAI_API_KEY")
	if apiKey == "" {
		apiKey = os.Getenv("OPENAI_APIKEY")
	}
	if apiKey == "" {
		fmt.Fprintln(os.Stderr, "Set OPENAI_API_KEY or OPENAI_APIKEY to run this provider API example.")
		os.Exit(2)
	}
	model := os.Getenv("AX_OPENAI_MODEL")
	if model == "" {
		model = "gpt-4.1-mini"
	}
	client := ax.NewOpenAICompatibleClient(map[string]ax.Value{
		"api_key":      apiKey,
		"model":        model,
		"model_config": ax.Object("temperature", 0),
	})
	outline := ax.NewAx("topic:string -> outline:string", nil)
	program := ax.NewFlow(map[string]ax.Value{"id": "examples.openaiApiFlow"}).
		Execute("outline", outline, nil).
		Returns(map[string]ax.Value{"outline": "outline"})
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	output, err := program.Forward(ctx, client, map[string]ax.Value{"topic": "how Ax composes typed LLM programs"}, nil)
	if err != nil {
		panic(err)
	}
	data, err := json.MarshalIndent(output, "", "  ")
	if err != nil {
		panic(err)
	}
	fmt.Println(string(data))
}
