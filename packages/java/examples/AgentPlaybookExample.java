import dev.axllm.ax.*;
import java.util.*;
import java.util.function.Function;

public final class AgentPlaybookExample {
  // A scripted client stands in for a real provider so this example runs without
  // a key. Swap it for Ax.ai("openai", ...) to grow a playbook against a live
  // model. The canned JSON satisfies the agent's bound stage AND the playbook's
  // internal reflector/curator sub-programs, so the full ACE loop is exercised
  // offline.
  static final class ScriptedClient implements AiClient {
    public Map<String, Object> complete(Map<String, Object> request) {
      String content = "{"
          + "\"answer\":\"Ax composes typed LLM programs.\","
          + "\"reasoning\":\"The playbook lacked a brevity rule.\","
          + "\"errorIdentification\":\"Answer was too verbose.\","
          + "\"rootCauseAnalysis\":\"No guidance on conciseness.\","
          + "\"correctApproach\":\"Add a concise-answer guideline.\","
          + "\"keyInsight\":\"Prefer one-sentence answers.\","
          + "\"bulletTags\":[],"
          + "\"operations\":[{\"type\":\"ADD\",\"section\":\"Guidelines\",\"content\":\"Answer in one concise sentence.\"}]"
          + "}";
      return Map.of("content", content);
    }
  }

  public static void main(String[] args) {
    ScriptedClient client = new ScriptedClient();
    // agent.playbook() binds an evolving context playbook to an agent stage. The
    // "responder" target grows the user-facing answer stage; ACE remains an
    // implementation detail behind playbook(), just as optimize() hides GEPA.
    AxAgent agent = Ax.agent("question:string -> answer:string", Map.of("name", "qa", "description", "Answer the question.", "ai", client));

    AxPlaybook pb = agent.playbook(Map.of("target", "responder", "studentAI", client, "maxEpochs", 1));

    Function<Map<String, Object>, Object> metric = a -> {
      Object prediction = a.get("prediction");
      if (prediction instanceof Map<?, ?> map) {
        Object answer = map.get("answer");
        if (answer instanceof String s && !s.isEmpty()) return 1.0;
      }
      return 0.0;
    };

    List<Object> examples = List.of(
        Map.of("question", "What is Ax?", "contextData", Map.of()),
        Map.of("question", "Why typed signatures?", "contextData", Map.of()));
    Map<String, Object> result = pb.evolve(examples, metric, Map.of());
    String rendered = pb.render();
    Map<String, Object> state = pb.toJson();
    if (!result.containsKey("bestScore")) throw new RuntimeException("missing bestScore: " + result);
    if (!state.containsKey("playbook")) throw new RuntimeException("missing playbook: " + state);
    System.out.println("rendered: " + rendered);
    System.out.println("java-agent-playbook-ok");
  }
}
