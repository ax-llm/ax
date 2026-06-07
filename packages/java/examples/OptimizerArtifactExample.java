import dev.axllm.ax.*;
import java.util.*;

public final class OptimizerArtifactExample {
  static final class ScriptedOptimizer implements OptimizerEngine {
    public String name() { return "fixture"; }
    public String version() { return "1"; }
    public Map<String, Object> optimize(Map<String, Object> request) {
      return Map.of(
        "componentMap", Map.of("qa::instruction", "Prefer artifact-backed answers."),
        "metadata", Map.of(
          "evidence", Map.of("avg", 1),
          "provenance", Map.of("sourceProgramKind", "axgen")
        )
      );
    }
  }

  static boolean hasInstruction(AxGen gen, String value) {
    for (Map<String, Object> item : gen.getOptimizableComponents()) {
      if ("qa::instruction".equals(item.get("id")) && value.equals(item.get("current"))) return true;
    }
    return false;
  }

  public static void main(String[] args) {
    AxGen qa = new AxGen(Ax.s("question:string -> answer:string"), Map.of("id", "qa", "instruction", "Base."));
    Map<String, Object> artifact = qa.optimizeWith(new ScriptedOptimizer(), List.of(), Map.of("apply", false));
    if (!hasInstruction(qa, "Base.")) throw new RuntimeException("apply=false mutated components");
    qa.applyOptimization(Json.stringify(artifact));
    if (!hasInstruction(qa, "Prefer artifact-backed answers.")) throw new RuntimeException("artifact not applied");
    System.out.println("java-optimizer-artifact-ok");
  }
}
