package main

import (
	"context"
	"fmt"

	ax "github.com/ax-llm/ax/packages/go"
)

type scriptedFlowClient struct{}

func (scriptedFlowClient) Chat(context.Context, map[string]ax.Value, map[string]ax.Value) (ax.Value, error) {
	return ax.Object("results", ax.Array(ax.Object(
		"content", "{\"answer\":\"Paris\"}",
		"function_calls", ax.Array(),
	))), nil
}

func (scriptedFlowClient) Embed(context.Context, map[string]ax.Value, map[string]ax.Value) (ax.Value, error) {
	return ax.Object("embeddings", ax.Array()), nil
}

func (scriptedFlowClient) Stream(context.Context, map[string]ax.Value, map[string]ax.Value) ([]ax.Value, error) {
	return nil, nil
}

func main() {
	qa := ax.NewAx("question:string -> answer:string", nil)
	program := ax.NewFlow(map[string]ax.Value{"id": "example.flow"}).
		Execute("qa", qa, nil).
		Returns(map[string]ax.Value{"answer": "answer"})
	out, err := program.Forward(context.Background(), scriptedFlowClient{}, map[string]ax.Value{"question": "Capital of France?"}, nil)
	if err != nil {
		panic(err)
	}
	if out.(map[string]ax.Value)["answer"] != "Paris" {
		panic(fmt.Sprintf("bad output: %v", out))
	}
	fmt.Println("go-axflow-ok")
}
