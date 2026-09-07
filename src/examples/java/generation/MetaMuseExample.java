// ax-example:start
// title: Java Meta Muse Spark
// group: generation
// description: Selects any of Meta's three protocols through the existing chat API.
// provider: meta
// env: MODEL_API_KEY
// level: beginner
// order: 52
// ax-example:end
import dev.axllm.ax.*;
import java.util.*;

public final class MetaMuseExample {
  public static void main(String[] args) throws Exception {
    String key = System.getenv("MODEL_API_KEY");
    if (key == null || key.isBlank()) throw new IllegalStateException("Set MODEL_API_KEY to run this example.");
    for (String profile : List.of("meta", "meta-chat", "meta-messages")) {
      var client = Ax.ai(profile, Map.of("api_key", key, "model", "muse-spark-1.3"));
      var response = client.chat(Map.of(
          "chat_prompt", List.of(Map.of("role", "user", "content", "Name a solar-powered sailboat.")),
          "model_config", Map.of("thinking_token_budget", "highest")));
      System.out.println(profile + " " + Json.stringify(response));
    }
  }
}
