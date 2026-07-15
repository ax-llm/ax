import dev.axllm.ax.*;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;

public final class GeneratedMcpEventSmoke {
  @SuppressWarnings("unchecked")
  private static Map<String,Object> object(Object value) { return (Map<String,Object>) value; }

  public static void main(String[] args) throws Exception {
    String endpoint = Objects.requireNonNull(System.getenv("AX_MCP_ENDPOINT"), "AX_MCP_ENDPOINT is required");
    AxMCPStreamableHTTPTransport transport = new AxMCPStreamableHTTPTransport(endpoint, Map.of(
        "ssrfProtection", Map.of("requireHttps", false, "allowLocalhost", true, "allowPrivateNetworks", true),
        "reconnectDelayMs", 50));
    AxMCPClient client = new AxMCPClient(transport, Map.of("namespace", "inventory"));
    AtomicInteger resources = new AtomicInteger();
    AtomicInteger tasks = new AtomicInteger();
    AtomicInteger progress = new AtomicInteger();
    client.addNotificationListener(message -> {
      if ("notifications/progress".equals(message.get("method"))) progress.incrementAndGet();
    });
    client.init();
    AxMCPClient.CatalogSnapshot catalog = client.inspectCatalog();
    if (catalog.resources().size() != 2 || catalog.resourceTemplates().size() != 1) {
      throw new IllegalStateException("MCP catalog discovery failed: " + catalog);
    }
    String taskId = String.valueOf(object(client.callTool("start_reindex", Map.of("scope", "all")).get("task")).get("taskId"));

    AxEventRuntime.Target resourceTarget = new AxEventRuntime.Target("resource-target", (input, context) -> {
      resources.incrementAndGet();
      return input;
    }).retrySafety("idempotent");
    AxEventRuntime.Target taskTarget = new AxEventRuntime.Target("task-target", (input, context) -> {
      tasks.incrementAndGet();
      return input;
    }).mapInput((event, continuation) -> Map.of("taskId", continuation == null
        ? object(event.data()).get("taskId")
        : continuation.metadata.get("taskId")))
      .waitFor("mcp.task", "taskKey", Map.of("taskId", taskId))
      .retrySafety("idempotent");

    AxEventRuntime runtime = new AxEventRuntime(List.of(
        new AxEventRoute("resource-wake", "wake", Map.of("types", List.of("mcp.resource.updated")), "resource-target", true, "strict", 0),
        new AxEventRoute("task-start", "wake", Map.of("types", List.of("app.task.started")), "task-target", false, "strict", 0),
        new AxEventRoute("task-progress", "observe", Map.of("types", List.of("mcp.progress")), null, false, "strict", 0),
        new AxEventRoute("task-resume", "resume", Map.of("types", List.of("mcp.task.status")), "task-target", false, "strict", 0)))
      .registerTarget(resourceTarget)
      .registerTarget(taskTarget)
      .addSource(new AxMCPEventSource(client, "inventory", "tenant:smoke", "authenticated", AxMCPEventSource.all()));
    runtime.start();
    runtime.publish(new AxEventEnvelope("task-start", "app://smoke", "app.task.started",
        Map.of("taskId", taskId, "taskKey", "inventory:" + taskId)), "tenant:smoke", "authenticated");
    System.out.println("AX_MCP_SMOKE_READY");

    long deadline = System.nanoTime() + java.time.Duration.ofSeconds(20).toNanos();
    while (!(resources.get() >= 1 && tasks.get() >= 2 && progress.get() >= 1)) {
      if (System.nanoTime() >= deadline) throw new IllegalStateException("MCP event smoke timed out");
      Thread.sleep(10);
    }
    runtime.close();
    client.close();
    System.out.printf("AX_MCP_SMOKE_OK resource=%d task=%d progress=%d%n", resources.get(), tasks.get(), progress.get());
  }
}
