// ax-example:start
// title: Java Portable Cancellation
// group: generation
// description: Cancels a provider request before transport and preserves the first cancellation reason.
// provider: openai-compatible
// env: none
// level: intermediate
// order: 46
// ax-example:end
import dev.axllm.ax.*;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;

public final class CancellationExample {
  public static void main(String[] args) throws Exception {
    AtomicInteger calls = new AtomicInteger();
    OpenAICompatibleClient.Transport transport = request -> {
      calls.incrementAndGet();
      return Map.of("status", 200, "json", Map.of());
    };
    AxAIService client = new OpenAICompatibleClient(Map.of(
      "api_key", "test-key", "model", "gpt-5.6-luna", "transport", transport
    ));
    AxCancellationToken token = new AxCancellationToken();
    assert token.cancel("user stopped") && !token.cancel("later reason");

    try {
      client.chat(
        Map.of("chat_prompt", List.of(Map.of("role", "user", "content", "This must not be sent."))),
        Map.of(), token
      );
      throw new AssertionError("pre-cancelled request unexpectedly completed");
    } catch (AxAIServiceAbortedError error) {
      assert "user stopped".equals(error.reason()) && !error.retryable;
    }

    assert calls.get() == 0;
    System.out.println("cancelled before transport: user stopped");
  }
}
