// ax-example:start
// title: Portable Runtime Hooks
// group: generation
// description: Applies global and forward-scoped rate limiting, tracing, and metrics to AxGen, AxAgent, and AxFlow.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: advanced
// order: 46
// ax-example:end
import dev.axllm.ax.*;
import dev.axllm.ax.runtime.quickjs.*;
import java.util.*;

public final class RuntimeHooksExample {
  static final class LogSpan implements AxSpan {
    private final String name;
    LogSpan(String name) { this.name = name; System.out.println("[span:start] " + name); }
    public void setAttributes(Map<String, Object> attributes) {}
    public void addEvent(String event, Map<String, Object> attributes) { System.out.println("[span:event] " + name + " " + event); }
    public void recordException(Throwable error) { System.out.println("[span:error] " + name + " " + error); }
    public void setStatus(String status, String description) {}
    public void end() { System.out.println("[span:end] " + name); }
  }

  static final class LogMeter implements AxMeter {
    public AxCounter createCounter(String name, AxMetricInstrumentOptions options) {
      return (value, attributes) -> System.out.println("[metric] " + name + " += " + value);
    }
    public AxHistogram createHistogram(String name, AxMetricInstrumentOptions options) {
      return (value, attributes) -> System.out.println("[metric] " + name + " = " + value);
    }
    public AxGauge createGauge(String name, AxMetricInstrumentOptions options) {
      return (value, attributes) -> System.out.println("[metric] " + name + " = " + value);
    }
  }

  static AxRateLimiter limiter(String label) {
    return (next, info) -> {
      System.out.printf("[limit:%s] %s %s/%s stream=%s%n", label, info.operation(), info.provider(), info.model(), info.streaming());
      return next.execute();
    };
  }

  public static void main(String[] args) throws Exception {
    String apiKey = System.getenv("OPENAI_API_KEY");
    if (apiKey == null || apiKey.isBlank()) apiKey = System.getenv("OPENAI_APIKEY");
    if (apiKey == null || apiKey.isBlank()) throw new IllegalStateException("Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.");
    OpenAICompatibleClient client = new OpenAICompatibleClient(Map.of(
        "api_key", apiKey,
        "model", System.getenv().getOrDefault("AX_OPENAI_MODEL", "gpt-5.4-mini"),
        "model_config", Map.of("temperature", 0.0)));
    AxTracer tracer = start -> new LogSpan(start.name());
    AxMeter meter = new LogMeter();
    AxRuntimeHooks overrideHooks = new AxRuntimeHooks(limiter("forward"), tracer, meter);

    AxGlobals.setRateLimiter(limiter("global"));
    AxGlobals.setTracer(tracer);
    AxGlobals.setMeter(meter);
    try {
      System.out.println(Ax.ax("topic:string -> summary:string").forward(client, Map.of("topic", "portable Ax runtime hooks")));
      AxAgent helper = Ax.agent("question:string -> answer:string", Map.of());
      try (AxQuickJsCodeRuntime runtime = new AxQuickJsCodeRuntime()) {
        System.out.println(helper.forward(client, Map.of("question", "What does a rate limiter wrap?"), Map.of("runtime", runtime, "max_actor_steps", 12), overrideHooks));
      }
      AxFlow workflow = Ax.flow(Map.of("id", "examples.runtimeHooks"))
          .execute("outline", Ax.ax("topic:string -> outline:string"))
          .execute("polish", Ax.ax("outline:string -> answer:string"))
          .returns(Map.of("answer", "polish"));
      System.out.println(workflow.forward(client, Map.of("topic", "Ax runtime hooks"), Map.of(), overrideHooks));
    } finally {
      AxGlobals.setRateLimiter(null);
      AxGlobals.setTracer(null);
      AxGlobals.setMeter(null);
    }
  }
}
