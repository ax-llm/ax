import dev.axllm.ax.*;
import java.util.*;

public final class AgentPipelineExample {
  static final class FakeService implements AiClient {
    final List<Map<String, Object>> responses =
        new ArrayList<>(
            List.of(
                Map.of("content", "{\"completion\":{\"type\":\"final\",\"args\":[\"Answer\",{}]}}"),
                Map.of(
                    "content",
                    "{\"completion\":{\"type\":\"final\",\"args\":[\"Answer\",{\"answer\":\"Paris\"}]}}"),
                Map.of("content", "{\"answer\":\"Paris\"}")));

    public Map<String, Object> complete(Map<String, Object> request) {
      if (responses.isEmpty()) throw new RuntimeException("fake service exhausted");
      return responses.remove(0);
    }
  }

  public static void main(String[] args) throws Exception {
    AxAgent qa = Ax.agent("question:string -> answer:string", Map.of("contextFields", List.of()));
    Map<String, Object> output = qa.forward(new FakeService(), Map.of("question", "Capital of France?"));

    System.out.println("final output:");
    System.out.println(Json.stringify(output));
    System.out.println("chat log evidence:");
    List<Object> chatNames = new ArrayList<>();
    for (Object raw : qa.getChatLog()) chatNames.add(((Map<?, ?>) raw).get("name"));
    System.out.println(Json.stringify(chatNames));
    System.out.println("action log evidence:");
    List<Object> actionTypes = new ArrayList<>();
    for (Object raw : qa.getActionLog()) actionTypes.add(((Map<?, ?>) raw).get("type"));
    System.out.println(Json.stringify(actionTypes));
  }
}
