// ax-example:start
// title: Java Optimization Artifact Reuse
// group: optimization
// description: Saves and reapplies an optimizer artifact after a real OpenAI baseline.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: advanced
// order: 30
// ax-example:end
import dev.axllm.ax.*;
import java.nio.file.*;
import java.util.*;

public final class ArtifactOptimizationExample {
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

  static final class ExampleOptimizer implements OptimizerEngine {
    public String name() { return "example"; }
    public String version() { return "1"; }
    public Map<String, Object> optimize(Map<String, Object> request) {
      return Map.of("componentMap", Map.of("priority::instruction", "Classify operational risk. Use high for production-impacting urgency."), "metadata", Map.of("source", "artifact"));
    }
  }

  public static void main(String[] args) throws Exception {
    AxGen program = new AxGen(Ax.s("emailText:string -> priority:class \"high, normal, low\", rationale:string"), Map.of("id", "priority", "instruction", "Classify the email priority."));
    Map<String, Object> baseline = program.forward(client(), Map.of("emailText", "Production checkout is failing for enterprise customers."));
    Map<String, Object> artifact = program.optimizeWith(new ExampleOptimizer(), List.of(Map.of("emailText", "URGENT: checkout is down", "priority", "high")), Map.of("apply", false));
    program.applyOptimization(Json.stringify(artifact));
    Map<String, Object> after = program.forward(client(), Map.of("emailText", "Production checkout is failing for enterprise customers."));
    System.out.println(Json.stringify(Map.of("baseline", baseline, "after", after)));
  }
}
