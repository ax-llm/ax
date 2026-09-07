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
	client := ax.NewAI("grok", map[string]ax.Value{"model": "grok-voice-think-fast-1.0", "api_key": "test-key"}).(*ax.OpenAICompatibleClient)
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
	meta := ax.NewAI("meta", map[string]ax.Value{"model": "muse-voice-transcribe-1.0", "api_key": "test-key"}).(*ax.OpenAIResponsesClient)
	metaRequest := map[string]ax.Value{
		"model": "muse-voice-transcribe-1.0",
		"chat_prompt": ax.Array(ax.Object("role", "user", "content", ax.Array(ax.Object("type", "audio", "data", "AAE=", "format", "pcm16")))),
		"audio": ax.Object("input", ax.Object("sampleRate", 16000, "channels", 1)),
		"model_config": ax.Object("realtimeTranscription", ax.Object("partialMode", "delta")),
	}
	metaTransport := ax.NewScriptedRealtimeTransport([]ax.Value{
		ax.Object("sessionId", "meta-session"),
		ax.Object("type", "speechStart", "turnId", "one"),
		ax.Object("type", "transcript", "transcript", "Hello"),
		ax.Object("type", "transcript", "transcript", " world"),
		ax.Object("type", "speaker", "speaker", "A"),
		ax.Object("type", "speechStart", "turnId", "two"),
		ax.Object("type", "transcript", "transcript", "Second"),
		ax.Object("type", "speechComplete", "turnId", "one", "transcript", "Hello world!"),
		ax.Object("type", "speechComplete", "turnId", "two", "transcript", "Second turn"),
	})
	metaFinal, err := meta.RealtimeChat(context.Background(), metaRequest, nil, metaTransport)
	if err != nil { fail(err.Error(), nil) }
	// Round-trip the public JSON value to avoid depending on Ax's internal array representation.
	metaJSON, _ := json.Marshal(metaFinal)
	var metaResponse map[string]ax.Value
	if err := json.Unmarshal(metaJSON, &metaResponse); err != nil { fail(err.Error(), metaFinal) }
	metaResults := metaResponse["results"].([]ax.Value)
	if metaResponse["remote_session_id"] != "meta-session" || len(metaResults) != 2 || metaResults[0].(map[string]ax.Value)["content"] != "Hello world!" || metaResults[1].(map[string]ax.Value)["content"] != "Second turn" { fail("Meta overlapping turns or session lost", metaFinal) }
	if len(metaTransport.Sent) != 3 || metaTransport.Sent[0].(map[string]ax.Value)["audioEncoding"] != "PCM_16KHZ" || metaTransport.Sent[1].(map[string]ax.Value)["type"] != "binary" || metaTransport.Sent[2].(map[string]ax.Value)["type"] != "endStream" { fail("Meta setup/audio/shutdown order", metaTransport.Sent) }
	fmt.Println("realtime-audio-turn-ok")
}
