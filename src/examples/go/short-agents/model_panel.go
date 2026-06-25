// ax-example:start
// title: Go Multi-Model Panel
// group: short-agents
// description: Fans one question across three providers (OpenAI, Gemini, Anthropic), then judges the candidates and synthesizes a single grounded answer.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY, GOOGLE_APIKEY, ANTHROPIC_APIKEY
// level: advanced
// order: 40
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

func printJSON(value ax.Value) {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		panic(err)
	}
	fmt.Println(string(data))
}

type panelist struct {
	model  string
	client ax.AIClient
}

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	openaiKey := os.Getenv("OPENAI_API_KEY")
	if openaiKey == "" {
		openaiKey = os.Getenv("OPENAI_APIKEY")
	}
	googleKey := os.Getenv("GOOGLE_APIKEY")
	if googleKey == "" {
		googleKey = os.Getenv("GOOGLE_API_KEY")
	}
	anthropicKey := os.Getenv("ANTHROPIC_APIKEY")
	if anthropicKey == "" {
		anthropicKey = os.Getenv("ANTHROPIC_API_KEY")
	}
	if openaiKey == "" || googleKey == "" || anthropicKey == "" {
		panic("Set OPENAI_APIKEY, GOOGLE_APIKEY, and ANTHROPIC_APIKEY to run this multi-provider panel.")
	}

	// A panel of three different providers, each answering the same question
	// independently. Plain ax() composition (no agent runtime): fan out to the
	// panel, judge the candidates, then synthesize one grounded answer.
	panel := []panelist{
		{"openai/gpt-5.4-mini", ax.NewOpenAICompatibleClient(map[string]ax.Value{"api_key": openaiKey, "model": "gpt-5.4-mini", "model_config": ax.Object("temperature", 0)})},
		{"google/gemini-3.5-flash", ax.NewGoogleGeminiClient(map[string]ax.Value{"api_key": googleKey, "model": "gemini-3.5-flash"})},
		{"anthropic/claude-haiku-4.5", ax.NewAnthropicClient(map[string]ax.Value{"api_key": anthropicKey, "model": "claude-haiku-4-5"})},
	}

	researcher := ax.NewAx(
		"question:string -> answer:string, keyFindings:string[], citations:string[], confidence:number",
		map[string]ax.Value{"instruction": "Answer independently. Use evidence. Call out uncertainty. Do not optimize for consensus."},
	)

	judge := ax.NewAx(
		"question:string, candidates:json -> consensus:string[], contradictions:string[], uniqueInsights:string[], blindSpots:string[]",
		map[string]ax.Value{"instruction": "Compare the candidates. Find agreement, conflicts, missing coverage, and unique useful points."},
	)

	synthesizer := ax.NewAx(
		"question:string, candidates:json, review:json -> answer:string, citations:string[], caveats:string[]",
		map[string]ax.Value{"instruction": "Write one final answer grounded in the candidates and review. Resolve conflicts explicitly."},
	)

	question := "What are the strongest arguments for and against a national carbon tax?"

	candidates := []ax.Value{}
	for _, p := range panel {
		response, err := researcher.Forward(ctx, p.client, map[string]ax.Value{"question": question}, nil)
		if err != nil {
			panic(err)
		}
		candidate := map[string]ax.Value{"model": p.model}
		if fields, ok := response.(map[string]ax.Value); ok {
			for k, v := range fields {
				candidate[k] = v
			}
		}
		candidates = append(candidates, candidate)
	}

	// The judge + synthesizer run on one of the panel clients (OpenAI here).
	orchestrator := panel[0].client
	review, err := judge.Forward(ctx, orchestrator, map[string]ax.Value{"question": question, "candidates": ax.Array(candidates...)}, nil)
	if err != nil {
		panic(err)
	}
	final, err := synthesizer.Forward(ctx, orchestrator, map[string]ax.Value{"question": question, "candidates": ax.Array(candidates...), "review": review}, nil)
	if err != nil {
		panic(err)
	}

	printJSON(final)
}
