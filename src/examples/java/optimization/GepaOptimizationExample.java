// ax-example:start
// title: Java GEPA Optimization
// group: optimization
// description: Pairs a real OpenAI baseline with a local GEPA optimization pass.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: intermediate
// order: 20
// ax-example:end
import dev.axllm.ax.*;
import java.nio.file.*;
import java.util.*;

public final class GepaOptimizationExample {
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
        Map.of("api_key", apiKey(), "model", System.getenv().getOrDefault("AX_OPENAI_MODEL", "gpt-4.1-mini"), "model_config", Map.of("temperature", 0.0)));
  }

  static final class LocalEvaluator implements OptimizerEvaluator {
    public Map<String, Object> evaluate(Map<String, Object> candidateMap, Map<String, Object> options) {
      return Map.of("rows", List.of(Map.of("prediction", Map.of("answer", "Ax composes typed LLM programs."), "scores", Map.of("quality", 0.9), "scalar", 0.9)), "avg", 0.9, "count", 1);
    }
  }

  public static void main(String[] args) throws Exception {
    AxGen program = new AxGen(Ax.s("emailText:string -> priority:class \"high, normal, low\", rationale:string"), Map.of("id", "priority", "instruction", "Classify the email priority."));
    Map<String, Object> baseline = program.forward(client(), Map.of("emailText", "Production checkout is failing for enterprise customers."));
    Map<String, Object> request = Map.of("programKind", "axgen", "components", List.of(Map.of("id", "priority::instruction", "owner", "priority", "kind", "instruction", "current", "Classify priority clearly.")), "dataset", Map.of("train", List.of(Map.of("emailText", "URGENT: checkout is down"))), "options", Map.of("numTrials", 0, "maxMetricCalls", 4, "seed", 7));
    Map<String, Object> artifact = new AxGEPA(null, Map.of("seed", 7)).optimize(request, new LocalEvaluator());
    System.out.println(Json.stringify(Map.of("baseline", baseline, "artifact", artifact)));
  }
}
