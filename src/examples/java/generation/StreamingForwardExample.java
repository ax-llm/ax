// ax-example:start
// title: Java Streaming Field Deltas
// group: generation
// description: Streams AxGen output as TypeScript-style {version, index, delta} field deltas and merges them as they arrive.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: intermediate
// order: 46
// ax-example:end
import dev.axllm.ax.*;
import java.util.*;

public final class StreamingForwardExample {
  public static void main(String[] args) {
    String apiKey = System.getenv("OPENAI_API_KEY");
    if (apiKey == null || apiKey.isBlank()) apiKey = System.getenv("OPENAI_APIKEY");
    if (apiKey == null || apiKey.isBlank()) throw new IllegalStateException("Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.");
    AxAIService client = Ax.ai("openai", Map.of(
        "api_key", apiKey,
        "model", System.getenv().getOrDefault("AX_OPENAI_MODEL", "gpt-5.4-mini")));
    AxGen story = Ax.ax("topic:string -> title:string, story:string \"Three short sentences\"");

    // Each delta holds the new text of one field. Merge a sample's deltas
    // (strings append, other values replace) and start over when the version
    // changes: a retry or a replaced step starts a new version.
    Map<String, Object> merged = new LinkedHashMap<>();
    int version = 0;
    try (AxGenDeltaStream stream = story.streamingForward(client, Map.of("topic", "a lighthouse keeper's cat"), Map.of())) {
      for (AxGenDelta delta : stream) {
        if (delta.version() != version) {
          merged.clear();
          version = delta.version();
          System.out.println("\n[retry: starting over]");
        }
        delta.delta().forEach((field, value) -> {
          if (merged.get(field) instanceof String previous && value instanceof String text) merged.put(field, previous + text);
          else merged.put(field, value);
          if (field.equals("story")) System.out.print(value);
        });
      }
    }
    System.out.println();
    System.out.println("Title: " + merged.get("title"));
  }
}
