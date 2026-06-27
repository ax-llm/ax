import dev.axllm.ax.*;
import java.util.*;

public final class ProviderStreamNoKeyExample {
  public static void main(String[] args) throws Exception {
    OpenAICompatibleClient.Transport transport = request -> Map.of(
      "status", 200,
      "body", "data: {\"id\":\"chatcmpl_stream\",\"model\":\"gpt-5.4-mini\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"hel\"}}]}\n\n"
        + "data: {\"id\":\"chatcmpl_stream\",\"model\":\"gpt-5.4-mini\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"lo\"},\"finish_reason\":\"stop\"}]}\n\n"
        + "data: [DONE]\n\n"
    );
    OpenAICompatibleClient client = new OpenAICompatibleClient(Map.of(
      "api_key", "test-key",
      "model", "gpt-5.4-mini",
      "transport", transport
    ));
    StringBuilder text = new StringBuilder();
    for (Map<String, Object> event : client.stream(Map.of("chat_prompt", List.of(Map.of("role", "user", "content", "stream"))))) {
      List<?> results = (List<?>) event.get("results");
      Object content = ((Map<?, ?>) results.get(0)).get("content");
      if (content != null) text.append(content);
    }
    if (!"hello".contentEquals(text)) throw new RuntimeException("bad stream: " + text);
    System.out.println("java-provider-stream-no-key " + text);
  }
}
