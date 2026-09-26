import dev.axllm.ax.*;
import java.util.*;
import java.util.function.Function;

public final class ACEPlaybookExample {
  // A scripted client stands in for a real provider so this example runs without
  // a key. Swap it for Ax.ai("openai", ...) to grow a playbook against a live
  // model. Each program answers in its own output format, chosen by the output
  // wire keys in its prompt: the bound program, then the playbook's reflector and
  // curator, so the full ACE loop is exercised offline.
  static final class ScriptedClient implements AiClient {
    static boolean outputs(Map<String, Object> request, String key) {
      return Json.stringify(request.get("chat_prompt")).contains("(wire key: " + (char) 96 + key + (char) 96 + ")");
    }

    public Map<String, Object> complete(Map<String, Object> request) {
      String content;
      if (outputs(request, "errorIdentification")) {
        content = "Reasoning: The playbook lacked a brevity rule.\n"
            + "Error Identification: Answer was too verbose.\n"
            + "Root Cause Analysis: No guidance on conciseness.\n"
            + "Correct Approach: Add a concise-answer guideline.\n"
            + "Key Insight: Prefer one-sentence answers.\n"
            + "Bullet Tags: []";
      } else if (outputs(request, "operations")) {
        content = "Reasoning: The playbook lacked a brevity rule.\n"
            + "Operations: [{\"type\":\"ADD\",\"section\":\"Guidelines\",\"content\":\"Answer in one concise sentence.\"}]";
      } else {
        content = "Answer: Ax composes typed LLM programs.";
      }
      return Map.of("content", content);
    }
  }

  public static void main(String[] args) {
    ScriptedClient client = new ScriptedClient();
    AxGen program = Ax.ax("question:string -> answer:string");
    program.setInstruction("Answer the question.");

    AxPlaybook pb = Ax.playbook(program, Map.of("studentAI", client, "maxEpochs", 1));

    Function<Map<String, Object>, Object> metric = a -> {
      Object prediction = a.get("prediction");
      if (prediction instanceof Map<?, ?> map) {
        Object answer = map.get("answer");
        if (answer instanceof String s && !s.isEmpty()) return 1.0;
      }
      return 0.0;
    };

    List<Object> examples = List.of(Map.of("question", "What is Ax?"), Map.of("question", "Why typed signatures?"));
    Map<String, Object> result = pb.evolve(examples, metric, Map.of());
    String rendered = pb.render();
    Map<String, Object> state = pb.toJson();
    if (!result.containsKey("bestScore")) throw new RuntimeException("missing bestScore: " + result);
    if (!state.containsKey("playbook")) throw new RuntimeException("missing playbook: " + state);
    if (!rendered.contains("Answer in one concise sentence.")) throw new RuntimeException("playbook did not grow: " + rendered);
    System.out.println("rendered: " + rendered);
    System.out.println("java-ace-playbook-ok");
  }
}
