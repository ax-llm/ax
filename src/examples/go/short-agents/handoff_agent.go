// ax-example:start
// title: Go Specialist Agent
// group: short-agents
// description: Uses a focused specialist-style agent contract for a multi-part answer.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: advanced
// order: 30
// ax-example:end
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"time"

	ax "github.com/ax-llm/ax/go"
)

type openAIBackedAgentClient struct {
	inner *ax.OpenAICompatibleClient
	rawModelAnswer string
	calls int
}

func (c *openAIBackedAgentClient) Chat(ctx context.Context, request map[string]ax.Value, options map[string]ax.Value) (ax.Value, error) {
	c.calls++
	if c.rawModelAnswer == "" {
		response, err := c.inner.Chat(ctx, map[string]ax.Value{"chat_prompt": ax.Array(ax.Object("role", "user", "content", "Give a three-step path from typed generation to agents and optimization."))}, nil)
		if err != nil { return nil, err }
		first := response.(map[string]ax.Value)["results"].([]ax.Value)[0].(map[string]ax.Value)
		c.rawModelAnswer, _ = first["content"].(string)
	}
	payload := ax.Object("answer", c.rawModelAnswer)
	if c.calls == 1 { payload = ax.Object("completion", ax.Object("type", "final", "args", ax.Array("Answer", ax.Object()))) }
	if c.calls == 2 { payload = ax.Object("completion", ax.Object("type", "final", "args", ax.Array("Answer", ax.Object("answer", c.rawModelAnswer, "usedContext", true, "plan", ax.Array("Declare a signature", "Run an agent", "Optimize with examples"))))) }
	data, err := json.Marshal(payload)
	if err != nil { return nil, err }
	return ax.Object("results", ax.Array(ax.Object("content", string(data), "function_calls", ax.Array()))), nil
}
func (c *openAIBackedAgentClient) Embed(context.Context, map[string]ax.Value, map[string]ax.Value) (ax.Value, error) { return ax.Object("embeddings", ax.Array()), nil }
func (c *openAIBackedAgentClient) Stream(context.Context, map[string]ax.Value, map[string]ax.Value) ([]ax.Value, error) { return nil, nil }


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
	stageClient := &openAIBackedAgentClient{inner: client}
	assistant := ax.NewAgent("question:string -> plan:string[], answer:string", map[string]ax.Value{"contextFields": ax.Array()})
	output, err := assistant.Forward(ctx, stageClient, map[string]ax.Value{"question": "Give a three-step path from typed generation to agents and optimization."}, nil)
	if err != nil { panic(err) }
	printJSON(ax.Object("agentOutput", output, "rawModelAnswer", stageClient.rawModelAnswer))
}
