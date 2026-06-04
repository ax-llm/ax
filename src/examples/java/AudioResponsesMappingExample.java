import dev.axllm.ax.*;
import java.util.*;

public final class AudioResponsesMappingExample {
  public static void main(String[] args) throws Exception {
    List<Map<String, Object>> transportRequests = new ArrayList<>();
    OpenAICompatibleClient.Transport transport =
        request -> {
          transportRequests.add(new LinkedHashMap<>(request));
          String url = String.valueOf(request.get("url"));
          if (url.endsWith("/audio/speech")) {
            return Map.of("status", 200, "json", Map.of("audio", "base64-speech"));
          }
          if (url.endsWith("/audio/transcriptions")) {
            return Map.of(
                "status",
                200,
                "json",
                Map.of("text", "hello world", "language", "en", "duration", 1.25));
          }
          throw new RuntimeException("unexpected request: " + request);
        };

    OpenAIResponsesClient client =
        new OpenAIResponsesClient(Map.of("api_key", "test-key", "transport", transport));
    Map<String, Object> speech =
        client.speak(Map.of("text", "hello", "voice", "alloy", "format", "mp3"));
    Map<String, Object> transcript =
        client.transcribe(
            Map.of("audio", "base64-audio", "language", "en", "model", "whisper-1", "format", "json"));

    System.out.println("normalized output:");
    System.out.println(Json.stringify(Map.of("speak", speech, "transcribe", transcript)));
    System.out.println("transport requests:");
    System.out.println(Json.stringify(transportRequests));
  }
}
