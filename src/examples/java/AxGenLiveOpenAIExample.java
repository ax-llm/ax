import dev.axllm.ax.*;
import java.util.*;

public final class AxGenLiveOpenAIExample {
  public static void main(String[] args) {
    String apiKey = System.getenv("OPENAI_API_KEY");
    if (apiKey == null || apiKey.isBlank()) {
      apiKey = System.getenv("OPENAI_APIKEY");
    }
    if (apiKey == null || apiKey.isBlank()) {
      throw new IllegalStateException("Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.");
    }

    OpenAICompatibleClient client = new OpenAICompatibleClient(Map.of(
      "api_key", apiKey,
      "model", System.getenv().getOrDefault("AX_LIVE_MODEL", "gpt-4.1-mini"),
      "model_config", Map.of("temperature", 0.0)
    ));

    AxGen program = Ax.ax("question:string -> answer:string");
    Map<String, Object> output = program.forward(client, Map.of(
      "question", "In one sentence, explain Ax as a language-agnostic LLM programming library."
    ));

    System.out.println(output);
  }
}
