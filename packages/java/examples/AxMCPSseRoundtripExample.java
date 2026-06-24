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
          exchange.getRequestBody().readAllBytes();
          byte[] resp = sseBody.getBytes(StandardCharsets.UTF_8);
          exchange.getResponseHeaders().set("Content-Type", "text/event-stream");
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
      Map<String, Object> response =
          transport.send(
              Map.of(
                  "jsonrpc", "2.0", "id", "ax-sse-1", "method", "tools/call", "params",
                  Map.of("name", "noop")));
      if (!"ax-sse-1".equals(response.get("id")))
        throw new RuntimeException("SSE selector returned wrong message: " + response);
      Object result = response.get("result");
      boolean ok = result instanceof Map && Boolean.TRUE.equals(((Map<?, ?>) result).get("ok"));
      if (!ok)
        throw new RuntimeException(
            "SSE result not decoded from text/event-stream body: " + response);
    } finally {
      server.stop(0);
    }
    System.out.println("mcp-sse-roundtrip-ok");
  }
}
