package main

import (
	"context"
	"fmt"
	ax "github.com/ax-llm/ax/packages/go"
)

func main() {
	calls := 0
	limiter := ax.AxRateLimiterFunc(func(next ax.AxRequestExecutor, info ax.AxRateLimitInfo) (ax.Value, error) {
		if info.Operation != "chat" || info.Provider == "" { panic(fmt.Sprintf("bad info: %#v", info)) }
		calls++
		return next()
	})
	transport := ax.NewScriptedTransport([]ax.Value{ax.Object("status", 200.0, "json", ax.Object(
		"model", "gpt-5.4-mini", "choices", ax.Array(ax.Object("message", ax.Object("content", "ok"), "finish_reason", "stop")),
	))})
	service := ax.NewOpenAICompatibleClient(map[string]ax.Value{"model": "gpt-5.4-mini", "api_key": "test", "transport": transport})
	ax.SetRateLimiter(limiter)
	defer func() { ax.SetRateLimiter(nil); ax.SetTracer(nil); ax.SetMeter(nil) }()
	if _, err := service.Chat(context.Background(), map[string]ax.Value{"chat_prompt": ax.Array(ax.Object("role", "user", "content", "hello"))}, nil); err != nil { panic(err) }
	hooks := ax.AxRuntimeHooks{RateLimiter: limiter}
	ax.NewAxWithHooks("input:string -> output:string", nil, hooks).SetTracer(nil).SetMeter(nil)
	ax.NewAgentWithHooks("input:string -> output:string", nil, hooks).SetTracer(nil).SetMeter(nil)
	ax.NewFlowWithHooks(map[string]ax.Value{"id": "runtime-hooks"}, hooks).SetTracer(nil).SetMeter(nil)
	if calls != 1 { panic(fmt.Sprintf("limiter calls: %d", calls)) }
	fmt.Println("go-runtime-hooks-no-key-ok")
}
