import dev.axllm.ax.*;
import java.util.List;
import java.util.Map;

public final class AxMCPScriptedToolsExample {
  public static void main(String[] args) {
    AxMCPScriptedTransport transport = new AxMCPScriptedTransport(List.of(
      Map.of("method", "initialize", "result", Map.of(
        "protocolVersion", "2025-11-25",
        "capabilities", Map.of("tools", Map.of()),
        "serverInfo", Map.of("name", "scripted-mcp", "version", "1.0.0")
      )),
      Map.of("method", "tools/list", "result", Map.of("tools", List.of(
        Map.of("name", "echo", "description", "Echo text", "inputSchema", Map.of("type", "object"))
      ))),
      Map.of("method", "tools/call", "result", Map.of("structuredContent", Map.of("echo", "hello")))
    ));
    AxMCPClient client = new AxMCPClient(transport);
    client.init();
    Object result = client.nativeTools().get(0).call(Map.of("text", "hello"));
    Object structured = ((Map<?, ?>) result).get("structuredContent");
    if (!"hello".equals(((Map<?, ?>) structured).get("echo"))) throw new AssertionError("unexpected MCP result");
    System.out.println("java-mcp-ok");
  }
}
