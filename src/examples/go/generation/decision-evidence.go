// ax-example:start
// title: Go Decision Evidence Reranking
// group: generation
// description: Ranks documents through Ax signatures while retaining decision evidence and candidate IDs.
// provider: openai-decisions
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: intermediate
// order: 46
// ax-example:end
package main

import (
	"context"
	"encoding/json"
	"fmt"
	ax "github.com/ax-llm/ax/packages/go"
	"os"
	"sort"
	"time"
)

func main() {
	key := os.Getenv("OPENAI_API_KEY")
	if key == "" {
		key = os.Getenv("OPENAI_APIKEY")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	model := ax.NewAI("openai-decisions", map[string]ax.Value{"api_key": key})
	judge := ax.NewAx("query:string, document:string -> relevant:boolean(evidence, threshold 0.7), relevance:score \"Irrelevant, Related, Partial answer, Direct answer\"(evidence)", nil)
	candidates := []struct{ id, text string }{{"refund", "Request a refund within 30 days through your account billing page."}, {"password", "Reset your password using the sign-in page."}}
	ranked := []map[string]ax.Value{}
	for _, item := range candidates {
		result, err := judge.Forward(ctx, model, map[string]ax.Value{"query": "How do I request a refund?", "document": item.text}, nil)
		if err != nil {
			panic(err)
		}
		values := result.(map[string]ax.Value)
		values["id"] = item.id
		ranked = append(ranked, values)
	}
	score := func(i int) float64 { return ranked[i]["relevance"].(map[string]ax.Value)["value"].(float64) }
	sort.SliceStable(ranked, func(i, j int) bool { return score(i) > score(j) })
	data, err := json.MarshalIndent(ranked, "", "  ")
	if err != nil {
		panic(err)
	}
	fmt.Println(string(data))
}
