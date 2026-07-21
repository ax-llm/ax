// ax-example:start
// title: Java Refinement Flow
// group: flows
// description: Drafts, critiques, and revises an answer through three OpenAI-backed steps.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: advanced
// order: 50
// ax-example:end
import dev.axllm.ax.*;
import java.util.*;

public final class RefineFlowExample {
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
    AxGen draft = Ax.ax("topicText:string -> draftText:string");
    AxGen critique = Ax.ax("draftText:string -> critiqueText:string");
    AxGen revise = Ax.ax("draftText:string, critiqueText:string -> revisedText:string");
    AxFlow program =
        Ax.flow(Map.of("id", "examples.refineFlow"))
            .execute(
                "draft",
                draft,
                Map.of(
                    "reads", List.of("topicText"),
                    "writes", List.of("draftResult", "draftText")))
            .execute(
                "critique",
                critique,
                Map.of(
                    "reads", List.of("draftText"),
                    "writes", List.of("critiqueResult", "critiqueText")))
            .execute(
                "revise",
                revise,
                Map.of(
                    "reads", List.of("draftText", "critiqueText"),
                    "writes", List.of("reviseResult", "revisedText")))
            .returns(Map.of("revisedText", "revisedText"));
    Map<String, Object> output =
        program.forward(
            client(),
            Map.of("topicText", "Explain automatic flow parallelism to a backend engineer."));
    System.out.println(Json.stringify(output));
  }
}
