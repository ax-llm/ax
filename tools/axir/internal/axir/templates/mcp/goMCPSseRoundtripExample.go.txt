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
		io.ReadAll(r.Body)
		w.Header().Set("Content-Type", "text/event-stream")
		io.WriteString(w, sseBody)
	}))
	defer server.Close()

	transport, err := ax.NewAxMCPStreamableHTTPTransport(server.URL+"/mcp", map[string]ax.Value{
		"ssrfProtection": map[string]ax.Value{"requireHttps": false, "allowLocalhost": true, "allowPrivateNetworks": true},
	})
	if err != nil {
		panic(err)
	}
	response, err := transport.Send(map[string]ax.Value{
		"jsonrpc": "2.0", "id": "ax-sse-1", "method": "tools/call",
		"params": map[string]ax.Value{"name": "noop"},
	})
	if err != nil {
		panic(err)
	}
	data, _ := json.Marshal(response)
	if !strings.Contains(string(data), `"ok":true`) {
		panic("SSE response not decoded from text/event-stream body: " + string(data))
	}
	if !strings.Contains(string(data), `"id":"ax-sse-1"`) {
		panic("SSE selector did not return the id-matched JSON-RPC response: " + string(data))
	}
	fmt.Println("mcp-sse-roundtrip-ok")
}
