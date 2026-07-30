package main

import (
	"fmt"
	"os"
	"strings"

	ax "github.com/ax-llm/ax/packages/go"
)

func main() {
	endpoint := os.Getenv("AX_MCP_ENDPOINT")
	transport, err := ax.NewAxMCPStreamableHTTPTransport(endpoint, map[string]ax.Value{
		"ssrfProtection": map[string]ax.Value{
			"requireHttps": false, "allowLocalhost": true, "allowPrivateNetworks": true,
		},
	})
	if err != nil {
		panic(err)
	}
	client := ax.NewAxMCPClient(transport, map[string]ax.Value{
		"namespace": "foreign", "era": "auto",
	})
	catalog, err := client.InspectCatalog(false)
	if err != nil {
		panic(err)
	}
	if client.GetEra() != "legacy" || catalog.ProtocolVersion != "2025-11-25" {
		panic(fmt.Sprintf("unexpected MCP classification: era=%s version=%s", client.GetEra(), catalog.ProtocolVersion))
	}
	if len(catalog.Tools) == 0 {
		panic("foreign MCP catalog has no tools")
	}
	fmt.Println("AX_MCP_INTEROP_READY")
	result, err := client.CallTool("echo", map[string]ax.Value{"message": "ax-interop-go"})
	if err != nil {
		panic(err)
	}
	if !strings.Contains(fmt.Sprint(result), "Echo: ax-interop-go") {
		panic(fmt.Sprintf("unexpected echo result: %#v", result))
	}
	if err := client.Close(); err != nil {
		panic(err)
	}
	fmt.Println("AX_MCP_INTEROP_OK")
}
