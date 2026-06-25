package main

// Drive a realtime audio TURN through the productized RealtimeChat driver using
// ScriptedRealtimeTransport: the deterministic, credential-free path that
// exercises the full send-setup -> send-input -> fold -> merge loop without a
// live socket (the live socket path is verified separately against the real
// API). Exits non-zero on any mismatch so `axir verify` fails if it regresses.

import (
	"context"
	"encoding/json"
	"fmt"
	"os"

	ax "github.com/ax-llm/ax/packages/go"
)

func fail(message string, detail ax.Value) {
	data, _ := json.MarshalIndent(detail, "", "  ")
	fmt.Println("realtime-audio-turn FAIL:", message, string(data))
	os.Exit(1)
}

func main() {
	client := ax.NewGrokClient(map[string]ax.Value{"model": "grok-voice-think-fast-1.0", "api_key": "test-key"})
	request := map[string]ax.Value{
		"model": "grok-voice-think-fast-1.0",
		"chat_prompt": ax.Array(
			ax.Object("role", "system", "content", "You are a concise voice agent."),
			ax.Object("role", "user", "content", "Say hello."),
		),
		"audio": ax.Object("output", ax.Object("voice", "eve")),
	}
	// Canned server frames: session handshake, two transcript deltas, an audio
	// delta, then the terminal response.done.
	inbound := []ax.Value{
		ax.Object("type", "session.created"),
		ax.Object("type", "session.updated"),
		ax.Object("type", "response.output_audio_transcript.delta", "response_id", "rt", "delta", "hel"),
		ax.Object("type", "response.output_audio_transcript.delta", "response_id", "rt", "delta", "lo"),
		ax.Object("type", "response.output_audio.delta", "response_id", "rt", "delta", "AQI="),
		ax.Object("type", "response.done", "response", ax.Object("id", "rt", "usage", ax.Object("input_tokens", 3, "output_tokens", 2, "total_tokens", 5))),
	}

	transport := ax.NewScriptedRealtimeTransport(inbound)
	final, err := client.RealtimeChat(context.Background(), request, nil, transport)
	if err != nil {
		fail("driver returned error: "+err.Error(), nil)
	}

	sentTypes := []ax.Value{}
	for _, event := range transport.Sent {
		sentTypes = append(sentTypes, event.(map[string]ax.Value)["type"])
	}
	result := final.(map[string]ax.Value)["results"].([]ax.Value)[0].(map[string]ax.Value)
	fmt.Println("driver sent:", sentTypes)
	rendered, _ := json.Marshal(result)
	fmt.Println("merged result:", string(rendered))

	// The driver must send the Core-built session.update first, then the inputs.
	want := []string{"session.update", "conversation.item.create", "response.create"}
	if len(sentTypes) != len(want) {
		fail("unexpected sent event count", final)
	}
	for i, w := range want {
		if sentTypes[i].(string) != w {
			fail("unexpected sent event order", final)
		}
	}
	// Transcript deltas concatenated, audio chunk surfaced, turn finished.
	if result["content"] != "hello" {
		fail("transcript not concatenated", final)
	}
	if result["finish_reason"] != "stop" {
		fail("turn did not finish", final)
	}
	audio, ok := result["audio"].(map[string]ax.Value)
	if !ok || audio["data"] != "AQI=" {
		fail("audio chunk not surfaced", final)
	}
	fmt.Println("realtime-audio-turn-ok")
}
