import dev.axllm.ax.*;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.*;

public final class AxGenStreamingNoKeyExample {
  // Streams one scripted reply per request, chunk by chunk, and records the
  // requests and whether each provider stream was closed.
  static final class ScriptedStreamClient implements AiClient {
    final List<List<String>> replies;
    final List<Map<String, Object>> requests = new ArrayList<>();
    final AtomicInteger closedStreams = new AtomicInteger();

    ScriptedStreamClient(List<List<String>> replies) {
      this.replies = new ArrayList<>(replies);
    }

    public Map<String, Object> complete(Map<String, Object> request) {
      throw new UnsupportedOperationException("this client only streams");
    }

    @Override
    public AxChatStream openStream(Map<String, Object> request) {
      requests.add(request);
      if (replies.isEmpty()) throw new IllegalStateException("scripted client exhausted");
      Iterator<String> chunks = replies.remove(0).iterator();
      boolean[] finished = {false};
      return new AxChatStream(() -> {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("index", 0);
        if (chunks.hasNext()) result.put("content", chunks.next());
        else if (!finished[0]) { finished[0] = true; result.put("finish_reason", "stop"); }
        else return null;
        Map<String, Object> event = new LinkedHashMap<>();
        event.put("results", new ArrayList<>(List.of(result)));
        return event;
      }, closedStreams::incrementAndGet);
    }
  }

  // Merges a delta as TypeScript consumers do: strings and lists append, other
  // values replace, and a new version starts the sample over.
  static int merge(Map<String, Object> merged, int version, AxGenDelta delta) {
    if (delta.version() != version) merged.clear();
    for (Map.Entry<String, Object> entry : delta.delta().entrySet()) {
      Object previous = merged.get(entry.getKey());
      if (previous instanceof String text && entry.getValue() instanceof String more) merged.put(entry.getKey(), text + more);
      else if (previous instanceof List<?> items && entry.getValue() instanceof List<?> more) {
        List<Object> joined = new ArrayList<>(items);
        joined.addAll(more);
        merged.put(entry.getKey(), joined);
      } else merged.put(entry.getKey(), entry.getValue());
    }
    return delta.version();
  }

  static void check(boolean condition, String message) {
    if (!condition) throw new RuntimeException(message);
  }

  // An in-memory cachingFunction: apply(key, null) reads the stored output
  // (null for a miss) and apply(key, output) stores one.
  static AxCachingFunction memoryCache(Map<String, Map<String, Object>> store) {
    return (key, value) -> {
      if (value == null) return store.get(key);
      store.put(key, value);
      return null;
    };
  }

  // A tracer and meter that record span and metric names.
  static final class Telemetry implements AxTracer, AxMeter {
    final List<String> names = Collections.synchronizedList(new ArrayList<>());

    public AxSpan startSpan(AxSpanStart start) {
      names.add(start.name());
      return new AxSpan() {
        public void setAttributes(Map<String, Object> attributes) {}
        public void addEvent(String name, Map<String, Object> attributes) {}
        public void recordException(Throwable error) {}
        public void setStatus(String status, String description) {}
        public void end() {}
      };
    }

    public AxCounter createCounter(String name, AxMetricInstrumentOptions options) { return (value, attributes) -> names.add(name); }
    public AxHistogram createHistogram(String name, AxMetricInstrumentOptions options) { return (value, attributes) -> names.add(name); }
    public AxGauge createGauge(String name, AxMetricInstrumentOptions options) { return (value, attributes) -> names.add(name); }

    // The AxGen run telemetry recorded since the last call: ax_gen_forward
    // spans and ax_gen_generation_* metrics.
    List<String> takeRun() {
      synchronized (names) {
        List<String> run = new ArrayList<>();
        for (String name : names) if (name.equals("ax_gen_forward") || name.startsWith("ax_gen_generation_")) run.add(name);
        names.clear();
        return run;
      }
    }
  }

