import com.sun.net.httpserver.HttpServer;
import dev.axllm.ax.*;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.Map;

// Drive AxMCPStreamableHTTPTransport.send() through the REAL HttpClient transport
// against an in-process com.sun.net.httpserver loopback that answers the JSON-RPC
// POST with Content-Type: text/event-stream -- the MCP Streamable HTTP SSE path
// the ScriptedTransport conformance fixtures bypass. The SSE body interleaves a
// notification ahead of the id-matched response, so a transport that ignored the
// Content-Type (JSON-decoding the raw stream) or returned the first data frame
// would fail. Exits non-zero on any mismatch so axir verify fails if the SSE
// branch regresses.
public final class AxMCPSseRoundtripExample {
  public static void main(String[] args) throws Exception {
    String sseBody =
        ": keepalive\n"
            + "event: message\n"
            + "data: {\"jsonrpc\":\"2.0\",\"method\":\"notifications/message\",\"params\":{\"level\":\"info\"}}\n"
            + "\n"
            + "event: message\n"
            + "data: {\"jsonrpc\":\"2.0\",\"id\":\"ax-sse-1\",\"result\":{\"ok\":true,\"protocolVersion\":\"2025-11-25\"}}\n"
            + "\n";

    HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext(
        "/",
        exchange -> {
          if ("GET".equals(exchange.getRequestMethod())) {
            exchange.sendResponseHeaders(405, -1);
            exchange.close();
            return;
          }
          String requestBody = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
          String responseBody;
          String contentType = "application/json";
          if (requestBody.contains("server/discover")) {
            responseBody = "{\"jsonrpc\":\"2.0\",\"id\":1,\"error\":{\"code\":-32601,\"message\":\"Method not found\"}}";
          } else if (requestBody.contains("\"method\":\"initialize\"")) {
            responseBody = "{\"jsonrpc\":\"2.0\",\"id\":2,\"result\":{\"protocolVersion\":\"2025-11-25\",\"capabilities\":{},\"serverInfo\":{\"name\":\"legacy-loopback\",\"version\":\"1.0.0\"}}}";
          } else if (requestBody.contains("notifications/initialized")) {
            responseBody = "";
          } else {
            responseBody = sseBody.replace("\"ax-sse-1\"", "3");
            contentType = "text/event-stream";
          }
          byte[] resp = responseBody.getBytes(StandardCharsets.UTF_8);
          exchange.getResponseHeaders().set("Content-Type", contentType);
          exchange.sendResponseHeaders(200, resp.length);
          try (OutputStream os = exchange.getResponseBody()) {
            os.write(resp);
          }
        });
    server.start();
    int port = server.getAddress().getPort();

    try {
      AxMCPStreamableHTTPTransport transport =
          new AxMCPStreamableHTTPTransport(
              "http://127.0.0.1:" + port + "/mcp",
              Map.of(
                  "ssrfProtection",
                  Map.of(
                      "requireHttps", false, "allowLocalhost", true, "allowPrivateNetworks", true)));
      AxMCPClient client = new AxMCPClient(transport);
      client.init();
      if (!"legacy".equals(client.getEra()))
        throw new RuntimeException("auto discovery did not fall back to legacy");
      Map<String, Object> result = client.callTool("noop", Map.of());
      boolean ok = Boolean.TRUE.equals(result.get("ok"));
      if (!ok)
        throw new RuntimeException(
            "SSE result not decoded from text/event-stream body: " + result);
      client.close();
    } finally {
      server.stop(0);
    }
    System.out.println("mcp-sse-roundtrip-ok");
  }
}
