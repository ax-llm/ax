// ax-example:start
// title: Java Contextual Generation
// group: generation
// description: Answers from supplied context and returns compact citations with OpenAI.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: advanced
// order: 30
// ax-example:end
import dev.axllm.ax.*;
import java.nio.file.*;
import java.util.*;

public final class ContextGenerationExample {
  static String apiKey() {
    String apiKey = System.getenv("OPENAI_API_KEY");
    if (apiKey == null || apiKey.isBlank()) apiKey = System.getenv("OPENAI_APIKEY");
    if (apiKey == null || apiKey.isBlank()) {
      throw new IllegalStateException("Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.");
    }
    return apiKey;
  }

  static OpenAICompatibleClient client() {
    return new OpenAICompatibleClient(
        Map.of("api_key", apiKey(), "model", System.getenv().getOrDefault("AX_OPENAI_MODEL", "gpt-5.4-mini"), "model_config", Map.of("temperature", 0.0)));
  }

  public static void main(String[] args) throws Exception {
    AxGen program = Ax.ax("context:string, question:string -> answer:string, citations:string[]");
    Map<String, Object> output = program.forward(client(), Map.of("context", "Ax uses signatures, ai(), ax(), agent(), flow(), and optimize().", "question", "How should a new developer think about Ax?"));
    System.out.println(Json.stringify(output));
  }
}
