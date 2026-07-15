// ax-example:start
// title: Go MCP Task Continuation
// group: mcp
// description: Creates an owned continuation and resumes an AxFlow from real MCP progress and terminal task notifications.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY, AX_MCP_ENDPOINT
// level: advanced
// order: 30
// story: 62
// ax-example:end
package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"strings"
	"sync/atomic"
	"time"

	ax "github.com/ax-llm/ax/packages/go"
)

func main() {
	key := os.Getenv("OPENAI_API_KEY")
	if key == "" {
		key = os.Getenv("OPENAI_APIKEY")
	}
	if key == "" {
		panic("Set OPENAI_API_KEY.")
	}
	endpoint := os.Getenv("AX_MCP_ENDPOINT")
	if endpoint == "" {
		panic("Set AX_MCP_ENDPOINT to a Streamable HTTP MCP server.")
	}
	local := strings.HasPrefix(endpoint, "http://127.0.0.1")
	transport, err := ax.NewAxMCPStreamableHTTPTransport(endpoint, map[string]ax.Value{"ssrfProtection": map[string]ax.Value{"requireHttps": !local, "allowLocalhost": local, "allowPrivateNetworks": local}})
	if err != nil {
		panic(err)
	}
	client := ax.NewAxMCPClient(transport, map[string]ax.Value{"namespace": "inventory"})
	mcp := ax.NewAxMCPEventSource(client, "inventory", "tenant:demo", "authenticated", nil)
	started := &ax.AxPushEventSource{ID: "task-started", IdentityScope: "tenant:demo", Trust: "authenticated"}
	program := ax.NewFlow(map[string]ax.Value{"id": "reindex-flow"}).Execute("status", ax.NewAx("taskId:string -> status:string", nil), nil).Returns(map[string]ax.Value{"status": "status"})
	llm := ax.NewOpenAICompatibleClient(map[string]ax.Value{"api_key": key, "model": "gpt-5.4-mini"})
	done := make(chan struct{}, 1)
	var calls atomic.Int32
	target := ax.AxEventTarget{ID: "reindex-flow", RetrySafety: "idempotent", WaitFor: []map[string]ax.Value{{"kind": "mcp.task", "value": "taskKey", "metadata": map[string]ax.Value{}}},
		MapInput: func(event ax.AxEventEnvelope, continuation *ax.AxEventContinuation) (ax.Value, error) {
			if continuation != nil {
				return map[string]ax.Value{"taskId": continuation.Metadata["taskId"]}, nil
			}
			return map[string]ax.Value{"taskId": event.Data.(map[string]ax.Value)["taskId"]}, nil
		},
		Invoke: func(input ax.Value, _ map[string]ax.Value) (ax.Value, error) {
			out, err := program.Forward(context.Background(), llm, input.(map[string]ax.Value), nil)
			if err == nil {
				fmt.Println(out)
				if calls.Add(1) >= 2 {
					select {
					case done <- struct{}{}:
					default:
					}
				}
			}
			return out, err
		},
	}
	runtime, err := ax.NewAxEventRuntime([]ax.AxEventRoute{
		{ID: "task-start", Action: "wake", TargetID: "reindex-flow", Match: map[string]ax.Value{"types": ax.Array("app.task.started")}},
		{ID: "task-progress", Action: "observe", Match: map[string]ax.Value{"types": ax.Array("mcp.progress")}},
		{ID: "task-resume", Action: "resume", TargetID: "reindex-flow", Match: map[string]ax.Value{"types": ax.Array("mcp.task.status")}},
	}, nil)
	if err != nil {
		panic(err)
	}
	runtime.RegisterTarget(target)
	runtime.AddSource(started)
	runtime.AddSource(mcp)
	if err := runtime.Start(); err != nil {
		panic(err)
	}
	taskResult, err := client.CallTool("start_reindex", map[string]ax.Value{"scope": "all"})
	if err != nil {
		panic(err)
	}
	taskID := taskResult["task"].(map[string]ax.Value)["taskId"].(string)
	target.WaitFor[0]["metadata"] = map[string]ax.Value{"taskId": taskID}
	if err := started.Publish(ax.AxEventEnvelope{SpecVersion: "1.0", ID: "task-start", Source: "app://tasks", Type: "app.task.started", Data: map[string]ax.Value{"taskId": taskID, "taskKey": "inventory:" + taskID}}); err != nil {
		panic(err)
	}
	fmt.Println("Waiting for terminal MCP task notification", taskID)
	if os.Getenv("AX_MCP_DEMO_AUTO") == "1" {
		response, err := http.Post(strings.TrimSuffix(endpoint, "/mcp")+"/control/task/complete", "application/json", nil)
		if err != nil {
			panic(err)
		}
		response.Body.Close()
	}
	select {
	case <-done:
	case <-time.After(60 * time.Second):
		panic("Timed out waiting for the MCP task continuation")
	}
	if err := runtime.Close(); err != nil {
		panic(err)
	}
	if err := client.Close(); err != nil {
		panic(err)
	}
}
