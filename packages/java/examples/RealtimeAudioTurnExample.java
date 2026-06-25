import dev.axllm.ax.*;
import java.util.*;

// Drive a realtime audio TURN through the productized realtimeChat driver using
// ScriptedRealtimeTransport: the deterministic, credential-free path that
// exercises the full send-setup -> send-input -> fold -> merge loop without a
// live socket (the live socket path is verified separately against the real
// API). Exits non-zero on any mismatch so `axir verify` fails if it regresses.
public final class RealtimeAudioTurnExample {
  public static void main(String[] args) {
    GrokClient client =
        new GrokClient(Map.of("model", "grok-voice-think-fast-1.0", "api_key", "test-key"));
    Map<String, Object> request =
        Map.of(
            "model", "grok-voice-think-fast-1.0",
            "chat_prompt",
            List.of(
                Map.of("role", "system", "content", "You are a concise voice agent."),
                Map.of("role", "user", "content", "Say hello.")),
            "audio", Map.of("output", Map.of("voice", "eve")));
    // Canned server frames: session handshake, two transcript deltas, an audio
    // delta, then the terminal response.done.
    List<Object> inbound =
        List.of(
            Map.of("type", "session.created"),
            Map.of("type", "session.updated"),
            Map.of("type", "response.output_audio_transcript.delta", "response_id", "rt", "delta", "hel"),
            Map.of("type", "response.output_audio_transcript.delta", "response_id", "rt", "delta", "lo"),
            Map.of("type", "response.output_audio.delta", "response_id", "rt", "delta", "AQI="),
            Map.of("type", "response.done", "response", Map.of("id", "rt", "usage", Map.of("input_tokens", 3, "output_tokens", 2, "total_tokens", 5))));

    OpenAICompatibleClient.ScriptedRealtimeTransport transport =
        new OpenAICompatibleClient.ScriptedRealtimeTransport(inbound);
    Map<String, Object> finalResponse = client.realtimeChat(request, transport);
    @SuppressWarnings("unchecked")
    List<Object> results = (List<Object>) finalResponse.get("results");
    @SuppressWarnings("unchecked")
    Map<String, Object> result = (Map<String, Object>) results.get(0);

    List<Object> sentTypes = new ArrayList<>();
    for (Map<String, Object> event : transport.sent) sentTypes.add(event.get("type"));
    System.out.println("driver sent: " + sentTypes);
    System.out.println("merged result: " + finalResponse);

    // The driver must send the Core-built session.update first, then the inputs.
    if (!List.of("session.update", "conversation.item.create", "response.create").equals(sentTypes)) {
      fail("unexpected sent event order", finalResponse);
    }
    // Transcript deltas concatenated, audio chunk surfaced, turn finished.
    if (!"hello".equals(result.get("content"))) fail("transcript not concatenated", finalResponse);
    if (!"stop".equals(result.get("finish_reason"))) fail("turn did not finish", finalResponse);
    Object audio = result.get("audio");
    if (!(audio instanceof Map) || !"AQI=".equals(((Map<?, ?>) audio).get("data"))) {
      fail("audio chunk not surfaced", finalResponse);
    }
    System.out.println("realtime-audio-turn-ok");
  }

  private static void fail(String message, Object detail) {
    System.out.println("realtime-audio-turn FAIL: " + message + " " + detail);
    System.exit(1);
  }
}
