import dev.axllm.ax.*;
import java.util.*;

public final class RealtimeAudioEventsExample {
  public static void main(String[] args) {
    GrokClient grok =
        new GrokClient(Map.of("model", "grok-voice-think-fast-1.0", "api_key", "test-key"));
    Map<String, Object> grokRequest =
        Map.of(
            "model",
            "grok-voice-think-fast-1.0",
            "chat_prompt",
            List.of(
                Map.of("role", "system", "content", "You are a concise voice agent."),
                Map.of("role", "user", "content", "Say hello.")),
            "audio",
            Map.of(
                "input",
                Map.of("sampleRate", 24000),
                "output",
                Map.of("sampleRate", 24000, "voice", "eve")));
    List<Object> grokEvents =
        List.of(
            Map.of("type", "response.output_audio_transcript.delta", "response_id", "grok_rt", "delta", "hello "),
            Map.of("type", "response.output_audio.delta", "response_id", "grok_rt", "delta", "AQI="),
            Map.of(
                "type",
                "response.done",
                "response",
                Map.of(
                    "id",
                    "grok_rt",
                    "usage",
                    Map.of("input_tokens", 3, "output_tokens", 2, "total_tokens", 5))));

    GoogleGeminiClient gemini =
        new GoogleGeminiClient(
            Map.of("model", "gemini-2.5-flash-native-audio-preview-12-2025", "api_key", "test-key"));
    Map<String, Object> geminiRequest =
        Map.of(
            "model",
            "gemini-2.5-flash-native-audio-preview-12-2025",
            "chat_prompt",
            List.of(
                Map.of("role", "system", "content", "Answer with audio."),
                Map.of(
                    "role",
                    "user",
                    "content",
                    List.of(
                        Map.of("type", "text", "text", "Realtime question"),
                        Map.of("type", "audio", "data", "AAAA", "format", "pcm16", "sampleRate", 16000)))),
            "audio",
            Map.of("output", Map.of("transcript", true, "voice", "Kore")));
    List<Object> geminiEvents =
        List.of(
            Map.of("id", "gemini_live_1", "serverContent", Map.of("outputTranscription", Map.of("text", "spoken "))),
            Map.of(
                "id",
                "gemini_live_2",
                "serverContent",
                Map.of(
                    "modelTurn",
                    Map.of("parts", List.of(Map.of("inlineData", Map.of("data", "AQI=", "mimeType", "audio/pcm")))))),
            Map.of(
                "id",
                "gemini_live_3",
                "toolCall",
                Map.of("functionCalls", List.of(Map.of("name", "lookup", "args", Map.of("q", "ax"))))),
            Map.of(
                "id",
                "gemini_live_done",
                "serverContent",
                Map.of("turnComplete", true),
                "usageMetadata",
                Map.of("promptTokenCount", 3, "candidatesTokenCount", 4, "totalTokenCount", 7)));

    System.out.println("grok setup:");
    System.out.println(Json.stringify(grok.realtimeAudioSetup(grokRequest)));
    System.out.println("grok normalized events:");
    System.out.println(Json.stringify(grok.realtime(grokEvents)));
    System.out.println("gemini setup:");
    System.out.println(Json.stringify(gemini.realtimeAudioSetup(geminiRequest)));
    System.out.println("gemini input messages:");
    System.out.println(Json.stringify(gemini.realtimeAudioInput(geminiRequest)));
    System.out.println("gemini normalized events:");
    System.out.println(Json.stringify(gemini.realtime(geminiEvents)));
  }
}
