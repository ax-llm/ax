// ax-example:start
// title: Java Native MCP Tools
// group: mcp
// description: Attaches a live MCP client directly to AxGen without a lossy function adapter.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY, MCP_URL
// level: beginner
// order: 10
// story: 60
// ax-example:end
import dev.axllm.ax.*;
import java.util.*;

public final class NativeMCPToolsExample {
  public static void main(String[] args) {
    String key = Optional.ofNullable(System.getenv("OPENAI_API_KEY")).orElse(System.getenv("OPENAI_APIKEY"));
    String endpoint = System.getenv("MCP_URL");
    if (key == null || endpoint == null) throw new IllegalStateException("Set OPENAI_API_KEY and MCP_URL.");
    // The repo's demo MCP server runs on http://127.0.0.1; any other endpoint
    // keeps the default SSRF protection (https only, no local hosts).
    boolean local = endpoint.startsWith("http://127.0.0.1");
    AxMCPStreamableHTTPTransport transport = new AxMCPStreamableHTTPTransport(endpoint,
        Map.of("ssrfProtection", Map.of("requireHttps", !local, "allowLocalhost", local, "allowPrivateNetworks", local)));
    AxMCPClient mcp = new AxMCPClient(transport, Map.of("namespace", "inventory"));
    AxGen program = new AxGen(Ax.s("request:string -> answer:string"), Map.of("mcp", mcp));
    AxAIService llm = Ax.ai("openai", Map.of("api_key", key, "model", "gpt-5.4-mini"));
    try {
      AxMCPClient.CatalogSnapshot catalog = mcp.inspectCatalog();
      System.out.println(Json.stringify(Map.of(
          "tools", catalog.tools().stream().map(tool -> tool.get("name")).toList(),
          "resources", catalog.resources(),
          "resourceTemplates", catalog.resourceTemplates())));
      System.out.println(Json.stringify(program.forward(llm, Map.of("request", "Reindex inventory."))));
    } finally {
      mcp.close();
    }
  }
}
