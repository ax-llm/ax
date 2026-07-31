package main

import (
	"fmt"
	"os"
	"sync"
	"time"

	ax "github.com/ax-llm/ax/packages/go"
)

func main() {
	endpoint := os.Getenv("AX_MCP_ENDPOINT")
	era := os.Getenv("AX_MCP_SMOKE_ERA")
	if era == "" { era = "legacy" }
	clientEra := era
	if era == "modern" { clientEra = "auto" }
	transport, err := ax.NewAxMCPStreamableHTTPTransport(endpoint, map[string]ax.Value{
		"ssrfProtection":   map[string]ax.Value{"requireHttps": false, "allowLocalhost": true, "allowPrivateNetworks": true},
		"reconnectDelayMs": 50,
	})
	if err != nil {
		panic(err)
	}
	client := ax.NewAxMCPClient(transport, map[string]ax.Value{
		"namespace": "inventory", "era": clientEra,
		"roots": ax.Array(map[string]ax.Value{"uri":"file:///workspace", "name":"workspace"}),
		"elicitation": func(_ map[string]ax.Value, _ map[string]ax.Value) (map[string]ax.Value, error) { return map[string]ax.Value{"action":"accept", "content":map[string]ax.Value{"confirmed":true}}, nil },
		"subscriptionFilters": map[string]ax.Value{"resourcesListChanged":true},
	})

	var mu sync.Mutex
	changed := sync.NewCond(&mu)
	state := map[string]int{"resource": 0, "task": 0, "progress": 0}
	mark := func(name string) {
		mu.Lock()
		state[name]++
		changed.Broadcast()
		mu.Unlock()
	}
	client.AddNotificationListener(func(message map[string]ax.Value) {
		if message["method"] == "notifications/progress" {
			mark("progress")
		}
	})
	if err := client.Init(); err != nil {
		panic(err)
	}
	catalog, err := client.InspectCatalog(false)
	if err != nil {
		panic(err)
	}
	if len(catalog.Resources) != 2 || len(catalog.ResourceTemplates) != 1 {
		panic(fmt.Sprintf("MCP catalog discovery failed: %#v", catalog))
	}
	taskID := ""
	if era == "modern" {
		result, err := client.CallTool("start_reindex", map[string]ax.Value{"scope":"all"}); if err != nil { panic(err) }
		structured, _ := result["structuredContent"].(map[string]ax.Value); if fmt.Sprint(structured["indexed"]) != "42" { panic(fmt.Sprintf("modern task result was not flattened: %#v", result)) }
		rootsResult, err := client.CallTool("mrtr_roots_round", map[string]ax.Value{}); if err != nil { panic(err) }
		rootsStructured, _ := rootsResult["structuredContent"].(map[string]ax.Value); if fmt.Sprint(rootsStructured["indexed"]) != "42" { panic(fmt.Sprintf("modern roots MRTR failed: %#v", rootsResult)) }
		elicitationResult, err := client.CallTool("mrtr_one_round", map[string]ax.Value{}); if err != nil { panic(err) }
		elicitationStructured, _ := elicitationResult["structuredContent"].(map[string]ax.Value); if fmt.Sprint(elicitationStructured["indexed"]) != "42" { panic(fmt.Sprintf("modern elicitation MRTR failed: %#v", elicitationResult)) }
		if _, err = client.CallTool("mrtr_two_round", map[string]ax.Value{}); err == nil || err.Error() != "MCP protocol violation: server requested sampling/createMessage without a matching client handler" { panic(fmt.Sprintf("modern sampling MRTR violation mismatch: %v", err)) }
		refreshed, err := client.InspectCatalog(false); if err != nil { panic(err) }; version := fmt.Sprint(refreshed.ServerInfo["version"]); if version == "" || version == "2.0.0" { panic(fmt.Sprintf("modern serverInfo was not refreshed: %#v", refreshed.ServerInfo)) }
	} else {
		result, err := client.CallTool("start_reindex", map[string]ax.Value{"scope": "all"}); if err != nil { panic(err) }
		task := result["task"].(map[string]ax.Value); taskID = task["taskId"].(string)
	}

	resourceTarget := ax.AxEventTarget{ID: "resource-target", RetrySafety: "idempotent",
		Invoke: func(input ax.Value, _ map[string]ax.Value) (ax.Value, error) { mark("resource"); return input, nil },
	}
	taskTarget := ax.AxEventTarget{ID: "task-target", RetrySafety: "idempotent",
		WaitFor: []map[string]ax.Value{{"kind": "mcp.task", "value": "taskKey", "metadata": map[string]ax.Value{"taskId": taskID}}},
		MapInput: func(event ax.AxEventEnvelope, continuation *ax.AxEventContinuation) (ax.Value, error) {
			if continuation != nil {
				return map[string]ax.Value{"taskId": continuation.Metadata["taskId"]}, nil
			}
			return map[string]ax.Value{"taskId": event.Data.(map[string]ax.Value)["taskId"]}, nil
		},
		Invoke: func(input ax.Value, _ map[string]ax.Value) (ax.Value, error) { mark("task"); return input, nil },
	}
	runtime, err := ax.NewAxEventRuntime([]ax.AxEventRoute{
		{ID: "resource-wake", Action: "wake", TargetID: "resource-target", RequireAuthenticated: true, Match: map[string]ax.Value{"types": ax.Array("mcp.resource.updated")}},
		{ID: "task-start", Action: "wake", TargetID: "task-target", Match: map[string]ax.Value{"types": ax.Array("app.task.started")}},
		{ID: "task-progress", Action: "observe", Match: map[string]ax.Value{"types": ax.Array("mcp.progress")}},
		{ID: "task-resume", Action: "resume", TargetID: "task-target", Match: map[string]ax.Value{"types": ax.Array("mcp.task.status")}},
	}, nil)
	if err != nil {
		panic(err)
	}
	runtime.RegisterTarget(resourceTarget)
	runtime.RegisterTarget(taskTarget)
	source := ax.NewAxMCPEventSourceWithPolicy(client, "inventory", "tenant:smoke", "authenticated", ax.AxMCPSubscribeAll())
	runtime.AddSource(source)
	if err := runtime.Start(); err != nil {
		panic(err)
	}
	if era == "legacy" {
		_, err = runtime.Publish(ax.AxEventEnvelope{SpecVersion: "1.0", ID: "task-start", Source: "app://smoke", Type: "app.task.started", Data: map[string]ax.Value{"taskId": taskID, "taskKey": "inventory:" + taskID}}, "tenant:smoke", "authenticated")
		if err != nil { panic(err) }
	}
	fmt.Println("AX_MCP_SMOKE_READY")

	deadline := time.Now().Add(20 * time.Second)
	mu.Lock()
	for !(state["resource"] >= 1 && (era == "modern" || state["task"] >= 2) && (era == "modern" || state["progress"] >= 1)) {
		if time.Now().After(deadline) {
			mu.Unlock()
			panic(fmt.Sprintf("MCP event smoke timed out: %#v", state))
		}
		changed.Wait()
	}
	resultLine := fmt.Sprintf("AX_MCP_SMOKE_OK resource=%d task=%d progress=%d", state["resource"], state["task"], state["progress"])
	mu.Unlock()
	if err := runtime.Close(); err != nil {
		panic(err)
	}
	if err := client.Close(); err != nil {
		panic(err)
	}
	fmt.Println(resultLine)
}
