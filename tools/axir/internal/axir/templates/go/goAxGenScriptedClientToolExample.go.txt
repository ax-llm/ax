package main

import (
	"context"
	"fmt"

	ax "github.com/ax-llm/ax/packages/go"
)

type scriptedClient struct {
	responses []ax.Value
}

func (c *scriptedClient) Chat(context.Context, map[string]ax.Value, map[string]ax.Value) (ax.Value, error) {
	if len(c.responses) == 0 {
		return nil, fmt.Errorf("scripted client exhausted")
	}
	out := c.responses[0]
	c.responses = c.responses[1:]
	return out, nil
}

func (c *scriptedClient) Embed(context.Context, map[string]ax.Value, map[string]ax.Value) (ax.Value, error) {
	return ax.Object("embeddings", ax.Array(ax.Array(1.0, 2.0))), nil
}

func (c *scriptedClient) Stream(context.Context, map[string]ax.Value, map[string]ax.Value) ([]ax.Value, error) {
	return nil, nil
}

func main() {
	searches := 0
	search := ax.Fn("search").WithHandler(func(args map[string]ax.Value) (ax.Value, error) {
		if args["query"] != "ax docs" {
			return nil, fmt.Errorf("unexpected query: %v", args["query"])
		}
		searches++
		return ax.Object("title", "Ax docs"), nil
	})
	qa := ax.NewAx("query:string -> answer:string", nil)
	qa.Functions = []ax.Tool{search}
	qa.AddFieldTransform("answer", "trim")
	client := &scriptedClient{responses: []ax.Value{
		ax.Object("results", ax.Array(ax.Object(
			"content", "",
			"function_calls", ax.Array(ax.Object(
				"id", "call_1",
				"type", "function",
				"function", ax.Object("name", "search", "params", ax.Object("query", "ax docs")),
			)),
		))),
		ax.Object("results", ax.Array(ax.Object(
			"content", "Answer:  Found Ax docs ",
			"function_calls", ax.Array(),
		))),
	}}
	out, err := qa.Forward(context.Background(), client, map[string]ax.Value{"query": "ax docs"}, nil)
	if err != nil {
		panic(err)
	}
	if out.(map[string]ax.Value)["answer"] != "Found Ax docs" {
		panic(fmt.Sprintf("bad output: %v", out))
	}
	// The tool ran once, with the model's arguments.
	if searches != 1 {
		panic(fmt.Sprintf("search ran %d times", searches))
	}
	fmt.Println("go-axgen-ok")
}
