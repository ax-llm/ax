// ax-example:start
// title: Go Streaming Field Deltas
// group: generation
// description: Streams AxGen output as TypeScript-style {Version, Index, Delta} field deltas and merges them as they arrive.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: intermediate
// order: 46
// ax-example:end
package main

import (
	"context"
	"fmt"
	"os"

	ax "github.com/ax-llm/ax/packages/go"
)

func main() {
	apiKey := os.Getenv("OPENAI_API_KEY")
	if apiKey == "" {
		apiKey = os.Getenv("OPENAI_APIKEY")
	}
	if apiKey == "" {
		panic("Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.")
	}
	model := os.Getenv("AX_OPENAI_MODEL")
	if model == "" {
		model = "gpt-5.4-mini"
	}
	client := ax.NewAI("openai", map[string]ax.Value{"api_key": apiKey, "model": model})
	story := ax.NewAx(`topic:string -> title:string, story:string "Three short sentences"`, nil)

	// Each delta holds the new text of one field. Merge a sample's deltas
	// (strings append, other values replace) and start over when the version
	// changes: a retry or a replaced step starts a new version.
	merged := map[string]ax.Value{}
	version := 0
	values := map[string]ax.Value{"topic": "a lighthouse keeper's cat"}
	for delta, err := range story.StreamingForward(context.Background(), client, values, nil) {
		if err != nil {
			panic(err)
		}
		if delta.Version != version {
			merged, version = map[string]ax.Value{}, delta.Version
			fmt.Println("\n[retry: starting over]")
		}
		for field, value := range delta.Delta {
			text, isText := value.(string)
			if previous, ok := merged[field].(string); ok && isText {
				merged[field] = previous + text
			} else {
				merged[field] = value
			}
			if field == "story" && isText {
				fmt.Print(text)
			}
		}
	}
	fmt.Printf("\nTitle: %v\n", merged["title"])
}
