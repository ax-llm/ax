import dev.axllm.ax.*;
import java.util.*;

public final class AgentPlaybookExample {
  // The actor returns model-authored Python code and a real runtime executes it.
  // Each stage answers in its own output format: the actor's code as JSON, and
  // the responder, weakness miner, reflector and curator as field lines.
  static final class ScriptedClient implements AiClient {
    static boolean outputs(Map<String, Object> request, String key) {
      return Json.stringify(request.get("chat_prompt")).contains("(wire key: " + (char) 96 + key + (char) 96 + ")");
    }

    public Map<String, Object> complete(Map<String, Object> request) {
      String content;
      if (outputs(request, "pythonCode")) {
        content = "{\"pythonCode\":\"final('Answer', {'answer': 'Ax composes typed LLM programs.'})\"}";
      } else if (outputs(request, "weaknessDescription")) {
        content = "Weakness Description: The agent does not verify its final step.\n"
            + "Root Cause: The final step is accepted without a check.\n"
            + "Proposed Guidance: Verify the final step before completing the task.\n"
            + "Evidence Quotes: [\"final\", \"snapshot\", \"Answer\"]\n"
            + "Config Recommendations: []";
      } else if (outputs(request, "errorIdentification")) {
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

  static final class Runtime implements AxCodeRuntime {
    public String language() { return "Python"; }
    public AxCodeSession createSession(Map<String, Object> globals, Map<String, Object> options) {
      return new AxCodeSession() {
        public Object execute(String code, Map<String, Object> executeOptions) {
          if (code.contains("pythonCode")) throw new RuntimeException("runtime received a response wrapper instead of code");
          return AxRuntimeEnvelope.finalPayload(Map.of("answer", "Ax composes typed LLM programs."));
        }
        public Object snapshotGlobals(Map<String, Object> options) {
          return Map.of("version", 1, "bindings", Map.of(), "globals", Map.of(), "closed", false);
        }
        public Object patchGlobals(Object snapshot, Map<String, Object> options) { return snapshot; }
        public Object close() { return Map.of("closed", true); }
      };
    }
  }

  public static void main(String[] args) {
    ScriptedClient client = new ScriptedClient();
    Runtime runtime = new Runtime();
    // agent.playbook() binds an evolving context playbook to an agent stage. The
    // "responder" target grows the user-facing answer stage; ACE remains an
    // implementation detail behind playbook(), just as optimize() hides GEPA.
    AxAgent agent = Ax.agent("question:string -> answer:string", Map.of(
        "name", "qa", "description", "Answer the question.", "ai", client, "runtime", runtime));

    AxPlaybook pb = agent.playbook(Map.of("target", "responder", "studentAI", client, "maxEpochs", 1));
    Map<String, Object> dataset = Map.of(
        "train", List.of(Map.of("input", Map.of("question", "Answer briefly."), "score", 0)));

    // A zero minimum gain exercises verified acceptance. A positive minimum gain
    // rejects the same flat score and must restore the exact pre-proposal snapshot.
    Map<String, Object> accepted = pb.evolve(dataset, Map.of(
        "verify", true, "minHeldInGain", 0, "maxProposals", 1, "maxMetricCalls", 2));
    String beforeRejection = Json.stringify(pb.toJson());
    Map<String, Object> rejected = pb.evolve(dataset, Map.of(
        "verify", true, "minHeldInGain", 0.1, "maxProposals", 1, "maxMetricCalls", 2));
    String afterRejection = Json.stringify(pb.toJson());

    Map<?, ?> acceptedOutcome = (Map<?, ?>) ((List<?>) accepted.get("outcomes")).get(0);
    Map<?, ?> rejectedOutcome = (Map<?, ?>) ((List<?>) rejected.get("outcomes")).get(0);
    if (((Number) accepted.get("metricCallsUsed")).intValue() != 2 || !Boolean.TRUE.equals(acceptedOutcome.get("accepted"))) {
      throw new RuntimeException("verified acceptance failed: " + accepted);
    }
    if (((Number) rejected.get("metricCallsUsed")).intValue() != 2 || !Boolean.FALSE.equals(rejectedOutcome.get("accepted"))) {
      throw new RuntimeException("verified rejection failed: " + rejected);
    }
    if (!afterRejection.equals(beforeRejection)) throw new RuntimeException("rejected proposal was not rolled back exactly");
    if (!pb.toJson().containsKey("playbook")) throw new RuntimeException("missing playbook: " + pb.toJson());
    System.out.println("accepted: " + acceptedOutcome);
    System.out.println("rejected: " + rejectedOutcome);
    System.out.println("java-agent-playbook-ok");
  }
}
