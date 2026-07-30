import dev.axllm.ax.AxMCPClient;
import dev.axllm.ax.AxMCPStreamableHTTPTransport;
import java.util.Map;
import java.util.Objects;

public final class GeneratedMcpInteropSmoke {
  public static void main(String[] args) {
    String endpoint = Objects.requireNonNull(System.getenv("AX_MCP_ENDPOINT"), "AX_MCP_ENDPOINT is required");
    AxMCPStreamableHTTPTransport transport = new AxMCPStreamableHTTPTransport(endpoint, Map.of(
        "ssrfProtection", Map.of("requireHttps", false, "allowLocalhost", true, "allowPrivateNetworks", true)));
    AxMCPClient client = new AxMCPClient(transport, Map.of("namespace", "foreign", "era", "auto"));
    AxMCPClient.CatalogSnapshot catalog = client.inspectCatalog();
    if (!"legacy".equals(client.getEra()) || !"2025-11-25".equals(catalog.protocolVersion())) {
      throw new IllegalStateException("unexpected MCP classification: era=" + client.getEra() + " version=" + catalog.protocolVersion());
    }
    if (catalog.tools().isEmpty()) throw new IllegalStateException("foreign MCP catalog has no tools");
    System.out.println("AX_MCP_INTEROP_READY");
    Map<String,Object> result = client.callTool("echo", Map.of("message", "ax-interop-java"));
    if (!String.valueOf(result).contains("Echo: ax-interop-java")) {
      throw new IllegalStateException("unexpected echo result: " + result);
    }
    client.close();
    System.out.println("AX_MCP_INTEROP_OK");
  }
}
