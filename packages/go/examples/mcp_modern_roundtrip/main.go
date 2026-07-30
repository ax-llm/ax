package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"

	ax "github.com/ax-llm/ax/packages/go"
)

func main() {
	toolLists, calls, failures := 0, 0, []string{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request map[string]any
		_ = json.NewDecoder(r.Body).Decode(&request)
		method := fmt.Sprint(request["method"])
		params, _ := request["params"].(map[string]any)
		if method == "initialize" {
			failures = append(failures, "modern client sent initialize")
		}
		if method != "server/discover" {
			if _, ok := params["_meta"]; !ok {
				failures = append(failures, method+" omitted request _meta")
			}
		}
		calls++
		meta := map[string]any{"io.modelcontextprotocol/serverInfo": map[string]any{"name": "modern-loopback", "version": fmt.Sprintf("1.0.%d", calls)}}
		result := map[string]any{"resultType": "complete", "_meta": meta}
		switch method {
		case "server/discover":
			result = map[string]any{"resultType": "complete", "supportedVersions": []any{"2026-07-28"}, "capabilities": map[string]any{"tools": map[string]any{}, "extensions": map[string]any{"io.modelcontextprotocol/tasks": map[string]any{}}}, "ttlMs": 60000, "cacheScope": "public", "_meta": meta}
		case "tools/list":
			toolLists++
			result["tools"] = []any{
				map[string]any{"name": "start_reindex", "inputSchema": map[string]any{"type": "object", "properties": map[string]any{"scope": map[string]any{"type": "string", "x-mcp-header": "Scope"}}}},
				map[string]any{"name": "mrtr_roots_round", "inputSchema": map[string]any{"type": "object", "properties": map[string]any{}}},
			}
			result["ttlMs"], result["cacheScope"] = 60000, "public"
		case "tools/call":
			name := fmt.Sprint(params["name"])
			if name == "start_reindex" {
				if r.Header.Get("Mcp-Param-Scope") != "all" {
					failures = append(failures, "Mcp-Param-Scope was not propagated")
				}
				result = map[string]any{"resultType": "task", "taskId": "task-1", "status": "working", "createdAt": "2026-07-29T00:00:00Z", "lastUpdatedAt": "2026-07-29T00:00:00Z", "ttlMs": nil, "_meta": meta}
			} else if _, ok := params["requestState"]; !ok {
				result = map[string]any{"resultType": "input_required", "inputRequests": map[string]any{"roots": map[string]any{"method": "roots/list"}}, "requestState": "opaque-roots-state", "_meta": meta}
			} else {
				if params["requestState"] != "opaque-roots-state" || !strings.Contains(fmt.Sprint(params["inputResponses"]), "file:///workspace") {
					failures = append(failures, "roots MRTR response was not echoed")
				}
				result["structuredContent"] = map[string]any{"roots": 1}
			}
		case "tasks/get":
			result = map[string]any{"taskId": "task-1", "status": "completed", "createdAt": "2026-07-29T00:00:00Z", "lastUpdatedAt": "2026-07-29T00:00:01Z", "ttlMs": nil, "result": map[string]any{"resultType": "complete", "structuredContent": map[string]any{"indexed": 42}, "_meta": meta}, "_meta": meta}
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": request["id"], "result": result})
	}))
	defer server.Close()

	transport, err := ax.NewAxMCPStreamableHTTPTransport(server.URL+"/mcp", map[string]ax.Value{"ssrfProtection": map[string]ax.Value{"requireHttps": false, "allowLocalhost": true, "allowPrivateNetworks": true}})
	if err != nil {
		panic(err)
	}
	client := ax.NewAxMCPClient(transport, map[string]ax.Value{"era": "modern", "roots": []ax.Value{map[string]ax.Value{"uri": "file:///workspace", "name": "workspace"}}})
	if err := client.Init(); err != nil {
		panic(err)
	}
	if client.GetEra() != "modern" {
		panic("modern discovery failed")
	}
	if err := client.RefreshWithOptions(false); err != nil {
		panic(err)
	}
	task, err := client.CallTool("start_reindex", map[string]ax.Value{"scope": "all"})
	if err != nil {
		panic(err)
	}
	structured, _ := task["structuredContent"].(map[string]ax.Value)
	if fmt.Sprint(structured["indexed"]) != "42" {
		panic(fmt.Sprintf("task was not flattened: %#v", task))
	}
	roots, err := client.CallTool("mrtr_roots_round", map[string]ax.Value{})
	if err != nil {
		panic(err)
	}
	if !strings.Contains(fmt.Sprint(roots["structuredContent"]), "roots:1") {
		panic(fmt.Sprintf("roots MRTR failed: %#v", roots))
	}
	catalog, err := client.InspectCatalog(false)
	if err != nil {
		panic(err)
	}
	if toolLists != 1 || len(failures) != 0 || fmt.Sprint(catalog.ServerInfo["version"]) == "1.0.1" {
		panic(fmt.Sprintf("modern roundtrip failed: toolLists=%d failures=%v serverInfo=%v", toolLists, failures, catalog.ServerInfo))
	}
	_ = client.Close()
	fmt.Println("mcp-modern-roundtrip-ok")
}
