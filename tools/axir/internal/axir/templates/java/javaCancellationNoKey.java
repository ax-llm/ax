import dev.axllm.ax.*;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;

public final class CancellationNoKeyExample {
  public static void main(String[] args) throws Exception {
    AtomicInteger calls = new AtomicInteger();
    OpenAICompatibleClient.Transport transport = request -> {
      calls.incrementAndGet();
      return Map.of("status", 200, "json", Map.of());
    };
    AxAIService client = new OpenAICompatibleClient(Map.of(
      "api_key", "test-key",
      "model", "gpt-5.6-luna",
      "transport", transport
    ));
    AxCancellationToken token = new AxCancellationToken();
    if (!token.cancel("user stopped") || token.cancel("later reason")) throw new AssertionError("cancellation was not one-shot");

    try {
      client.chat(
        Map.of("chat_prompt", List.of(Map.of("role", "user", "content", "This must not be sent."))),
        Map.of(),
        token
      );
      throw new AssertionError("pre-cancelled request unexpectedly completed");
    } catch (AxAIServiceAbortedError error) {
      if (!"user stopped".equals(error.reason()) || error.retryable) throw new AssertionError("wrong cancellation error");
    }

    if (calls.get() != 0) throw new AssertionError("pre-cancelled request reached transport");
    System.out.println("java-cancellation-no-key user stopped");
  }
}