  public static void main(String[] args) throws Exception {
    // 1. A streamed forward with a streaming assertion, a streaming field
    //    processor, a TypeScript feedback processor, and field transforms.
    ScriptedStreamClient client = new ScriptedStreamClient(List.of(
        List.of("Answer: the ", "forbidden", " city\nNote: capital"),
        List.of("Answer: Pari", "ss\nNote:  capital  "),
        List.of("Answer: Paris\n", "Note:  capital  ")));
    List<String> streamedAnswers = new ArrayList<>();
    List<Object> feedbackValues = new ArrayList<>();
    AxGen gen = Ax.ax("question:string -> answer:string, note:string")
        .addStreamingAssert("answer", (text, done) -> text.contains("forbidden") ? "Do not say forbidden." : null, "Answer without forbidden words.")
        .addStreamingFieldProcessor("answer", (text, context) -> {
          streamedAnswers.add(String.valueOf(text));
          return null;
        })
        .addFieldProcessor("answer", (value, context) -> {
          feedbackValues.add(value);
          check(context.done() && context.values().containsKey("answer"), "feedback context: " + context);
          return "Pariss".equals(value) ? "Check the spelling." : null;
        }, AxFieldProcessorMode.FEEDBACK)
        .addFieldTransform("note", "trim")
        .addFieldProcessor("note", (value, context) -> String.valueOf(value).toUpperCase(), AxFieldProcessorMode.TRANSFORM);

    Map<String, Object> merged = new LinkedHashMap<>();
    int version = 0;
    SortedSet<Integer> versions = new TreeSet<>();
    try (AxGenDeltaStream stream = gen.streamingForward(client, Map.of("question", "Capital of France?"), Map.of())) {
      for (AxGenDelta delta : stream) {
        versions.add(delta.version());
        version = merge(merged, version, delta);
      }
    }
    check(Map.of("answer", "Paris", "note", "CAPITAL").equals(merged), "merged output: " + merged);
    check(versions.equals(new TreeSet<>(List.of(0, 1, 2))), "versions: " + versions);
    check(client.requests.size() == 3, "requests: " + client.requests.size());
    check(client.closedStreams.get() == 3, "closed provider streams: " + client.closedStreams.get());
    check(feedbackValues.equals(List.of("Pariss", "Paris")), "feedback processor values: " + feedbackValues);
    // A streaming processor sees the field's raw text so far.
    check(streamedAnswers.contains(" Pari"), "streaming processor chunks: " + streamedAnswers);
    String lastPrompt = Json.stringify(client.requests.get(2).get("chat_prompt"));
    check(lastPrompt.contains("Check the spelling."), "feedback missing from the next step: " + lastPrompt);
    String retryPrompt = Json.stringify(client.requests.get(1).get("chat_prompt"));
    check(retryPrompt.contains("Do not say forbidden."), "assertion correction missing from the retry: " + retryPrompt);

    // 2. Closing the stream early stops the run and closes the provider stream.
    ScriptedStreamClient early = new ScriptedStreamClient(List.of(List.of("Answer: one", " two", " three\nNote: n")));
    AxGen plain = Ax.ax("question:string -> answer:string, note:string");
    AxGenDeltaStream stopped = plain.streamingForward(early, Map.of("question", "Count"), Map.of());
    Iterator<AxGenDelta> iterator = stopped.iterator();
    check(iterator.hasNext(), "missing first delta");
    AxGenDelta first = iterator.next();
    check("one".equals(first.delta().get("answer")), "first delta: " + first);
    stopped.close();
    check(!iterator.hasNext(), "a closed stream kept yielding");
    check(early.closedStreams.get() == 1, "closing the stream left the provider stream open");
    check(early.requests.size() == 1, "closing the stream retried the request");
    try {
      stopped.iterator();
      throw new RuntimeException("a stream was consumed twice");
    } catch (IllegalStateException expected) {
      // single use
    }

    // 3. An exception a streaming assertion throws ends the forward without a
    //    retry. It reaches the consumer as "Generate failed: ...", with the
    //    exception it wraps as its cause, as TypeScript's AxGenerateError.
    ScriptedStreamClient failing = new ScriptedStreamClient(List.of(List.of("Answer: fine", " then boom", "\nNote: n")));
    AxGen strict = Ax.ax("question:string -> answer:string, note:string")
        .addStreamingAssert("answer", (text, done) -> {
          if (text.contains("boom")) throw new IllegalStateException("assertion exploded");
          return true;
        });
    List<AxGenDelta> beforeError = new ArrayList<>();
    try (AxGenDeltaStream stream = strict.streamingForward(failing, Map.of("question", "Status?"), Map.of())) {
      for (AxGenDelta delta : stream) beforeError.add(delta);
      throw new RuntimeException("the assertion error was not rethrown");
    } catch (AxGenerateError expected) {
      check(expected.getCause() instanceof IllegalStateException, "original assertion type was lost");
      check("Generate failed: assertion exploded".equals(expected.getMessage()), "error message: " + expected.getMessage());
      check(expected.getCause() != null && "assertion exploded".equals(expected.getCause().getMessage()), "error cause: " + expected.getCause());
    }
    check(!beforeError.isEmpty(), "deltas before the error were not delivered");
    check(failing.requests.size() == 1, "an assertion error was retried");

    // 4. Cancelling the token aborts the run with AxAIServiceAbortedError.
    ScriptedStreamClient slow = new ScriptedStreamClient(List.of(List.of("Answer: first", " second", " third\nNote: n")));
    AxCancellationToken token = new AxCancellationToken();
    try (AxGenDeltaStream stream = plain.streamingForward(slow, Map.of("question", "Count"), Map.of(), token)) {
      for (AxGenDelta delta : stream) token.cancel("user stopped");
      throw new RuntimeException("cancellation did not abort the stream");
    } catch (AxAIServiceAbortedError expected) {
      check(expected.getMessage().contains("user stopped"), "abort message: " + expected.getMessage());
    }

    // 5. Through a provider client and its SSE parser: a forward that names no
    //    model streams with the client's model.
    List<Object> sentModels = new ArrayList<>();
    OpenAICompatibleClient.Transport transport = call -> {
      sentModels.add(((Map<?, ?>) call.get("json")).get("model"));
      return Map.of("status", 200, "body",
          "data: {\"id\":\"c1\",\"model\":\"gpt-5.4-mini\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"Answer: Par\"}}]}\n\n"
              + "data: {\"id\":\"c1\",\"model\":\"gpt-5.4-mini\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"is\"},\"finish_reason\":\"stop\"}]}\n\n"
              + "data: [DONE]\n\n");
    };
    OpenAICompatibleClient provider = new OpenAICompatibleClient(Map.of("api_key", "test-key", "model", "gpt-5.4-mini", "transport", transport));
    Map<String, Object> providerMerged = new LinkedHashMap<>();
    int providerVersion = 0;
    try (AxGenDeltaStream stream = Ax.ax("question:string -> answer:string").streamingForward(provider, Map.of("question", "Capital of France?"), Map.of())) {
      for (AxGenDelta delta : stream) providerVersion = merge(providerMerged, providerVersion, delta);
    }
    check(Map.of("answer", "Paris").equals(providerMerged), "provider stream output: " + providerMerged);
    check(sentModels.equals(List.of("gpt-5.4-mini")), "streamed request models: " + sentModels);

    // 6. A cachingFunction from the constructor, the forward call or
    //    AxGlobals: a hit sends no request, and streamingForward yields it as
    //    one delta. As in TypeScript, the cache is read before the run
    //    starts, so a hit records no ax_gen_forward span and no
    //    ax_gen_generation_* metric.
    AtomicInteger completions = new AtomicInteger();
    AiClient counting = request -> {
      completions.incrementAndGet();
      return Map.of("content", "Answer: Paris");
    };
    Map<String, Object> france = Map.of("question", "Capital of France?");
    Map<String, Map<String, Object>> store = new ConcurrentHashMap<>();
    Telemetry telemetry = new Telemetry();
    AxGen cachedGen = new AxGen(Ax.s("question:string -> answer:string"), Map.of("cachingFunction", memoryCache(store)))
        .setTracer(telemetry)
        .setMeter(telemetry);
    Map<String, Object> stored = cachedGen.forward(counting, france);
    List<String> missRun = telemetry.takeRun();
    check(missRun.contains("ax_gen_forward") && missRun.contains("ax_gen_generation_requests_total"), "a cache miss run: " + missRun);
    Map<String, Object> hit = cachedGen.forward(counting, france);
    Map<String, Object> streamedHit = cachedGen.forward(counting, france, Map.of("stream", true));
    check(Map.of("answer", "Paris").equals(stored) && stored.equals(hit) && stored.equals(streamedHit), "cached outputs: " + stored + ", " + hit + ", " + streamedHit);
    check(completions.get() == 1 && store.size() == 1, "a cache hit sent a request: " + completions.get());
    List<String> hitRun = telemetry.takeRun();
    check(hitRun.isEmpty(), "forward cache hits recorded run telemetry: " + hitRun);
    List<AxGenDelta> cachedDeltas = new ArrayList<>();
    try (AxGenDeltaStream stream = cachedGen.streamingForward(counting, france, Map.of())) {
      for (AxGenDelta delta : stream) cachedDeltas.add(delta);
    }
    check(cachedDeltas.equals(List.of(new AxGenDelta(0, 0, Map.of("answer", "Paris")))), "cached deltas: " + cachedDeltas);
    check(completions.get() == 1, "a streamed cache hit sent a request");
    List<String> streamedHitRun = telemetry.takeRun();
    check(streamedHitRun.isEmpty(), "a streamed cache hit recorded run telemetry: " + streamedHitRun);
    // A streamed miss runs, and records its run telemetry.
    Map<String, Object> spain = Map.of("question", "Capital of Spain?");
    try (AxGenDeltaStream stream = cachedGen.streamingForward(counting, spain, Map.of())) {
      for (AxGenDelta delta : stream) check(delta.version() == 0, "streamed miss delta: " + delta);
    }
    List<String> streamedMissRun = telemetry.takeRun();
    check(completions.get() == 2 && store.size() == 2, "a streamed cache miss: " + completions.get());
    check(streamedMissRun.contains("ax_gen_forward") && streamedMissRun.contains("ax_gen_generation_requests_total"), "a streamed cache miss run: " + streamedMissRun);
    // The forward call's function comes before the constructor's; the
    // caching_function key works too.
    Map<String, Map<String, Object>> callStore = new ConcurrentHashMap<>();
    cachedGen.forward(counting, france, Map.of("cachingFunction", memoryCache(callStore)));
    cachedGen.forward(counting, Map.of("question", "Capital of Italy?"), Map.of("caching_function", memoryCache(callStore)));
    check(completions.get() == 4 && callStore.size() == 2 && store.size() == 2, "per-call cache: " + callStore.keySet());
    // A run control skips the cache.
    cachedGen.forward(counting, france, Map.of("control", new AxRunControl()));
    check(completions.get() == 5, "a controlled run read the cache");
    // The process-wide function applies when neither the call nor the
    // constructor sets one; null clears it.
    Map<String, Map<String, Object>> globalStore = new ConcurrentHashMap<>();
    AxGlobals.setCachingFunction(memoryCache(globalStore));
    try {
      AxGen globalGen = Ax.ax("question:string -> answer:string");
      globalGen.forward(counting, france);
      globalGen.forward(counting, france);
      check(completions.get() == 6 && globalStore.size() == 1, "global cache: " + completions.get());
    } finally {
      AxGlobals.setCachingFunction(null);
    }
    Ax.ax("question:string -> answer:string").forward(counting, france);
    check(completions.get() == 7, "a cleared global cache still answered");

    System.out.println("java-axgen-streaming-ok " + merged);
  }
}
