import dev.axllm.ax.*;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

public final class AxFlowProgramGraphExample {
  static final class ScriptedClient implements AiClient {
    final AtomicInteger calls = new AtomicInteger();

    public Map<String, Object> complete(Map<String, Object> request) {
      calls.incrementAndGet();
      return Map.of("content", "Answer: Paris");
    }
  }

  // A tracer and meter that record span and metric names.
  static final class Telemetry implements AxTracer, AxMeter {
    final List<String> spans = Collections.synchronizedList(new ArrayList<>());
    final List<String> metrics = Collections.synchronizedList(new ArrayList<>());

    public AxSpan startSpan(AxSpanStart start) {
      spans.add(start.name());
      return new AxSpan() {
        public void setAttributes(Map<String, Object> attributes) {}
        public void addEvent(String name, Map<String, Object> attributes) {}
        public void recordException(Throwable error) {}
        public void setStatus(String status, String description) {}
        public void end() {}
      };
    }

    public AxCounter createCounter(String name, AxMetricInstrumentOptions options) { return (value, attributes) -> metrics.add(name); }
    public AxHistogram createHistogram(String name, AxMetricInstrumentOptions options) { return (value, attributes) -> metrics.add(name); }
    public AxGauge createGauge(String name, AxMetricInstrumentOptions options) { return (value, attributes) -> metrics.add(name); }
  }

  static void check(boolean condition, String message) {
    if (!condition) throw new RuntimeException(message);
  }

  public static void main(String[] args) {
    AxGen qa = Ax.ax("question:string -> answer:string");
    AxFlow program = Ax.flow(Map.of("id", "example.flow")).execute("qa", qa).returns(Map.of("answer", "answer"));
    Map<String, Object> out = program.forward(new ScriptedClient(), Map.of("question", "Capital of France?"));
    if (!"Paris".equals(out.get("answer"))) throw new RuntimeException("bad output: " + out);
    if (!"qa".equals(((Map<?, ?>) ((List<?>) program.getPlan().get("steps")).get(0)).get("name"))) throw new RuntimeException("bad plan");

    // A caching function on the forward call caches the flow's output (and
    // its AxGen nodes' outputs). As in TypeScript, a flow hit runs no node and
    // records no span or metric.
    Map<String, Map<String, Object>> store = new ConcurrentHashMap<>();
    AxCachingFunction cache = (key, value) -> {
      if (value == null) return store.get(key);
      store.put(key, value);
      return null;
    };
    Telemetry telemetry = new Telemetry();
    program.setTracer(telemetry).setMeter(telemetry);
    ScriptedClient client = new ScriptedClient();
    Map<String, Object> france = Map.of("question", "Capital of France?");
    Map<String, Object> answer = Map.of("answer", "Paris");
    check(answer.equals(program.forward(client, france, Map.of("cachingFunction", cache))), "flow cache miss output");
    check(client.calls.get() == 1 && store.size() == 2, "a flow cache miss stores the flow's and its node's outputs: " + store.size());
    check(telemetry.spans.contains("ax_gen_flow_forward") && telemetry.metrics.contains("ax_gen_flow_requests_total"), "a flow cache miss run: " + telemetry.spans + " " + telemetry.metrics);
    int spans = telemetry.spans.size();
    int metrics = telemetry.metrics.size();
    check(answer.equals(program.forward(client, france, Map.of("cachingFunction", cache))), "flow cache hit output");
    List<Map<String, Object>> deltas = program.streamingForward(client, france, Map.of("cachingFunction", cache));
    check(deltas.equals(List.of(Map.of("version", 1, "index", 0, "delta", answer))), "streamed flow cache hit: " + deltas);
    check(client.calls.get() == 1, "a flow cache hit ran its nodes");
    List<String> hitSpans = new ArrayList<>(telemetry.spans.subList(spans, telemetry.spans.size()));
    List<String> hitMetrics = new ArrayList<>(telemetry.metrics.subList(metrics, telemetry.metrics.size()));
    check(hitSpans.isEmpty() && hitMetrics.isEmpty(), "flow cache hits recorded telemetry: " + hitSpans + " " + hitMetrics);
    System.out.println("java-axflow-ok");
  }
}
