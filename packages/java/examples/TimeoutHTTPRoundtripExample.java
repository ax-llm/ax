import com.sun.net.httpserver.HttpServer;
import dev.axllm.ax.*;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.Callable;
import java.util.concurrent.atomic.AtomicInteger;

// Time requests out through the REAL HttpClient transport against in-process
// loopback servers. A call's timeoutMs (TypeScript's per-call timeout, in
// milliseconds) ends a chat or a stream whose response has not started, and
// the request layer does not retry it. A stream whose response has started
// runs past it, because the timer stops at the response headers, as in
// TypeScript's apiCall. Exits non-zero on any mismatch so `axir verify`
// fails if it regresses.
public final class TimeoutHTTPRoundtripExample {
  public static void main(String[] args) throws Exception {
    // A server that accepts connections and never answers.
    ServerSocket silent = new ServerSocket(0, 16, InetAddress.getByName("127.0.0.1"));
    AtomicInteger accepted = new AtomicInteger();
    List<Socket> held = Collections.synchronizedList(new ArrayList<>());
    Thread acceptor = new Thread(() -> {
      while (true) {
        try {
          held.add(silent.accept());
          accepted.incrementAndGet();
        } catch (Exception error) {
          return;
        }
      }
    });
    acceptor.setDaemon(true);
    acceptor.start();
    Map<String, Object> request = Map.of("chat_prompt", List.of(Map.of("role", "user", "content", "hi")));
    OpenAICompatibleClient client = new OpenAICompatibleClient(
        Map.of("api_key", "test-key", "base_url", "http://127.0.0.1:" + silent.getLocalPort(), "model", "gpt-5.4-mini"));
    expectTimeout("chat", () -> client.chat(request, new LinkedHashMap<>(Map.of("timeoutMs", 200))));
    expectTimeout("stream", () -> {
      try (AxChatStream stream = client.openStream(request, new LinkedHashMap<>(Map.of("timeoutMs", 200)), null)) {
        for (Object ignored : stream) {}
      }
      return null;
    });
    if (accepted.get() != 2) throw new RuntimeException("a timed-out request was retried: " + accepted.get() + " connections");

    // A stream whose headers arrive at once and whose second event comes after
    // more than the timeoutMs.
    HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext(
        "/",
        exchange -> {
          exchange.getRequestBody().readAllBytes();
          exchange.getResponseHeaders().set("Content-Type", "text/event-stream");
          exchange.sendResponseHeaders(200, 0);
          try (OutputStream os = exchange.getResponseBody()) {
            os.write(("data: " + event("Hel", "null") + "\n\n").getBytes(StandardCharsets.UTF_8));
            os.flush();
            try {
              Thread.sleep(1500);
            } catch (InterruptedException error) {
              Thread.currentThread().interrupt();
            }
            os.write(("data: " + event("lo", "\"stop\"") + "\n\ndata: [DONE]\n\n").getBytes(StandardCharsets.UTF_8));
            os.flush();
          }
        });
    server.start();
    try {
      OpenAICompatibleClient slow = new OpenAICompatibleClient(
          Map.of("api_key", "test-key", "base_url", "http://127.0.0.1:" + server.getAddress().getPort(), "model", "gpt-5.4-mini"));
      StringBuilder text = new StringBuilder();
      try (AxChatStream stream = slow.openStream(request, new LinkedHashMap<>(Map.of("timeoutMs", 1000)), null)) {
        for (Map<String, Object> event : stream) {
          Object results = event.get("results");
          if (results instanceof List<?> list && !list.isEmpty() && list.get(0) instanceof Map<?, ?> first && first.get("content") instanceof String content) text.append(content);
        }
      }
      if (!"Hello".equals(text.toString())) throw new RuntimeException("a started stream was cut off: " + text);
    } finally {
      server.stop(0);
      silent.close();
    }
    System.out.println("timeout-http-roundtrip-ok");
  }

  static String event(String content, String finish) {
    return "{\"id\":\"chatcmpl_slow\",\"model\":\"gpt-5.4-mini\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"" + content + "\"},\"finish_reason\":" + finish + "}]}";
  }

  static void expectTimeout(String label, Callable<Object> run) throws Exception {
    long started = System.nanoTime();
    try {
      run.call();
    } catch (AxAIServiceError error) {
      if (!"AxAIServiceTimeoutError".equals(error.getClass().getSimpleName()) || !String.valueOf(error.getMessage()).contains("Request timed out after 200ms"))
        throw new RuntimeException(label + ": " + error, error);
      double elapsed = (System.nanoTime() - started) / 1e9;
      if (elapsed >= 5) throw new RuntimeException(label + ": timed out after " + elapsed + " s");
      return;
    }
    throw new RuntimeException(label + ": the request did not time out");
  }
}
