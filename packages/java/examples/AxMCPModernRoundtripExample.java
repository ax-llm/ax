import com.sun.net.httpserver.HttpServer;
import dev.axllm.ax.*;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.regex.*;

public final class AxMCPModernRoundtripExample {
  @SuppressWarnings("unchecked")
  private static Map<String,Object> object(Object value) { return (Map<String,Object>) value; }

  public static void main(String[] args) throws Exception {
    AtomicInteger calls = new AtomicInteger();
    AtomicInteger toolLists = new AtomicInteger();
    List<String> failures = Collections.synchronizedList(new ArrayList<>());
    HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext("/mcp", exchange -> {
      String body = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
      int call = calls.incrementAndGet();
      Matcher matcher = Pattern.compile("\\\"id\\\"\\s*:\\s*(\\\"[^\\\"]*\\\"|[0-9]+)").matcher(body);
      String id = matcher.find() ? matcher.group(1) : "null";
      String method;
      if (body.contains("server/discover")) method = "server/discover";
      else if (body.contains("tools/list")) method = "tools/list";
      else if (body.contains("tasks/get")) method = "tasks/get";
      else if (body.contains("start_reindex")) method = "start_reindex";
      else if (body.contains("mrtr_roots_round")) method = "mrtr_roots_round";
      else if (body.contains("initialize")) method = "initialize";
      else method = "unknown";
      if (method.equals("initialize")) failures.add("modern client sent initialize");
      if (!method.equals("server/discover") && !body.contains("io.modelcontextprotocol")) failures.add(method + " omitted request _meta");
      String meta = "\\\"_meta\\\":{\\\"io.modelcontextprotocol/serverInfo\\\":{\\\"name\\\":\\\"modern-loopback\\\",\\\"version\\\":\\\"1.0." + call + "\\\"}}";
      String result;
      if (method.equals("server/discover")) {
        result = "{\\\"resultType\\\":\\\"complete\\\",\\\"supportedVersions\\\":[\\\"2026-07-28\\\"],\\\"capabilities\\\":{\\\"tools\\\":{},\\\"extensions\\\":{\\\"io.modelcontextprotocol/tasks\\\":{}}},\\\"ttlMs\\\":60000,\\\"cacheScope\\\":\\\"public\\\"," + meta + "}";
      } else if (method.equals("tools/list")) {
        toolLists.incrementAndGet();
        result = "{\\\"resultType\\\":\\\"complete\\\",\\\"tools\\\":[{\\\"name\\\":\\\"start_reindex\\\",\\\"inputSchema\\\":{\\\"type\\\":\\\"object\\\",\\\"properties\\\":{\\\"scope\\\":{\\\"type\\\":\\\"string\\\",\\\"x-mcp-header\\\":\\\"Scope\\\"}}}},{\\\"name\\\":\\\"mrtr_roots_round\\\",\\\"inputSchema\\\":{\\\"type\\\":\\\"object\\\",\\\"properties\\\":{}}}],\\\"ttlMs\\\":60000,\\\"cacheScope\\\":\\\"public\\\"," + meta + "}";
      } else if (method.equals("start_reindex")) {
        if (!"all".equals(exchange.getRequestHeaders().getFirst("Mcp-Param-Scope"))) failures.add("Mcp-Param-Scope was not propagated");
        result = "{\\\"resultType\\\":\\\"task\\\",\\\"taskId\\\":\\\"task-1\\\",\\\"status\\\":\\\"working\\\",\\\"createdAt\\\":\\\"2026-07-29T00:00:00Z\\\",\\\"lastUpdatedAt\\\":\\\"2026-07-29T00:00:00Z\\\",\\\"ttlMs\\\":null," + meta + "}";
      } else if (method.equals("tasks/get")) {
        result = "{\\\"taskId\\\":\\\"task-1\\\",\\\"status\\\":\\\"completed\\\",\\\"createdAt\\\":\\\"2026-07-29T00:00:00Z\\\",\\\"lastUpdatedAt\\\":\\\"2026-07-29T00:00:01Z\\\",\\\"ttlMs\\\":null,\\\"result\\\":{\\\"resultType\\\":\\\"complete\\\",\\\"structuredContent\\\":{\\\"indexed\\\":42}," + meta + "}," + meta + "}";
      } else if (!body.contains("requestState")) {
        result = "{\\\"resultType\\\":\\\"input_required\\\",\\\"inputRequests\\\":{\\\"roots\\\":{\\\"method\\\":\\\"roots/list\\\"}},\\\"requestState\\\":\\\"opaque-roots-state\\\"," + meta + "}";
      } else {
        if (!body.contains("opaque-roots-state") || !body.contains("file:///workspace")) failures.add("roots MRTR response was not echoed");
        result = "{\\\"resultType\\\":\\\"complete\\\",\\\"structuredContent\\\":{\\\"roots\\\":1}," + meta + "}";
      }
      result = result.replace("\\\"", "\"");
      byte[] response = ("{\"jsonrpc\":\"2.0\",\"id\":" + id + ",\"result\":" + result + "}").getBytes(StandardCharsets.UTF_8);
      exchange.getResponseHeaders().set("Content-Type", "application/json");
      exchange.sendResponseHeaders(200, response.length);
      try (OutputStream output = exchange.getResponseBody()) { output.write(response); }
    });
    server.start();
    try {
      AxMCPStreamableHTTPTransport transport = new AxMCPStreamableHTTPTransport(
          "http://127.0.0.1:" + server.getAddress().getPort() + "/mcp",
          Map.of("ssrfProtection", Map.of("requireHttps", false, "allowLocalhost", true, "allowPrivateNetworks", true)));
      AxMCPClient client = new AxMCPClient(transport, Map.of("era", "modern", "roots", List.of(Map.of("uri", "file:///workspace", "name", "workspace"))));
      client.init();
      if (!"modern".equals(client.getEra())) throw new IllegalStateException("modern discovery failed");
      client.refresh(false);
      Map<String,Object> task = client.callTool("start_reindex", Map.of("scope", "all"));
      if (((Number)object(task.get("structuredContent")).get("indexed")).intValue() != 42) throw new IllegalStateException("task was not flattened: " + task);
      Map<String,Object> roots = client.callTool("mrtr_roots_round", Map.of());
      if (((Number)object(roots.get("structuredContent")).get("roots")).intValue() != 1) throw new IllegalStateException("roots MRTR failed: " + roots);
      AxMCPClient.CatalogSnapshot catalog = client.inspectCatalog();
      if (toolLists.get() != 1 || !failures.isEmpty() || "1.0.1".equals(catalog.serverInfo().get("version"))) throw new IllegalStateException("modern roundtrip failed: toolLists=" + toolLists + " failures=" + failures + " serverInfo=" + catalog.serverInfo());
      client.close();
    } finally { server.stop(0); }
    System.out.println("mcp-modern-roundtrip-ok");
  }
}
