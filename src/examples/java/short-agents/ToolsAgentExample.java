// ax-example:start
// title: Java Tool-Guided Agent
// group: short-agents
// description: Uses provider reasoning plus local context to shape a concise agent answer.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: intermediate
// order: 20
// ax-example:end
import dev.axllm.ax.*;
import java.nio.file.*;
import java.util.*;

public final class ToolsAgentExample {
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

  static final class OpenAIBackedAgentClient implements AiClient {
    final OpenAICompatibleClient inner;
    String rawModelAnswer;
    int calls;

    OpenAIBackedAgentClient(OpenAICompatibleClient inner) { this.inner = inner; }

    public Map<String, Object> chat(Map<String, Object> request, Map<String, Object> options) throws Exception {
      calls += 1;
      if (rawModelAnswer == null) {
        Map<String, Object> response = inner.chat(Map.of("chat_prompt", List.of(Map.of("role", "user", "content", "Use local context to choose between generation, agents, and flows."))));
        rawModelAnswer = String.valueOf(((Map<?, ?>) ((List<?>) response.get("results")).get(0)).get("content"));
      }
      Map<String, Object> payload = Map.of("answer", rawModelAnswer);
      if (calls == 1) payload = Map.of("completion", Map.of("type", "final", "args", List.of("Answer", Map.of())));
      if (calls == 2) payload = Map.of("completion", Map.of("type", "final", "args", List.of("Answer", Map.of("answer", rawModelAnswer, "usedContext", true, "plan", List.of("Declare a signature", "Run an agent", "Optimize with examples")))));
      return Map.of("results", List.of(Map.of("content", Json.stringify(payload), "function_calls", List.of())));
    }

    public Map<String, Object> embed(Map<String, Object> request, Map<String, Object> options) { return Map.of("embeddings", List.of()); }
    public Iterable<Map<String, Object>> stream(Map<String, Object> request, Map<String, Object> options) { return List.of(); }
  }

  public static void main(String[] args) throws Exception {
    OpenAIBackedAgentClient stageClient = new OpenAIBackedAgentClient(client());
    AxAgent assistant = Ax.agent("question:string -> answer:string, usedContext:boolean", Map.of("contextFields", List.of()));
    Map<String, Object> output = assistant.forward(stageClient, Map.of("question", "Use local context to choose between generation, agents, and flows."));
    System.out.println(Json.stringify(Map.of("agentOutput", output, "rawModelAnswer", stageClient.rawModelAnswer)));
  }
}
