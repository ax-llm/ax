import dev.axllm.ax.*;
import java.util.*;

public final class GEPALocalOptimizerExample {
  static final class LocalEvaluator implements OptimizerEvaluator {
    public Map<String, Object> evaluate(Map<String, Object> candidateMap, Map<String, Object> options) {
      String instruction = String.valueOf(candidateMap.getOrDefault("qa::instruction", ""));
      List<?> examples = (List<?>) ((Map<?, ?>) options.get("dataset")).get("train");
      List<Map<String, Object>> rows = new ArrayList<>();
      double total = 0;
      for (Object example : examples) {
        double quality = instruction.toLowerCase(Locale.ROOT).contains("concise") ? 0.9 : 0.65;
        double brevity = 0.8;
        double scalar = (quality + brevity) / 2.0;
        total += scalar;
        rows.add(
            Map.of(
                "input",
                example,
                "prediction",
                Map.of("answer", "Ax composes typed LLM programs."),
                "scores",
                Map.of("quality", quality, "brevity", brevity),
                "scalar",
                scalar));
      }
      return Map.of("rows", rows, "avg", total / rows.size(), "sum", total, "count", rows.size());
    }
  }

  public static void main(String[] args) {
    Map<String, Object> request =
        Map.of(
            "programKind",
            "axgen",
            "components",
            List.of(
                Map.of(
                    "id",
                    "qa::instruction",
                    "owner",
                    "qa",
                    "kind",
                    "instruction",
                    "current",
                    "Answer clearly and concisely.")),
            "dataset",
            Map.of(
                "train",
                List.of(Map.of("question", "What is Ax?"), Map.of("question", "Why use typed signatures?")),
                "validation",
                List.of(Map.of("question", "Summarize Ax."))),
            "options",
            Map.of("numTrials", 0, "maxMetricCalls", 8, "seed", 7));

    Map<String, Object> artifact = new AxGEPA(null, Map.of("seed", 7)).optimize(request, new LocalEvaluator());
    System.out.println(
        Json.stringify(
            Map.of("componentMap", artifact.get("componentMap"), "metadata", artifact.get("metadata"))));
  }
}
