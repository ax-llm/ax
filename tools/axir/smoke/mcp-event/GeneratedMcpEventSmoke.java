import dev.axllm.ax.*;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;

public final class GeneratedMcpEventSmoke {
  @SuppressWarnings("unchecked")
  private static Map<String,Object> object(Object value) { return (Map<String,Object>) value; }

  public static void main(String[] args) throws Exception {
    String endpoint = Objects.requireNonNull(System.getenv("AX_MCP_ENDPOINT"), "AX_MCP_ENDPOINT is required");
    String era = Objects.requireNonNullElse(System.getenv("AX_MCP_SMOKE_ERA"), "legacy");
    String clientEra = "modern".equals(era) ? "auto" : "legacy";
    AxMCPStreamableHTTPTransport transport = new AxMCPStreamableHTTPTransport(endpoint, Map.of(
        "ssrfProtection", Map.of("requireHttps", false, "allowLocalhost", true, "allowPrivateNetworks", true),
        "reconnectDelayMs", 50));
    AxMCPClient client = new AxMCPClient(transport, Map.of(
        "namespace", "inventory", "era", clientEra,
        "roots", List.of(Map.of("uri", "file:///workspace", "name", "workspace")),
        "subscriptionFilters", Map.of("resourcesListChanged", true)));
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
    String taskId;
    if ("modern".equals(era)) {
      Map<String,Object> taskResult = client.callTool("start_reindex", Map.of("scope", "all"));
      if (((Number) object(taskResult.get("structuredContent")).get("indexed")).intValue() != 42) throw new IllegalStateException("modern task result was not flattened: " + taskResult);
      Map<String,Object> rootsResult = client.callTool("mrtr_roots_round", Map.of());
      if (((Number) object(rootsResult.get("structuredContent")).get("indexed")).intValue() != 42) throw new IllegalStateException("modern roots MRTR failed: " + rootsResult);
      AxMCPClient.CatalogSnapshot refreshed = client.inspectCatalog();
      String version = String.valueOf(refreshed.serverInfo().get("version"));
      if (version.equals("null") || version.equals("2.0.0")) throw new IllegalStateException("modern serverInfo was not refreshed: " + refreshed.serverInfo());
      taskId = "";
    } else {
      taskId = String.valueOf(object(client.callTool("start_reindex", Map.of("scope", "all")).get("task")).get("taskId"));
    }
    final String selectedTaskId = taskId;

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
      .waitFor("mcp.task", "taskKey", Map.of("taskId", selectedTaskId))
      .retrySafety("idempotent");

    AxMCPEventSource eventSource = new AxMCPEventSource(client, "inventory", "tenant:smoke", "authenticated", AxMCPEventSource.all());
    AxEventRuntime runtime = new AxEventRuntime(List.of(
        new AxEventRoute("resource-wake", "wake", Map.of("types", List.of("mcp.resource.updated")), "resource-target", true, "strict", 0),
        new AxEventRoute("task-start", "wake", Map.of("types", List.of("app.task.started")), "task-target", false, "strict", 0),
        new AxEventRoute("task-progress", "observe", Map.of("types", List.of("mcp.progress")), null, false, "strict", 0),
        new AxEventRoute("task-resume", "resume", Map.of("types", List.of("mcp.task.status")), "task-target", false, "strict", 0)))
      .registerTarget(resourceTarget)
      .registerTarget(taskTarget)
      .addSource(eventSource);
    runtime.start();
    if ("legacy".equals(era)) runtime.publish(new AxEventEnvelope("task-start", "app://smoke", "app.task.started",
        Map.of("taskId", taskId, "taskKey", "inventory:" + taskId)), "tenant:smoke", "authenticated");
    System.out.println("AX_MCP_SMOKE_READY");

    long deadline = System.nanoTime() + java.time.Duration.ofSeconds(20).toNanos();
    while (!(resources.get() >= 1 && ("modern".equals(era) || tasks.get() >= 2) && ("modern".equals(era) || progress.get() >= 1))) {
      if (System.nanoTime() >= deadline) throw new IllegalStateException("MCP event smoke timed out; source errors=" + eventSource.errors());
      Thread.sleep(10);
    }
    runtime.close();
    client.close();
    System.out.printf("AX_MCP_SMOKE_OK resource=%d task=%d progress=%d%n", resources.get(), tasks.get(), progress.get());
  }
}
