// ax-example:start
// title: Java Vertex Gemini Routing
// group: generation
// description: Calls Gemini through Vertex with project and multi-region routing.
// provider: google-gemini
// env: GOOGLE_VERTEX_ACCESS_TOKEN, GOOGLE_PROJECT_ID, GOOGLE_REGION
// level: intermediate
// order: 35
// ax-example:end
import dev.axllm.ax.*;
import java.util.*;

public final class VertexGeminiExample {
  private static String required(String name) {
    String value = System.getenv(name);
    if (value == null || value.isBlank()) throw new IllegalStateException("Set " + name + " to run this example.");
    return value;
  }

  public static void main(String[] args) throws Exception {
    GoogleGeminiClient client = new GoogleGeminiClient(Map.of(
        "api_key", required("GOOGLE_VERTEX_ACCESS_TOKEN"),
        "project_id", required("GOOGLE_PROJECT_ID"),
        "region", required("GOOGLE_REGION"),
        "model", System.getenv().getOrDefault("AX_VERTEX_MODEL", "gemini-3.5-flash")));
    Map<String, Object> out = client.chat(Map.of(
        "chat_prompt", List.of(Map.of("role", "user", "content", "Reply with the word ready."))));
    System.out.println(Json.stringify(out));
  }
}
