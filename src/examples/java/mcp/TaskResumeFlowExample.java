// ax-example:start
// title: Java MCP Task Continuation
// group: mcp
// description: Correlates a terminal MCP task event and dispatches a resume command to the owning AxFlow host.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: advanced
// order: 30
// story: 62
// ax-example:end
import dev.axllm.ax.*;
import java.util.*;

public final class TaskResumeFlowExample {
  public static void main(String[] args) {
    String key = Optional.ofNullable(System.getenv("OPENAI_API_KEY")).orElse(System.getenv("OPENAI_APIKEY"));
    if (key == null) throw new IllegalStateException("Set OPENAI_API_KEY.");
    AxEventRuntime runtime = new AxEventRuntime(List.of(new AxEventRoute(
        "task-resume", "resume", Map.of("types", List.of("mcp.task.status")), "reindex-flow", false, "strict", 0)));
    Map<String,Object> normalized = AxEventRuntime.normalizeMCP(
        "inventory", "notifications/tasks/status", Map.of("task", Map.of("taskId", "42", "status", "completed")));
    List<AxEventCommand> commands = runtime.publish(
        new AxEventEnvelope("task-42-complete", String.valueOf(normalized.get("source")), String.valueOf(normalized.get("type")), normalized.get("data")),
        "tenant:demo", "authenticated");
    if (commands.stream().anyMatch(command -> command.action().equals("resume"))) {
      AxFlow flow = Ax.flow(Map.of("id", "reindex-flow"))
          .execute("status", Ax.ax("taskId:string -> status:string"))
          .returns(Map.of("status", "status"));
      OpenAICompatibleClient llm = new OpenAICompatibleClient(Map.of("api_key", key, "model", "gpt-5.4-mini"));
      System.out.println(Json.stringify(flow.forward(llm, Map.of("taskId", "42"))));
    }
  }
}
