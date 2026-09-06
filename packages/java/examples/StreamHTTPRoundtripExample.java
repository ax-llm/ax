import com.sun.net.httpserver.HttpServer;
import dev.axllm.ax.*;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

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
    // "\n"), then a single-line delta accepted at EOF without a delimiter.
    String event1a = "{\"id\":\"chatcmpl_stream\",\"model\":\"gpt-5.4-mini\",\"choices\":[{\"index\":0,\"delta\":";
    String event1b = "{\"content\":\"Hello 🌍 \"}}]}";
    String event2 = "{\"id\":\"chatcmpl_stream\",\"model\":\"gpt-5.4-mini\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"world\"},\"finish_reason\":\"stop\"}]}";
    String sseFirst =
        "\uFEFFdatabase: ignored\r\n"
            + "data: " + event1a + "\r\n"
            + "data: " + event1b + "\r\n"
            + "\r\n";
    String sseRest = "data: " + event2;
    byte[] firstBytes = sseFirst.getBytes(StandardCharsets.UTF_8);
    byte[] restBytes = sseRest.getBytes(StandardCharsets.UTF_8);
    CountDownLatch releaseRest = new CountDownLatch(1);
    CountDownLatch releaseCancelledRest = new CountDownLatch(1);
    AtomicBoolean releaseTimedOut = new AtomicBoolean(false);
    AtomicInteger requests = new AtomicInteger();

    HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext(
        "/",
        exchange -> {
          exchange.getRequestBody().readAllBytes();
          exchange.getResponseHeaders().set("Content-Type", "text/event-stream");
          exchange.sendResponseHeaders(200, firstBytes.length + restBytes.length);
          try (OutputStream os = exchange.getResponseBody()) {
            for (byte value : firstBytes) { os.write(value); os.flush(); }
            try {
              CountDownLatch release = requests.incrementAndGet() == 2 ? releaseCancelledRest : releaseRest;
              if (!release.await(5, TimeUnit.SECONDS)) releaseTimedOut.set(true);
            } catch (InterruptedException error) {
              Thread.currentThread().interrupt();
              releaseTimedOut.set(true);
            }
            os.write(restBytes);
            os.flush();
          }
        });
    server.start();
    int port = server.getAddress().getPort();

    try {
      OpenAICompatibleClient client =
          new OpenAICompatibleClient(
              Map.of("api_key", "test-key", "base_url", "http://127.0.0.1:" + port, "model", "gpt-5.4-mini"));
      List<String> deltas = new ArrayList<>();
      try (AxChatStream stream = client.openStream(Map.of("chat_prompt", List.of(Map.of("role", "user", "content", "stream"))))) {
        Iterator<Map<String, Object>> iterator = stream.iterator();
        if (!iterator.hasNext()) throw new RuntimeException("stream ended before first event");
        Map<String, Object> firstEvent = iterator.next();
        releaseRest.countDown();
        List<Map<String, Object>> events = new ArrayList<>();
        events.add(firstEvent);
        iterator.forEachRemaining(events::add);
        if (releaseTimedOut.get()) throw new RuntimeException("first event was not incremental");
        for (Map<String, Object> event : events) {
        Object results = event.get("results");
        if (results instanceof List<?> list && !list.isEmpty() && list.get(0) instanceof Map<?, ?> first) {
          Object content = first.get("content");
          if (content instanceof String s && !s.isEmpty()) deltas.add(s);
        }
        }
      }
      if (deltas.isEmpty() || !"Hello 🌍 ".equals(deltas.get(0)))
        throw new RuntimeException("multi-line data: event was not folded into one JSON value: " + deltas);
      if (!"Hello 🌍 world".equals(String.join("", deltas)))
        throw new RuntimeException("bad stream fold: " + deltas);

      AxCancellationToken token = new AxCancellationToken();
      try (AxChatStream cancelled = client.openStream(
          Map.of("chat_prompt", List.of(Map.of("role", "user", "content", "cancel stream"))), token)) {
        Iterator<Map<String, Object>> iterator = cancelled.iterator();
        if (!iterator.hasNext()) throw new RuntimeException("cancel stream ended before first event");
        iterator.next();
        long cancelStarted = System.nanoTime();
        token.cancel("loopback stopped");
        try {
          iterator.hasNext();
          throw new RuntimeException("cancelled stream did not raise an aborted error");
        } catch (AxAIServiceAbortedError error) {
          if (!"loopback stopped".equals(error.reason()) || error.retryable)
            throw new RuntimeException("wrong cancellation error", error);
        }
        if (TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - cancelStarted) > 1000)
          throw new RuntimeException("cancelled stream did not return promptly");
        if (token.subscriptionCount() != 0)
          throw new RuntimeException("cancelled stream retained a body-close subscription");
      } finally {
        releaseCancelledRest.countDown();
      }
    } finally {
      releaseRest.countDown();
      releaseCancelledRest.countDown();
      server.stop(0);
    }
    System.out.println("stream-http-roundtrip-ok");
  }
}
