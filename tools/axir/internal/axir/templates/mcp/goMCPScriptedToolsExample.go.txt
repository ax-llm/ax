package main

import (
	"fmt"

	ax "github.com/ax-llm/ax/packages/go"
)

func main() {
	transport := ax.NewAxMCPScriptedTransport([]ax.Value{
		map[string]ax.Value{"method":"initialize", "result":map[string]ax.Value{
			"protocolVersion":"2025-11-25",
			"capabilities":map[string]ax.Value{"tools":map[string]ax.Value{}},
			"serverInfo":map[string]ax.Value{"name":"scripted-mcp", "version":"1.0.0"},
		}},
		map[string]ax.Value{"method":"tools/list", "result":map[string]ax.Value{"tools":[]ax.Value{
			map[string]ax.Value{"name":"echo", "description":"Echo text", "inputSchema":map[string]ax.Value{"type":"object"}},
		}}},
		map[string]ax.Value{"method":"tools/call", "result":map[string]ax.Value{"structuredContent":map[string]ax.Value{"echo":"hello"}}},
	})
	client := ax.NewAxMCPClient(transport, nil)
	if err := client.Init(); err != nil { panic(err) }
	result := client.ToFunction()[0].Call(map[string]ax.Value{"text":"hello"})
	if result.(map[string]ax.Value)["echo"] != "hello" { panic("unexpected MCP result") }
	fmt.Println("go-mcp-ok")
}
