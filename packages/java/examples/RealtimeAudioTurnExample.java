import dev.axllm.ax.*;
import java.util.*;

// Drive a realtime audio TURN through the productized realtimeChat driver using
// ScriptedRealtimeTransport: the deterministic, credential-free path that
// exercises the full send-setup -> send-input -> fold -> merge loop without a
// live socket (the live socket path is verified separately against the real
// API). Exits non-zero on any mismatch so `axir verify` fails if it regresses.
public final class RealtimeAudioTurnExample {
  public static void main(String[] args) {
    OpenAICompatibleClient client =
        (OpenAICompatibleClient) Ax.ai("grok", Map.of("model", "grok-voice-think-fast-1.0", "api_key", "test-key"));
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
    OpenAICompatibleClient meta = (OpenAICompatibleClient) Ax.ai("meta", Map.of("model", "muse-voice-transcribe-1.0", "api_key", "test-key"));
    Map<String, Object> metaRequest = Map.of(
        "model", "muse-voice-transcribe-1.0",
        "chat_prompt", List.of(Map.of("role", "user", "content", List.of(Map.of("type", "audio", "data", "AAE=", "format", "pcm16")))),
        "audio", Map.of("input", Map.of("sampleRate", 16000, "channels", 1)),
        "model_config", Map.of("realtimeTranscription", Map.of("partialMode", "delta")));
    OpenAICompatibleClient.ScriptedRealtimeTransport metaTransport = new OpenAICompatibleClient.ScriptedRealtimeTransport(List.of(
        Map.of("sessionId", "meta-session"),
        Map.of("type", "speechStart", "turnId", "one"),
        Map.of("type", "transcript", "transcript", "Hello"),
        Map.of("type", "transcript", "transcript", " world"),
        Map.of("type", "speaker", "speaker", "A"),
        Map.of("type", "speechStart", "turnId", "two"),
        Map.of("type", "transcript", "transcript", "Second"),
        Map.of("type", "speechComplete", "turnId", "one", "transcript", "Hello world!"),
        Map.of("type", "speechComplete", "turnId", "two", "transcript", "Second turn")));
    Map<String, Object> metaFinal = meta.realtimeChat(metaRequest, metaTransport);
    List<?> metaResults = (List<?>) metaFinal.get("results");
    if (!"meta-session".equals(metaFinal.get("remote_session_id")) || metaResults.size() != 2 || !"Hello world!".equals(((Map<?, ?>) metaResults.get(0)).get("content")) || !"Second turn".equals(((Map<?, ?>) metaResults.get(1)).get("content"))) fail("Meta overlapping turns or session lost", metaFinal);
    if (metaTransport.sent.size() != 3 || !"binary".equals(metaTransport.sent.get(1).get("type")) || !"endStream".equals(metaTransport.sent.get(2).get("type"))) fail("Meta input order", metaTransport.sent);
    OpenAICompatibleClient.RealtimeTransport duplex = new OpenAICompatibleClient.RealtimeTransport() {
      final java.util.concurrent.BlockingQueue<Map<String, Object>> frames = new java.util.concurrent.LinkedBlockingQueue<>();
      volatile boolean ended = false;
      int chunks = 0;
      public void send(Map<String, Object> event) {
        if (event.containsKey("authorization")) frames.offer(Map.of("sessionId", "duplex"));
        else if ("binary".equals(event.get("type")) && ++chunks == 1) frames.offer(Map.of("type", "transcript", "transcript", "wrong hypothesis"));
        else if ("endStream".equals(event.get("type"))) { ended = true; frames.offer(Map.of("type", "transcript", "transcript", "Correct final.", "final", true)); frames.offer(Map.of()); }
      }
      public Map<String, Object> recv() {
        try {
          Map<String, Object> event = frames.poll(3, java.util.concurrent.TimeUnit.SECONDS);
          if (event == null) throw new IllegalStateException("duplex receiver timed out");
          if ("wrong hypothesis".equals(event.get("transcript")) && ended) throw new IllegalStateException("partial delayed until endStream");
          return event.isEmpty() ? null : event;
        } catch (InterruptedException error) { Thread.currentThread().interrupt(); throw new IllegalStateException(error); }
      }
      public void close() { frames.offer(Map.of()); }
    };
    Map<String, Object> duplexRequest = new LinkedHashMap<>(metaRequest);
    duplexRequest.put("model_config", Map.of());
    duplexRequest.put("chat_prompt", List.of(Map.of("role", "user", "content", List.of(Map.of("type", "audio", "format", "pcm16", "data", Base64.getEncoder().encodeToString(new byte[9600]))))));
    Map<String, Object> duplexResult = meta.realtimeChat(duplexRequest, duplex);
    if (!"Correct final.".equals(((Map<?, ?>)((List<?>)duplexResult.get("results")).get(0)).get("content"))) fail("duplex final lost", duplexResult);
    OpenAICompatibleClient.RealtimeTransport earlyClose = new OpenAICompatibleClient.RealtimeTransport() {
      final java.util.concurrent.BlockingQueue<Map<String, Object>> frames = new java.util.concurrent.LinkedBlockingQueue<>();
      public void send(Map<String, Object> event) {
        if (event.containsKey("authorization")) frames.offer(Map.of("sessionId", "early"));
        else if ("binary".equals(event.get("type"))) frames.offer(Map.of());
      }
      public Map<String, Object> recv() {
        try {
          Map<String, Object> event = frames.poll(3, java.util.concurrent.TimeUnit.SECONDS);
          if (event == null) throw new IllegalStateException("early-close receiver timed out");
          return event.isEmpty() ? null : event;
        } catch (InterruptedException error) { Thread.currentThread().interrupt(); throw new IllegalStateException(error); }
      }
      public void close() { frames.offer(Map.of()); }
    };
    try {
      meta.realtimeChat(duplexRequest, earlyClose);
      fail("early close accepted an incomplete upload", Map.of());
    } catch (RuntimeException error) {
      if (!error.getMessage().contains("closed before audio upload completed")) throw error;
    }
    AxMemory memory = new AxMemory();
    memory.updateResult(Map.of("thought_blocks", List.of(Map.of("id", "r", "data", "Plan")), "images", List.of(Map.of("id", "image", "data", "partial"))));
    memory.updateResult(Map.of("thought_blocks", List.of(Map.of("id", "r", "data", "Plan.", "summary", "Plan.", "encrypted_content", "opaque"))));
    String replay = Json.stringify(memory.getLast());
    if (!replay.contains("opaque") || !replay.contains("image") || replay.contains("PlanPlan")) fail("replay metadata lost", replay);
    System.out.println("realtime-audio-turn-ok");
  }

  private static void fail(String message, Object detail) {
    System.out.println("realtime-audio-turn FAIL: " + message + " " + detail);
    System.exit(1);
  }
}
