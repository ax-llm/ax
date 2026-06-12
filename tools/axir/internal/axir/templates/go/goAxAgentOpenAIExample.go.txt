package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"time"

	ax "github.com/ax-llm/ax/go"
)

type providerAgentClient struct {
	inner          *ax.OpenAICompatibleClient
	rawModelAnswer string
	calls          int
}

func (c *providerAgentClient) Chat(ctx context.Context, request map[string]ax.Value, options map[string]ax.Value) (ax.Value, error) {
	c.calls++
	if c.rawModelAnswer == "" {
		response, err := c.inner.Chat(ctx, map[string]ax.Value{
			"chat_prompt": ax.Array(ax.Object(
				"role", "user",
				"content", "In one sentence, explain what Ax helps developers build.",
			)),
		}, nil)
		if err != nil {
			return nil, err
		}
		first := resultsOf(response)[0].(map[string]ax.Value)
		c.rawModelAnswer, _ = first["content"].(string)
	}
	payload := ax.Object("answer", c.rawModelAnswer)
	if c.calls == 1 {
		payload = ax.Object("completion", ax.Object("type", "final", "args", ax.Array("Answer", ax.Object())))
	} else if c.calls == 2 {
		payload = ax.Object("completion", ax.Object("type", "final", "args", ax.Array("Answer", ax.Object("answer", c.rawModelAnswer))))
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	return ax.Object("results", ax.Array(ax.Object("content", string(data), "function_calls", ax.Array()))), nil
}

func (c *providerAgentClient) Embed(context.Context, map[string]ax.Value, map[string]ax.Value) (ax.Value, error) {
	return ax.Object("embeddings", ax.Array()), nil
}

func (c *providerAgentClient) Stream(context.Context, map[string]ax.Value, map[string]ax.Value) ([]ax.Value, error) {
	return nil, nil
}

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
	agentClient := &providerAgentClient{inner: client}
	assistant := ax.NewAgent("question:string -> answer:string", map[string]ax.Value{"contextFields": ax.Array()})
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	output, err := assistant.Forward(ctx, agentClient, map[string]ax.Value{
		"question": "In one sentence, explain what Ax helps developers build.",
	}, nil)
	if err != nil {
		panic(err)
	}
	data, err := json.MarshalIndent(ax.Object("agentOutput", output, "rawModelAnswer", agentClient.rawModelAnswer), "", "  ")
	if err != nil {
		panic(err)
	}
	fmt.Println(string(data))
}

func resultsOf(value ax.Value) []ax.Value {
	raw := value.(map[string]ax.Value)["results"]
	switch values := raw.(type) {
	case []ax.Value:
		return values
	case *ax.AxArray:
		return values.Items
	default:
		panic(fmt.Sprintf("unexpected results type %T", raw))
	}
}
