// ax-example:start
// title: Java Parallel Flow
// group: flows
// description: Runs two independent OpenAI-backed steps in parallel before joining their results.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: intermediate
// order: 40
// ax-example:end
import dev.axllm.ax.*;
import java.util.*;

public final class ParallelFlowExample {
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
        Map.of(
            "api_key", apiKey(),
            "model", System.getenv().getOrDefault("AX_OPENAI_MODEL", "gpt-5.4-mini"),
            "model_config", Map.of("temperature", 0.0)));
  }

  public static void main(String[] args) throws Exception {
    AxGen research = Ax.ax("topicText:string -> factList:string[]");
    AxGen audience = Ax.ax("topicText:string -> audienceAngle:string");
    AxGen join = Ax.ax("factList:string[], audienceAngle:string -> briefText:string");
    AxFlow program =
        Ax.flow(Map.of("id", "examples.parallelFlow"))
            .execute(
                "research",
                research,
                Map.of(
                    "reads", List.of("topicText"),
                    "writes", List.of("researchResult", "factList")))
            .execute(
                "audience",
                audience,
                Map.of(
                    "reads", List.of("topicText"),
                    "writes", List.of("audienceResult", "audienceAngle")))
            .execute(
                "join",
                join,
                Map.of(
                    "reads", List.of("factList", "audienceAngle"),
                    "writes", List.of("joinResult", "briefText")))
            .returns(Map.of("briefText", "briefText"));
    Map<String, Object> output =
        program.forward(
            client(),
            Map.of(
                "topicText",
                "Why typed contracts make multi-step LLM systems easier to maintain"));
    System.out.println(Json.stringify(output));
  }
}
