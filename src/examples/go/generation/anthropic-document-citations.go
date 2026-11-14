// ax-example:start
// title: Go Anthropic Document Citations
// group: generation
// description: Preserve source locations and output passages through ordinary and streaming generation.
// provider: anthropic
// env: ANTHROPIC_API_KEY, ANTHROPIC_APIKEY
// level: intermediate
// order: 48
// ax-example:end
package main

import (
	"context"
	"encoding/json"
	"fmt"
	ax "github.com/ax-llm/ax/packages/go"
	"os"
	"time"
)

func main() {
	key := os.Getenv("ANTHROPIC_API_KEY")
	if key == "" {
		key = os.Getenv("ANTHROPIC_APIKEY")
	}
	if key == "" {
		panic("Set ANTHROPIC_API_KEY.")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	client := ax.NewAI("anthropic", map[string]ax.Value{"api_key": key, "model": "claude-haiku-5-5"})
	for _, stream := range []bool{false, true} {
		program := ax.NewAx(`doc:file -> answer:string "State the opening year and closed day, citing the supplied document."`, nil)
		answer, err := program.Forward(ctx, client, map[string]ax.Value{"doc": ax.Object(
			"source", ax.Object("type", "text", "data", "The museum opened in 1984. It is closed on Mondays."),
			"title", "Museum notes", "citations", ax.Object("enabled", true),
		)}, map[string]ax.Value{"stream": stream})
		if err != nil {
			panic(err)
		}
		// Each log entry keeps text_blocks and usage.citations for this request.
		data, err := json.MarshalIndent(map[string]any{"stream": stream, "answer": answer, "chat_log": program.ChatLog}, "", "  ")
		if err != nil {
			panic(err)
		}
		fmt.Println(string(data))
	}
}
