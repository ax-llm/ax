import dev.axllm.ax.*;
import java.util.*;

public final class VertexGeminiExample {
  private static String required(String name) {
    String value = System.getenv(name);
    if (value == null || value.isBlank()) {
      throw new IllegalStateException("Set " + name + " to run this Vertex provider API example.");
    }
    return value;
  }

  public static void main(String[] args) throws Exception {
    GoogleGeminiClient client = new GoogleGeminiClient(Map.of(
      "api_key", required("GOOGLE_VERTEX_ACCESS_TOKEN"),
      "project_id", required("GOOGLE_PROJECT_ID"),
      "region", required("GOOGLE_REGION"),
      "model", System.getenv().getOrDefault("AX_VERTEX_MODEL", "gemini-3.5-flash")
    ));
    Map<String, Object> out = client.chat(Map.of(
      "chat_prompt", List.of(Map.of("role", "user", "content", "Reply with the word ready."))
    ));
    System.out.println(Json.stringify(out));
  }
}
