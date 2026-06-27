import dev.axllm.ax.*;
import java.util.*;

public final class ProviderMappingNoKeyExample {
  public static void main(String[] args) throws Exception {
    OpenAICompatibleClient.Transport transport = request -> Map.of(
      "status", 200,
      "json", Map.of(
        "id", "chatcmpl_example",
        "model", "gpt-5.4-mini",
        "choices", List.of(Map.of(
          "index", 0,
          "finish_reason", "stop",
          "message", Map.of("content", "hello from scripted transport")
        )),
        "usage", Map.of("prompt_tokens", 1, "completion_tokens", 2, "total_tokens", 3)
      )
    );
    AxAIService service = Ax.ai("openai", Map.of("model", "gpt-5.4-mini", "api_key", "test-key", "transport", transport));
    Map<String, Object> response = service.chat(Map.of("chat_prompt", List.of(Map.of("role", "user", "content", "hello"))));
    List<?> results = (List<?>) response.get("results");
    Map<?, ?> first = (Map<?, ?>) results.get(0);
    if (!"hello from scripted transport".equals(first.get("content"))) {
      throw new RuntimeException("bad response: " + response);
    }
    System.out.println("java-axai-ok");
  }
}
