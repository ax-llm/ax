package main

import (
	"context"
	"encoding/json"
	"fmt"

	ax "github.com/ax-llm/ax/packages/go"
)

func main() {
	transport := ax.NewScriptedTransport([]ax.Value{
		ax.Object("status", 200, "json", ax.Object("audio", "base64-speech")),
		ax.Object("status", 200, "json", ax.Object("text", "hello world", "language", "en", "duration", 1.25)),
	})
	client := ax.NewOpenAIResponsesClient(map[string]ax.Value{
		"api_key":   "test-key",
		"transport": transport,
	})
	speech, err := client.Speak(context.Background(), map[string]ax.Value{
		"text": "hello", "voice": "alloy", "format": "mp3",
	}, nil)
	if err != nil {
		panic(err)
	}
	transcript, err := client.Transcribe(context.Background(), map[string]ax.Value{
		"audio": "base64-audio", "language": "en", "model": "whisper-1", "format": "json",
	}, nil)
	if err != nil {
		panic(err)
	}
	data, err := json.MarshalIndent(ax.Object("speak", speech, "transcribe", transcript, "requests", transport.Requests), "", "  ")
	if err != nil {
		panic(err)
	}
	fmt.Println(string(data))
}
