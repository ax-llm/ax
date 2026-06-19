package main

import (
	"encoding/json"
	"fmt"

	ax "github.com/ax-llm/ax/packages/go"
)

func main() {
	grok := ax.NewGrokClient(map[string]ax.Value{"model": "grok-voice-think-fast-1.0", "api_key": "test-key"})
	grokRequest := map[string]ax.Value{
		"model": "grok-voice-think-fast-1.0",
		"chat_prompt": ax.Array(
			ax.Object("role", "system", "content", "You are a concise voice agent."),
			ax.Object("role", "user", "content", "Say hello."),
		),
		"audio": ax.Object(
			"input", ax.Object("sampleRate", 24000),
			"output", ax.Object("sampleRate", 24000, "voice", "eve"),
		),
	}
	grokEvents := []ax.Value{
		ax.Object("type", "response.output_audio_transcript.delta", "response_id", "grok_rt", "delta", "hello "),
		ax.Object("type", "response.output_audio.delta", "response_id", "grok_rt", "delta", "AQI="),
		ax.Object(
			"type", "response.done",
			"response", ax.Object("id", "grok_rt", "usage", ax.Object("input_tokens", 3, "output_tokens", 2, "total_tokens", 5)),
		),
	}

	gemini := ax.NewGoogleGeminiClient(map[string]ax.Value{
		"model":   "gemini-2.5-flash-native-audio-preview-12-2025",
		"api_key": "test-key",
	})
	geminiRequest := map[string]ax.Value{
		"model": "gemini-2.5-flash-native-audio-preview-12-2025",
		"chat_prompt": ax.Array(
			ax.Object("role", "system", "content", "Answer with audio."),
			ax.Object("role", "user", "content", ax.Array(
				ax.Object("type", "text", "text", "Realtime question"),
				ax.Object("type", "audio", "data", "AAAA", "format", "pcm16", "sampleRate", 16000),
			)),
		),
		"audio": ax.Object("output", ax.Object("transcript", true, "voice", "Kore")),
	}
	geminiEvents := []ax.Value{
		ax.Object("id", "gemini_live_1", "serverContent", ax.Object("outputTranscription", ax.Object("text", "spoken "))),
		ax.Object("id", "gemini_live_2", "serverContent", ax.Object(
			"modelTurn", ax.Object("parts", ax.Array(ax.Object("inlineData", ax.Object("data", "AQI=", "mimeType", "audio/pcm")))),
		)),
		ax.Object("id", "gemini_live_3", "toolCall", ax.Object(
			"functionCalls", ax.Array(ax.Object("name", "lookup", "args", ax.Object("q", "ax"))),
		)),
		ax.Object(
			"id", "gemini_live_done",
			"serverContent", ax.Object("turnComplete", true),
			"usageMetadata", ax.Object("promptTokenCount", 3, "candidatesTokenCount", 4, "totalTokenCount", 7),
		),
	}

	out := ax.Object(
		"grokSetup", grok.RealtimeAudioSetup(grokRequest, nil),
		"grokEvents", grok.Realtime(grokEvents),
		"geminiSetup", gemini.RealtimeAudioSetup(geminiRequest, nil),
		"geminiInput", gemini.RealtimeAudioInput(geminiRequest, nil),
		"geminiEvents", gemini.Realtime(geminiEvents),
	)
	data, err := json.MarshalIndent(out, "", "  ")
	if err != nil {
		panic(err)
	}
	fmt.Println(string(data))
}
