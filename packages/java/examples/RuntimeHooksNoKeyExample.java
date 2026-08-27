import dev.axllm.ax.*;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;

public final class RuntimeHooksNoKeyExample {
  public static void main(String[] args) throws Exception {
    AtomicInteger calls = new AtomicInteger();
    AxRateLimiter limiter = (next, info) -> {
      if (!"chat".equals(info.operation()) || info.provider().isBlank()) throw new IllegalStateException(info.toString());
      calls.incrementAndGet();
      return next.execute();
    };
    OpenAICompatibleClient.Transport transport = request -> Map.of("status", 200, "json", Map.of(
        "model", "gpt-5.4-mini",
        "choices", List.of(Map.of("message", Map.of("content", "ok"), "finish_reason", "stop"))));
    AxAIService service = Ax.ai("openai", Map.of("model", "gpt-5.4-mini", "api_key", "test", "transport", transport));
    AxGlobals.setRateLimiter(limiter);
    try {
      service.chat(Map.of("chat_prompt", List.of(Map.of("role", "user", "content", "hello"))), Map.of());
      AxRuntimeHooks hooks = new AxRuntimeHooks(limiter, null, null);
      Ax.ax("input:string -> output:string", Map.of(), hooks).setTracer(null).setMeter(null);
      Ax.agent("input:string -> output:string", Map.of(), hooks).setTracer(null).setMeter(null);
      Ax.flow(Map.of("id", "runtime-hooks"), hooks).setTracer(null).setMeter(null);
    } finally {
      AxGlobals.setRateLimiter(null); AxGlobals.setTracer(null); AxGlobals.setMeter(null);
    }
    if (calls.get() != 1) throw new IllegalStateException("limiter calls: " + calls);
    System.out.println("java-runtime-hooks-no-key-ok");
  }
}
