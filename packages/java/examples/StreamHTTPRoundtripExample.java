import com.sun.net.httpserver.HttpServer;
import dev.axllm.ax.*;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.*;

// Drive a streaming stream() through the REAL HttpClient transport against an
// in-process com.sun.net.httpserver loopback that returns a spec-legal
// text/event-stream body with a MULTI-LINE data: event and CRLF line endings.
// The conformance ScriptedTransport only ever feeds single-line data: JSON, so
// this is the only end-to-end coverage for the SSE line-folding that
// src/ax/util/sse.ts performs. Exits non-zero on any mismatch so `axir verify`
// fails if the folding regresses.
public final class StreamHTTPRoundtripExample {
  public static void main(String[] args) throws Exception {
    // One logical delta whose JSON is split across two data: lines (folded with
    // "\n"), then a single-line delta, then [DONE]. Every line uses CRLF.
    String event1a = "{\"id\":\"chatcmpl_stream\",\"model\":\"gpt-4.1-mini\",\"choices\":[{\"index\":0,\"delta\":";
    String event1b = "{\"content\":\"Hello \"}}]}";
    String event2 = "{\"id\":\"chatcmpl_stream\",\"model\":\"gpt-4.1-mini\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"world\"},\"finish_reason\":\"stop\"}]}";
    String sseBody =
        "data: " + event1a + "\r\n"
            + "data: " + event1b + "\r\n"
            + "\r\n"
            + "data: " + event2 + "\r\n"
            + "\r\n"
            + "data: [DONE]\r\n"
            + "\r\n";
    byte[] sseBytes = sseBody.getBytes(StandardCharsets.UTF_8);

    HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext(
        "/",
        exchange -> {
          exchange.getRequestBody().readAllBytes();
          exchange.getResponseHeaders().set("Content-Type", "text/event-stream");
          exchange.sendResponseHeaders(200, sseBytes.length);
          try (OutputStream os = exchange.getResponseBody()) {
            os.write(sseBytes);
          }
        });
    server.start();
    int port = server.getAddress().getPort();

    try {
      OpenAICompatibleClient client =
          new OpenAICompatibleClient(
              Map.of("api_key", "test-key", "base_url", "http://127.0.0.1:" + port, "model", "gpt-4.1-mini"));
      List<String> deltas = new ArrayList<>();
      for (Map<String, Object> event :
          client.stream(Map.of("chat_prompt", List.of(Map.of("role", "user", "content", "stream"))))) {
        Object results = event.get("results");
        if (results instanceof List<?> list && !list.isEmpty() && list.get(0) instanceof Map<?, ?> first) {
          Object content = first.get("content");
          if (content instanceof String s && !s.isEmpty()) deltas.add(s);
        }
      }
      if (deltas.isEmpty() || !"Hello ".equals(deltas.get(0)))
        throw new RuntimeException("multi-line data: event was not folded into one JSON value: " + deltas);
      if (!"Hello world".equals(String.join("", deltas)))
        throw new RuntimeException("bad stream fold: " + deltas);
    } finally {
      server.stop(0);
    }
    System.out.println("stream-http-roundtrip-ok");
  }
}
