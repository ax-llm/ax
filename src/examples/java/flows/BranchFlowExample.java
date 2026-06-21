// ax-example:start
// title: Java Branching Flow
// group: flows
// description: Routes a classification through follow-up flow logic backed by OpenAI.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: intermediate
// order: 20
// ax-example:end
import dev.axllm.ax.*;
import java.nio.file.*;
import java.util.*;

public final class BranchFlowExample {
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
    AxGen step = Ax.ax("request:string -> route:class "support, sales, engineering"");
    AxFlow program =
        Ax.flow(Map.of("id", "examples.branchFlow"))
            .execute("step", step)
            .map("note", state -> Map.of("note", "Mapped flow state after the provider-backed step."))
            .returns(Map.of("step", "step", "note", "note"));
    Map<String, Object> output = program.forward(client(), Map.of("request", "A customer says checkout is down for their enterprise account."));
    System.out.println(Json.stringify(output));
  }
}
