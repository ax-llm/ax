package main

import (
	"context"
	"errors"
	"fmt"
	"strings"

	ax "github.com/ax-llm/ax/packages/go"
)

func main() {
	transport := ax.NewScriptedTransport([]ax.Value{ax.Object("status", 200, "json", ax.Object())})
	client := ax.NewOpenAICompatibleClient(map[string]ax.Value{
		"api_key":   "test-key",
		"model":     "gpt-5.6-luna",
		"transport": transport,
	})
	ctx, cancel := context.WithCancelCause(context.Background())
	cancel(errors.New("user stopped"))

	_, err := client.Chat(ctx, map[string]ax.Value{
		"chat_prompt": ax.Array(ax.Object("role", "user", "content", "This must not be sent.")),
	}, nil)
	var aborted ax.AxAIServiceAbortedError
	if !errors.As(err, &aborted) || aborted.Retryable || !strings.Contains(err.Error(), "user stopped") {
		panic(fmt.Sprintf("wrong cancellation error: %v", err))
	}
	if len(transport.Requests) != 0 {
		panic("pre-cancelled request reached transport")
	}
	fmt.Println("go-cancellation-no-key user stopped")
}
