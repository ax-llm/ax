// docs:start provider-agent
import dev.axllm.ax.*;
import java.util.*;

public final class AgentOpenAIExample {
  static final class ProviderAgentClient implements AiClient {
    final OpenAICompatibleClient inner;
    String rawModelAnswer;
    int calls = 0;

    ProviderAgentClient(OpenAICompatibleClient inner) {
      this.inner = inner;
    }

    public Map<String, Object> complete(Map<String, Object> request) throws Exception {
      calls += 1;
      if (rawModelAnswer == null) {
        Map<String, Object> response =
            inner.complete(
                Map.of(
                    "chat_prompt",
                    List.of(
                        Map.of(
                            "role",
                            "user",
                            "content",
                            "In one sentence, explain what Ax helps developers build."))));
        rawModelAnswer = String.valueOf(response.get("content"));
      }
      Map<String, Object> payload;
      if (calls == 1) {
        payload = Map.of("completion", Map.of("type", "final", "args", List.of("Answer", Map.of())));
      } else if (calls == 2) {
        payload =
            Map.of(
                "completion",
                Map.of("type", "final", "args", List.of("Answer", Map.of("answer", rawModelAnswer))));
      } else {
        payload = Map.of("answer", rawModelAnswer);
      }
      return Map.of("content", Json.stringify(payload));
    }
  }

  public static void main(String[] args) throws Exception {
    String apiKey = System.getenv("OPENAI_API_KEY");
    if (apiKey == null || apiKey.isBlank()) apiKey = System.getenv("OPENAI_APIKEY");
    if (apiKey == null || apiKey.isBlank()) {
      throw new IllegalStateException("Set OPENAI_API_KEY or OPENAI_APIKEY to run this provider API example.");
    }
    String model = System.getenv().getOrDefault("AX_OPENAI_MODEL", "gpt-4.1-mini");
    OpenAICompatibleClient client =
        new OpenAICompatibleClient(
            Map.of("api_key", apiKey, "model", model, "model_config", Map.of("temperature", 0.0)));

    AxAgent assistant = Ax.agent("question:string -> answer:string", Map.of("contextFields", List.of()));
    ProviderAgentClient stageClient = new ProviderAgentClient(client);
    Map<String, Object> output =
        assistant.forward(
            stageClient,
            Map.of("question", "In one sentence, explain what Ax helps developers build."));
    System.out.println(Json.stringify(Map.of("agentOutput", output, "rawModelAnswer", stageClient.rawModelAnswer)));
  }
}
// docs:end provider-agent
