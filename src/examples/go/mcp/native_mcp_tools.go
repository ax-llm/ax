// ax-example:start
// title: Go Native MCP Tools
// group: mcp
// description: Attaches a live MCP client directly to AxGen without a lossy function adapter.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY, MCP_URL
// level: beginner
// order: 10
// story: 60
// ax-example:end
package main

import (
	"context"
	"fmt"
	"os"

	ax "github.com/ax-llm/ax/packages/go"
)

func main() {
	key, endpoint := os.Getenv("OPENAI_API_KEY"), os.Getenv("MCP_URL")
	if key == "" {
		key = os.Getenv("OPENAI_APIKEY")
	}
	if key == "" || endpoint == "" {
		panic("Set OPENAI_API_KEY and MCP_URL.")
	}
	transport, err := ax.NewAxMCPStreamableHTTPTransport(endpoint, nil)
	if err != nil {
		panic(err)
	}
	mcp := ax.NewAxMCPClient(transport, map[string]ax.Value{"namespace": "inventory"})
	defer func() { _ = mcp.Close() }()
	catalog, err := mcp.InspectCatalog(false)
	if err != nil {
		panic(err)
	}
	fmt.Printf("MCP catalog: %d tools, %d resources, %d templates\n", len(catalog.Tools), len(catalog.Resources), len(catalog.ResourceTemplates))
	program := ax.NewAx("request:string -> answer:string", map[string]ax.Value{"mcp": mcp})
	llm := ax.NewOpenAICompatibleClient(map[string]ax.Value{"api_key": key, "model": "gpt-5.4-mini"})
	output, err := program.Forward(context.Background(), llm, map[string]ax.Value{"request": "Reindex inventory."}, nil)
	if err != nil {
		panic(err)
	}
	fmt.Println(output)
}
