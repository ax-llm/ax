package main

import (
	"context"
	"fmt"

	ax "github.com/ax-llm/ax/go"
)

type scriptedAgentClient struct {
	responses []ax.Value
}

func (c *scriptedAgentClient) Chat(context.Context, map[string]ax.Value, map[string]ax.Value) (ax.Value, error) {
	if len(c.responses) == 0 {
		return nil, fmt.Errorf("scripted service exhausted")
	}
	out := c.responses[0]
	c.responses = c.responses[1:]
	return out, nil
}

func (c *scriptedAgentClient) Embed(context.Context, map[string]ax.Value, map[string]ax.Value) (ax.Value, error) {
	return ax.Object("embeddings", ax.Array()), nil
}

func (c *scriptedAgentClient) Stream(context.Context, map[string]ax.Value, map[string]ax.Value) ([]ax.Value, error) {
	return nil, nil
}

func main() {
	client := &scriptedAgentClient{responses: []ax.Value{
		response("{\"completion\":{\"type\":\"final\",\"args\":[\"Answer\",{}]}}"),
		response("{\"completion\":{\"type\":\"final\",\"args\":[\"Answer\",{\"answer\":\"Paris\"}]}}"),
		response("{\"answer\":\"Paris\"}"),
	}}
	qa := ax.NewAgent("question:string -> answer:string", map[string]ax.Value{"contextFields": ax.Array()})
	out, err := qa.Forward(context.Background(), client, map[string]ax.Value{"question": "Capital of France?"}, nil)
	if err != nil {
		panic(err)
	}
	if out.(map[string]ax.Value)["answer"] != "Paris" {
		panic(fmt.Sprintf("bad output: %v", out))
	}
	fmt.Println("go-axagent-ok")
}

func response(content string) ax.Value {
	return ax.Object("results", ax.Array(ax.Object("content", content, "function_calls", ax.Array())))
}
