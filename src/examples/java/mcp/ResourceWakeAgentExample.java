// ax-example:start
// title: Java MCP Resource Wake
// group: mcp
// description: Normalizes a subscribed resource notification and dispatches an authenticated wake command to an Agent.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: intermediate
// order: 20
// story: 61
// ax-example:end
import dev.axllm.ax.*;
import dev.axllm.ax.runtime.quickjs.*;
import java.util.*;

public final class ResourceWakeAgentExample {
  public static void main(String[] args) throws Exception {
    String key = Optional.ofNullable(System.getenv("OPENAI_API_KEY")).orElse(System.getenv("OPENAI_APIKEY"));
    if (key == null) throw new IllegalStateException("Set OPENAI_API_KEY.");
    AxEventRuntime runtime = new AxEventRuntime(List.of(new AxEventRoute(
        "resource-wake", "wake", Map.of("types", List.of("mcp.resource.updated")), "inventory-agent", true, "strict", 0)));
    Map<String,Object> normalized = AxEventRuntime.normalizeMCP(
        "inventory", "notifications/resources/updated", Map.of("uri", "demo://inventory"));
    List<AxEventCommand> commands = runtime.publish(
        new AxEventEnvelope("resource-1", String.valueOf(normalized.get("source")), String.valueOf(normalized.get("type")), normalized.get("data")),
        "tenant:demo", "authenticated");
    if (commands.stream().anyMatch(command -> command.action().equals("wake"))) {
      AxAgent agent = Ax.agent("uri:string -> summary:string", Map.of("runtime", Map.of("language", "JavaScript")));
      OpenAICompatibleClient llm = new OpenAICompatibleClient(Map.of("api_key", key, "model", "gpt-5.4-mini"));
      try (AxQuickJsCodeRuntime js = new AxQuickJsCodeRuntime()) {
        System.out.println(Json.stringify(agent.forward(llm, Map.of("uri", "demo://inventory"), Map.of("runtime", js))));
      }
    }
  }
}
