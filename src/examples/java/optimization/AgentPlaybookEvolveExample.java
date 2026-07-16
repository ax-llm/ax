// ax-example:start
// title: Java Agent Playbook — Learn And Verify
// group: optimization
// description: Attach a persistent playbook, add validated hidden citations and stage guidance, then mine a task set into playbook rules with a verification gate.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: advanced
// order: 42
// ax-example:end
import dev.axllm.ax.*;
import dev.axllm.ax.runtime.quickjs.*;
import java.util.*;
import java.util.function.Consumer;

public final class AgentPlaybookEvolveExample {
  static String apiKey() {
    String value = System.getenv("OPENAI_API_KEY");
    if (value == null || value.isBlank()) value = System.getenv("OPENAI_APIKEY");
    if (value == null || value.isBlank()) {
      throw new IllegalStateException("Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.");
    }
    return value;
  }

  public static void main(String[] args) throws Exception {
    OpenAICompatibleClient client = new OpenAICompatibleClient(Map.of(
        "api_key", apiKey(),
        "model", System.getenv().getOrDefault("AX_OPENAI_MODEL", "gpt-5.4-mini")));

    Map<String, Object> bullet = Map.of(
        "id", "failures-to-avoid-00001",
        "section", "failures_to_avoid",
        "content", "Check the available evidence before answering.",
        "helpfulCount", 0,
        "harmfulCount", 0,
        "createdAt", "2026-07-15T00:00:00.000Z",
        "updatedAt", "2026-07-15T00:00:00.000Z");
    Map<String, Object> seed = Map.of(
        "playbook", Map.of(
            "version", 1,
            "sections", Map.of("failures_to_avoid", List.of(bullet)),
            "updatedAt", "2026-07-15T00:00:00.000Z"),
        "artifact", Map.of("feedback", List.of(), "history", List.of()));

    List<Object> observedCitations = new ArrayList<>();
    List<Object> playbookUpdates = new ArrayList<>();
    Consumer<List<Object>> citationObserver = observedCitations::add;
    Consumer<Map<String, Object>> playbookObserver = playbookUpdates::add;
    AxAgent assistant = Ax.agent(
        "question:string -> answer:string",
        Map.of(
            "ai", client,
            "contextFields", List.of(),
            "runtime", Map.of("language", "JavaScript"),
            "playbook", Map.of("seed", seed, "onUpdate", playbookObserver),
            "citations", Map.of("surface", "hidden", "onCitations", citationObserver)));
    assistant
        .setInstruction("Answer from evidence and state uncertainty plainly.")
        .addActorInstruction("Before finishing, verify the answer against the collected evidence.");

    try (AxQuickJsCodeRuntime runtime = new AxQuickJsCodeRuntime()) {
      Map<String, Object> answer = assistant.forward(
          client,
          Map.of("question", "What should a support agent verify before answering?"),
          Map.of("runtime", runtime, "max_actor_steps", 8));

      Map<String, Object> dataset = Map.of(
          "train", List.of(Map.of(
              "input", Map.of("question", "Give a concise evidence-first answer."),
              "score", 0)));
      Map<String, Object> evolution = assistant.playbook(null).evolve(
          dataset,
          Map.of("verify", true, "maxProposals", 1, "runtime", runtime));

      System.out.println(Json.pretty(answer));
      System.out.println("citations: " + (observedCitations.isEmpty() ? List.of() : observedCitations.get(observedCitations.size() - 1)));
      System.out.println("run-end updates: " + playbookUpdates.size());
      System.out.println("outcomes: " + evolution.get("outcomes"));
      System.out.println(assistant.getPlaybook().render());
    }
  }
}
