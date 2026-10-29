// ax-example:start
// title: Java GEPA Optimization
// group: optimization
// description: Scores real OpenAI predictions before and after GEPA instruction search.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: intermediate
// order: 20
// ax-example:end
import dev.axllm.ax.*;
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

  static AxAIService client() {
    return Ax.ai("openai",
        Map.of("api_key", apiKey(), "model", System.getenv().getOrDefault("AX_OPENAI_MODEL", "gpt-6-luna")));
  }

  static Map<String, Object> task(String text, String priority) {
    return Map.of("input", Map.of("emailText", text), "expectedOutput", Map.of("priority", priority));
  }

  @SuppressWarnings("unchecked")
  static Map<String, Object> map(Object value) {
    return value instanceof Map<?, ?> ? (Map<String, Object>) value : Map.of();
  }

  static final class PriorityEvaluator implements OptimizerEvaluator {
    final AxGen program;
    final AxAIService client;
    PriorityEvaluator(AxGen program, AxAIService client) { this.program = program; this.client = client; }
    public Map<String, Object> evaluate(Map<String, Object> candidateMap, Map<String, Object> options) {
      var result = program.evaluateOptimization(client, options.get("dataset"), candidateMap, options);
      double sum = 0;
      var rows = (List<?>) result.get("rows");
      for (Object item : rows) {
        var row = map(item);
        var expected = map(map(row.get("input")).get("expectedOutput"));
        var output = map(map(row.get("prediction")).get("output"));
        double score = Objects.equals(output.get("priority"), expected.get("priority")) ? 1 : 0;
        row.put("scores", Map.of("accuracy", score));
        row.put("scalar", score);
        sum += score;
      }
      result.put("avg", sum / rows.size());
      return result;
    }
  }

  public static void main(String[] args) throws Exception {
    AxAIService student = client();
    AxGen program = Ax.ax("emailText:string -> priority:class \"high, normal, low\", rationale:string", Map.of("id", "priority", "instruction", "Classify the email priority."), null);
    Map<String, Object> baseline = program.forward(student, Map.of("emailText", "Production checkout is failing for enterprise customers."));
    Map<String, Object> request = Map.of(
        "programKind", "axgen", "components", program.getOptimizableComponents(),
        "dataset", Map.of("train", List.of(task("URGENT: checkout is down", "high"), task("Weekly product newsletter", "low")),
            "validation", List.of(task("Production payments are failing", "high"), task("Optional community meetup invite", "low"))),
        "options", Map.of("numTrials", 1, "minibatchSize", 2, "maxMetricCalls", 12, "bootstrap", false, "seed", 7));
    var artifact = new AxGEPA(student, Map.of("seed", 7)).optimize(request, new PriorityEvaluator(program, student));
    double original = ((Number) artifact.get("baselineScore")).doubleValue();
    double best = ((Number) map(artifact.get("metadata")).get("bestScore")).doubleValue();
    System.out.println(Json.stringify(Map.of("baselinePrediction", baseline, "baselineScore", original,
        "baselineScores", artifact.get("baselineScores"), "optimizedScore", best, "delta", best - original)));
  }
}
