import dev.axllm.ax.*;
import java.util.*;

public final class OptimizerArtifactExample {
  static final class FakeOptimizer implements OptimizerEngine {
    public String name() {
      return "fixture";
    }

    public String version() {
      return "1";
    }

    public Map<String, Object> optimize(Map<String, Object> request) {
      return Map.of(
          "componentMap",
          Map.of("qa::instruction", "Prefer artifact-backed answers."),
          "metadata",
          Map.of(
              "evidence",
              Map.of("avg", 1),
              "provenance",
              Map.of("sourceProgramKind", "axgen")));
    }
  }

  public static void main(String[] args) {
    AxGen program =
        new AxGen(Ax.s("question:string -> answer:string"), Map.of("id", "qa", "instruction", "Base."));
    Map<String, Object> artifact = program.optimizeWith(new FakeOptimizer(), List.of(), Map.of("apply", false));
    Object before = program.getOptimizableComponents();
    program.applyOptimization(Json.stringify(artifact));
    Object after = program.getOptimizableComponents();

    System.out.println(Json.stringify(Map.of("artifact", artifact, "before", before, "after", after)));
  }
}
