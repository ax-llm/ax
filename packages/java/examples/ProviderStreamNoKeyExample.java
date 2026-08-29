import dev.axllm.ax.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.atomic.*;

public final class ProviderStreamNoKeyExample {
  public static void main(String[] args) throws Exception {
    OpenAICompatibleClient.Transport transport = request -> Map.of(
      "status", 200,
      "body", "data: {\"id\":\"chatcmpl_stream\",\"model\":\"gpt-5.4-mini\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"hel\"}}]}\n\n"
        + "data: {\"id\":\"chatcmpl_stream\",\"model\":\"gpt-5.4-mini\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"lo\"},\"finish_reason\":\"stop\"}]}\n\n"
        + "data: {\"id\":\"chatcmpl_stream\",\"model\":\"gpt-5.4-mini\",\"choices\":[],\"usage\":{\"prompt_tokens\":1,\"completion_tokens\":2,\"total_tokens\":3}}\n\n"
        + "data: [DONE]\n\n"
    );
    OpenAICompatibleClient client = new OpenAICompatibleClient(Map.of(
      "api_key", "test-key",
      "model", "gpt-5.4-mini",
      "transport", transport
    ));
    StringBuilder text = new StringBuilder();
    List<AxUsageEvent> usageEvents = new ArrayList<>();
    AxGlobals.setUsageObserver(usageEvents::add);
    for (Map<String, Object> event : client.stream(Map.of("chat_prompt", List.of(Map.of("role", "user", "content", "stream"))))) {
      List<?> results = (List<?>) event.get("results");
      if (!results.isEmpty()) {
        Object content = ((Map<?, ?>) results.get(0)).get("content");
        if (content != null) text.append(content);
      }
    }
    AxGlobals.setUsageObserver(null);
    if (!"hello".contentEquals(text)) throw new RuntimeException("bad stream: " + text);
    if (usageEvents.size() != 1) throw new RuntimeException("usage was not delivered after completion: " + usageEvents);

    AtomicInteger opened = new AtomicInteger();
    AtomicBoolean closed = new AtomicBoolean();
    OpenAICompatibleClient.Transport incremental = new OpenAICompatibleClient.Transport() {
      @Override public Object call(Map<String, Object> request) { return Map.of("status", 200, "body", ""); }
      @Override public Object stream(Map<String, Object> request) {
        opened.incrementAndGet();
        byte[] bytes = ("data: {\"id\":\"chatcmpl_cancel\",\"model\":\"gpt-5.4-mini\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"first 🌍\"}}]}\\r\\n\\r\\n"
          + "data: {\"id\":\"chatcmpl_cancel\",\"model\":\"gpt-5.4-mini\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"second\"}}]}\\r\\n\\r\\n").getBytes(StandardCharsets.UTF_8);
        return new ByteArrayInputStream(bytes) {
          @Override public int read(byte[] target, int offset, int length) {
            return super.read(target, offset, Math.min(length, 1));
          }
          @Override public void close() throws IOException { closed.set(true); super.close(); }
        };
      }
    };
    OpenAICompatibleClient cancelClient = new OpenAICompatibleClient(Map.of("api_key", "test-key", "model", "gpt-5.4-mini", "transport", incremental));
    AxChatStream lazy = cancelClient.stream(Map.of("chat_prompt", List.of(Map.of("role", "user", "content", "cancel"))));
    if (opened.get() != 0) throw new RuntimeException("stream() opened eagerly");
    Iterator<Map<String, Object>> iterator = lazy.iterator();
    if (!iterator.hasNext() || opened.get() != 1) throw new RuntimeException("lazy stream did not open on first pull");
    lazy.close();
    if (!closed.get()) throw new RuntimeException("consumer cancellation did not close the upstream stream");

    AtomicInteger attempts = new AtomicInteger();
    OpenAICompatibleClient.Transport failing = new OpenAICompatibleClient.Transport() {
      @Override public Object call(Map<String, Object> request) { return Map.of("status", 200, "body", ""); }
      @Override public Object stream(Map<String, Object> request) {
        attempts.incrementAndGet();
        byte[] prefix = "data: {\"id\":\"chatcmpl_failure\",\"model\":\"gpt-5.4-mini\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"delivered\"}}]}\n\n".getBytes(StandardCharsets.UTF_8);
        return new InputStream() {
          int index;
          @Override public int read() throws IOException {
            if (index < prefix.length) return prefix[index++] & 0xff;
            throw new IOException("upstream closed");
          }
        };
      }
    };
    OpenAICompatibleClient failureClient = new OpenAICompatibleClient(Map.of("api_key", "test-key", "model", "gpt-5.4-mini", "transport", failing));
    try (AxChatStream failureStream = failureClient.openStream(Map.of("chat_prompt", List.of(Map.of("role", "user", "content", "fail"))))) {
      Iterator<Map<String, Object>> failureIterator = failureStream.iterator();
      if (!failureIterator.hasNext()) throw new RuntimeException("missing first event");
      failureIterator.next();
      try {
        failureIterator.hasNext();
        throw new RuntimeException("mid-stream failure was not surfaced");
      } catch (RuntimeException expected) {
        if (expected.getMessage() != null && expected.getMessage().contains("was not surfaced")) throw expected;
      }
    }
    if (attempts.get() != 1) throw new RuntimeException("mid-stream failure replayed the request");
    System.out.println("java-provider-stream-no-key " + text);
  }
}
