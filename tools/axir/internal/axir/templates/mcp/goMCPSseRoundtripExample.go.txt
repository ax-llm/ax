package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"

	ax "github.com/ax-llm/ax/packages/go"
)

// mcp_sse_roundtrip drives AxMCPStreamableHTTPTransport.Send() through the REAL
// net/http transport against an in-process loopback server that answers the
// JSON-RPC POST with Content-Type: text/event-stream — the Streamable HTTP SSE
// path the ScriptedTransport conformance fixtures bypass. The SSE body
// interleaves a notification ahead of the id-matched response, so a transport
// that ignored the Content-Type (JSON-decoding the raw stream) or returned the
// first `data:` frame would fail. Panics on any mismatch so `axir verify` fails
// if the SSE branch regresses.

const sseBody = ": keepalive\n" +
	"event: message\n" +
	`data: {"jsonrpc":"2.0","method":"notifications/message","params":{"level":"info"}}` + "\n" +
	"\n" +
	"event: message\n" +
	`data: {"jsonrpc":"2.0","id":"ax-sse-1","result":{"ok":true,"protocolVersion":"2025-11-25"}}` + "\n" +
	"\n"

func main() {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet { w.WriteHeader(http.StatusMethodNotAllowed); return }
		var request map[string]any
		json.NewDecoder(r.Body).Decode(&request)
		switch request["method"] {
		case "server/discover":
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]any{"jsonrpc":"2.0", "id":request["id"], "error":map[string]any{"code":-32601, "message":"Method not found"}})
		case "initialize":
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]any{"jsonrpc":"2.0", "id":request["id"], "result":map[string]any{"protocolVersion":"2025-11-25", "capabilities":map[string]any{}, "serverInfo":map[string]any{"name":"legacy-loopback", "version":"1.0.0"}}})
		case "notifications/initialized":
			w.WriteHeader(http.StatusAccepted)
		default:
			w.Header().Set("Content-Type", "text/event-stream")
			requestID, _ := json.Marshal(request["id"])
			io.WriteString(w, strings.Replace(sseBody, `"ax-sse-1"`, string(requestID), 1))
		}
	}))
	defer server.Close()

	transport, err := ax.NewAxMCPStreamableHTTPTransport(server.URL+"/mcp", map[string]ax.Value{
		"ssrfProtection": map[string]ax.Value{"requireHttps": false, "allowLocalhost": true, "allowPrivateNetworks": true},
	})
	if err != nil {
		panic(err)
	}
	client := ax.NewAxMCPClient(transport, nil)
	if err := client.Init(); err != nil { panic(err) }
	if client.GetEra() != "legacy" { panic("auto discovery did not fall back to legacy") }
	response, err := client.CallTool("noop", map[string]ax.Value{})
	if err != nil {
		panic(err)
	}
	data, _ := json.Marshal(response)
	if !strings.Contains(string(data), `"ok":true`) {
		panic("SSE response not decoded from text/event-stream body: " + string(data))
	}
	client.Close()
	fmt.Println("mcp-sse-roundtrip-ok")
}
