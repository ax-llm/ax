package dev.axllm.ax;

import java.io.ByteArrayOutputStream;
import java.io.BufferedReader;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

public class OpenAICompatibleClient extends AxBaseAI {
  public interface Transport {
    Object call(Map<String, Object> request) throws Exception;
    default Object stream(Map<String, Object> request) throws Exception { return call(request); }
  }

  private static final class RawSseStream implements AutoCloseable {
    private final BufferedReader reader;
    private final Iterator<?> events;
    private final AutoCloseable close;
    private final List<String> dataLines = new ArrayList<>();
    private boolean atStart = true;
    private boolean closed;

    private RawSseStream(BufferedReader reader, Iterator<?> events, AutoCloseable close) {
      this.reader = reader;
      this.events = events;
      this.close = close;
    }

    static RawSseStream from(Object raw) {
      if (raw instanceof InputStream input) {
        return new RawSseStream(new BufferedReader(new InputStreamReader(input, StandardCharsets.UTF_8)), null, input);
      }
      if (raw instanceof byte[] bytes) {
        ByteArrayInputStream input = new ByteArrayInputStream(bytes);
        return new RawSseStream(new BufferedReader(new InputStreamReader(input, StandardCharsets.UTF_8)), null, input);
      }
      if (raw instanceof Iterable<?> iterable && !(raw instanceof String)) {
        AutoCloseable close = raw instanceof AutoCloseable closeable ? closeable : () -> {};
        return new RawSseStream(null, iterable.iterator(), close);
      }
      ByteArrayInputStream input = new ByteArrayInputStream(String.valueOf(raw == null ? "" : raw).getBytes(StandardCharsets.UTF_8));
      return new RawSseStream(new BufferedReader(new InputStreamReader(input, StandardCharsets.UTF_8)), null, input);
    }

    Object nextEvent() throws Exception {
      if (closed) return null;
      if (events != null) {
        while (events.hasNext()) {
          Object event = events.next();
          if ("[DONE]".equals(String.valueOf(event))) { close(); return null; }
          return event;
        }
        close();
        return null;
      }
      while (true) {
        String line = reader.readLine();
        if (line == null) {
          Object event = flushEvent();
          close();
          return event;
        }
        if (atStart) {
          atStart = false;
          if (line.startsWith("\uFEFF")) line = line.substring(1);
        }
        if (line.isEmpty()) {
          Object event = flushEvent();
          if (closed || event != null) return event;
          continue;
        }
        if (line.startsWith(":")) continue;
        int colon = line.indexOf(':');
        String field = colon < 0 ? line : line.substring(0, colon);
        String value = colon < 0 ? "" : line.substring(colon + 1);
        if (value.startsWith(" ")) value = value.substring(1);
        if ("data".equals(field)) dataLines.add(value);
      }
    }

    private Object flushEvent() throws Exception {
      if (dataLines.isEmpty()) return null;
      String payload = String.join("\n", dataLines);
      dataLines.clear();
      if ("[DONE]".equals(payload.trim())) { close(); return null; }
      return Json.parse(payload);
    }

    @Override public void close() throws Exception {
      if (closed) return;
      closed = true;
      close.close();
    }
  }

  public record CredentialRequest(String profile, String operation, String method, String url) {}

  @FunctionalInterface
  public interface CredentialProvider {
    Map<String, String> credentials(CredentialRequest request) throws Exception;
  }

  // Host registries receive a tenant namespace separately from the stable
  // provider:model:contentHash key.
  public interface ContextCacheRegistry {
    Map<String,Object> get(String namespace, String key);
    void set(String namespace, String key, Map<String,Object> entry);
  }

  private static final String MULTIPART_BOUNDARY = "----axllmFormBoundary" + UUID.randomUUID().toString().replace("-", "");

  protected final String profile;
  private final Map<String, Object> descriptor;
  private final String baseUrl;
  private final String apiKey;
  private final String apiVersion;
  private final double timeoutSeconds;
  private final Transport transport;
  private final CredentialProvider credentialProvider;
  private final HttpClient http = HttpClient.newHttpClient();
  private final Map<String, Map<String,Object>> contextCacheEntries = new LinkedHashMap<>();

  public OpenAICompatibleClient(String model) {
    this(Map.of("model", model));
  }

  public OpenAICompatibleClient(Map<String, Object> options) {
    this("openai-compatible", "openai", options == null ? Map.of() : options, "gpt-4.1-mini", "text-embedding-3-small");
  }

  public OpenAICompatibleClient(String profile, String name, Map<String, Object> options, String defaultModel, String defaultEmbedModel) {
    super(
      name,
      String.valueOf(options.getOrDefault("model", defaultModel)),
      String.valueOf(options.getOrDefault("embed_model", options.getOrDefault("embedModel", defaultEmbedModel))),
      Core.asMap(options.get("model_config")),
      Core.asMap(Core.mapMerge(options, Core.asMap(options.get("options"))))
    );
    this.profile = profile == null || profile.isBlank() ? "openai-compatible" : profile;
    Map<String, Object> resolvedOptions = Core.asMap(Core.mapMerge(options, Core.asMap(options.get("options"))));
    this.descriptor = Core.asMap(Core.provider_resolve_descriptor(this.profile, resolvedOptions));
    String descriptorBaseUrl = String.valueOf(this.descriptor.getOrDefault("baseUrl", "https://api.openai.com/v1"));
    this.baseUrl = String.valueOf(options.getOrDefault("base_url", options.getOrDefault("baseUrl", System.getenv().getOrDefault("OPENAI_BASE_URL", descriptorBaseUrl)))).replaceAll("/+$", "");
    this.apiKey = String.valueOf(options.getOrDefault("api_key", options.getOrDefault("apiKey", System.getenv("OPENAI_API_KEY"))));
    this.apiVersion = String.valueOf(this.descriptor.getOrDefault("apiVersion", options.getOrDefault("api_version", options.getOrDefault("apiVersion", ""))));
    Object timeout = options.getOrDefault("timeout", 60.0);
    this.timeoutSeconds = timeout instanceof Number n ? n.doubleValue() : 60.0;
    this.transport = options.get("transport") instanceof Transport t ? t : null;
    Object rawCredentialProvider = options.getOrDefault("credential_provider", options.get("credentialProvider"));
    this.credentialProvider = rawCredentialProvider instanceof CredentialProvider provider ? provider : null;
    if (Core.truthy(this.descriptor.get("authRequired")) &&
        (this.apiKey == null || this.apiKey.isBlank() || "null".equals(this.apiKey)) &&
        this.credentialProvider == null) {
      throw new AxAIServiceAuthenticationError(profile + " requires api_key or credential_provider", null, null, null, null);
    }
  }

  @Override
  public double getEstimatedCost(Map<String, Object> modelUsage) {
    return Core.asDouble(Core.provider_estimate_cost(modelUsage == null ? Map.of() : modelUsage));
  }

  @Override
  public Map<String, Object> getFeatures(String model) {
    return Core.asMap(Core.provider_resolve_features(
      profile,
      model == null || model.isBlank() ? this.model : model,
      options
    ));
  }

  protected Map<String, Object> doChat(Map<String, Object> request, Map<String, Object> options) throws Exception {
    Object realtimeModel = request.getOrDefault("model", model);
    if (Boolean.TRUE.equals(Core.provider_should_use_realtime(profile, String.valueOf(realtimeModel), request, options))) {
      return realtimeChat(request, null);
    }
    Map<String, Object> payload = Core.asMap(Core.provider_build_chat_request(profile, request, options));
    Object stream = payload.get("stream");
    if (Boolean.TRUE.equals(stream)) {
      Object modelName = request.getOrDefault("model", payload.getOrDefault("model", model));
      return Map.of("results", streamEvents(payload, modelName));
    }
    Object modelName = request.getOrDefault("model", payload.getOrDefault("model", model));
    Object raw = contextCacheChat(request, options, payload, modelName);
    if (raw == null) raw = requestJson(operationPath("chat", modelName), payload, false, "json", false, operationMethod("chat"), "openai-responses".equals(descriptor.get("transport")) ? "responses" : "chat");
    return Core.asMap(Core.provider_normalize_chat_response(profile, raw, name, modelName));
  }

  protected Map<String, Object> doEmbed(Map<String, Object> request, Map<String, Object> options) throws Exception {
    Map<String, Object> payload = Core.asMap(Core.provider_build_embed_request(profile, request, options));
    Object modelName = request.getOrDefault("embed_model", request.getOrDefault("embedModel", payload.getOrDefault("model", embedModel)));
    Object raw = requestJson(operationPath("embed", modelName), payload, false, "json", false, operationMethod("embed"), "embed");
    return Core.asMap(Core.provider_normalize_embed_response(profile, raw, name, modelName));
  }

  @SuppressWarnings("unchecked")
  private Object contextCacheChat(Map<String,Object> request, Map<String,Object> options, Map<String,Object> payload, Object modelName) throws Exception {
    Object rawCfg = options.getOrDefault("contextCache", options.get("context_cache"));
    boolean supported = Core.truthy(Core.asMap(Core.asMap(descriptor.get("features")).get("caching")).get("supported"));
    if (!"google-gemini".equals(profile) || !supported || !Core.truthy(rawCfg)) return null;
    Map<String,Object> cfg = rawCfg instanceof Map<?,?> ? Core.asMap(rawCfg) : new LinkedHashMap<>();
    String explicit = String.valueOf(cfg.getOrDefault("name", cfg.getOrDefault("cacheName", cfg.getOrDefault("cache_name", ""))));
    if (!explicit.isBlank()) {
      Map<String,Object> cached = new LinkedHashMap<>(payload);
      cached.put("cachedContent", explicit);
      return requestJson(operationPath("chat", modelName), cached, false, "json", false, operationMethod("chat"));
    }
    List<Object> prompts = Core.asList(request.getOrDefault("chat_prompt", request.getOrDefault("chatPrompt", request.getOrDefault("messages", List.of()))));
    int nonSystem = 0, cachedCount = 0;
    for (Object raw : prompts) {
      Map<String,Object> prompt = Core.asMap(raw);
      if ("system".equals(String.valueOf(prompt.getOrDefault("role", "")))) continue;
      nonSystem++;
      if (Core.truthy(prompt.get("cache"))) cachedCount = nonSystem;
    }
    Map<String,Object> cacheBody = new LinkedHashMap<>();
    for (String key : List.of("systemInstruction", "tools", "toolConfig")) if (payload.containsKey(key)) cacheBody.put(key, payload.get(key));
    List<Object> contents = Core.asList(payload.getOrDefault("contents", List.of()));
    if (cachedCount > 0) cacheBody.put("contents", new ArrayList<>(contents.subList(0, Math.min(cachedCount, contents.size()))));
    if (!cacheBody.containsKey("systemInstruction") && Core.asList(cacheBody.get("contents")).isEmpty()) return null;
    String encoded = String.valueOf(Core.jsonStableStringify(cacheBody));
    int minTokens = Core.asInt(cfg.getOrDefault("minTokens", cfg.getOrDefault("min_tokens", 2048)));
    boolean eligible = Math.ceil(encoded.length() / 4.0) >= minTokens;
    int ttlSeconds = Core.asInt(cfg.getOrDefault("ttlSeconds", cfg.getOrDefault("ttl_seconds", 3600)));
    long refreshWindow = (long)(Core.asDouble(cfg.getOrDefault("refreshWindowSeconds", cfg.getOrDefault("refresh_window_seconds", 300))) * 1000);
    String contentHash;
    try { contentHash = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(encoded.getBytes(StandardCharsets.UTF_8))); }
    catch (Exception error) { throw new AxAIServiceError("Unable to hash context cache content: " + error.getMessage()); }
    String cacheKey = profile + ":" + modelName + ":" + contentHash;
    String namespace = String.valueOf(cfg.getOrDefault("namespace", "default"));
    ContextCacheRegistry registry = cfg.get("registry") instanceof ContextCacheRegistry value ? value : null;
    java.util.function.Supplier<Map<String,Object>> getEntry = () -> {
      Map<String,Object> value = registry == null ? contextCacheEntries.get(cacheKey) : registry.get(namespace, cacheKey);
      return value == null ? new LinkedHashMap<>() : new LinkedHashMap<>(value);
    };
    java.util.function.Consumer<Map<String,Object>> setEntry = value -> {
      if (registry == null) contextCacheEntries.put(cacheKey, new LinkedHashMap<>(value)); else registry.set(namespace, cacheKey, new LinkedHashMap<>(value));
    };
    Map<String,Object> plan = Core.asMap(Core.ai_context_cache_plan(true, true, "", getEntry.get(), System.currentTimeMillis(), refreshWindow, eligible));
    String[] cacheName = {String.valueOf(plan.getOrDefault("cacheName", ""))};
    java.util.function.Function<Object,Long> expiry = value -> {
      Object raw = Core.asMap(value).getOrDefault("expireTime", Core.asMap(value).get("expire_time"));
      long millis = raw instanceof Number n ? n.longValue() : 0;
      if (raw instanceof String text) try { millis = Instant.parse(text).toEpochMilli(); } catch (RuntimeException ignored) {}
      return (long)Core.asDouble(Core.ai_context_cache_expiry(millis, System.currentTimeMillis()));
    };
    java.util.function.Function<Object,Object> callOp = value -> {
      Map<String,Object> op = Core.asMap(value);
      try {
        String endpoint = String.valueOf(op.get("path"));
        if (op.get("base_url") != null) endpoint = String.valueOf(op.get("base_url")).replaceAll("/+$", "") + endpoint;
        return requestJson(endpoint, Core.asMap(op.get("request")), false, "json", false, String.valueOf(op.getOrDefault("method", "POST")));
      }
      catch (Exception error) { if (error instanceof RuntimeException runtime) throw runtime; throw new RuntimeException(error); }
    };
    java.util.function.BooleanSupplier create = () -> {
      try {
        Map<String,Object> ops = Core.asMap(Core.ai_gemini_cache_ops("", ttlSeconds, apiKey, String.valueOf(modelName), cacheBody, options));
        Object created = callOp.apply(ops.get("create"));
        cacheName[0] = String.valueOf(Core.asMap(created).getOrDefault("name", ""));
        long expiresAt = expiry.apply(created);
        if (cacheName[0].isBlank() || expiresAt == 0) return false;
        setEntry.accept(new LinkedHashMap<>(Map.of("cacheName", cacheName[0], "expiresAt", expiresAt)));
        return true;
      } catch (AxAIServiceError error) { return false; }
    };
    String action = String.valueOf(plan.getOrDefault("action", "none"));
    if ("refresh".equals(action)) {
      try {
        Map<String,Object> ops = Core.asMap(Core.ai_gemini_cache_ops(cacheName[0], ttlSeconds, apiKey, String.valueOf(modelName), cacheBody, options));
        Object refreshed = callOp.apply(ops.get("update"));
        long expiresAt = expiry.apply(refreshed);
        if (expiresAt == 0) throw new AxAIServiceResponseError("Gemini cache refresh omitted a future expireTime", refreshed);
        setEntry.accept(new LinkedHashMap<>(Map.of("cacheName", cacheName[0], "expiresAt", expiresAt)));
      } catch (AxAIServiceError error) {
        if (!create.getAsBoolean()) return requestJson(operationPath("chat", modelName), payload, false, "json", false, operationMethod("chat"));
      }
    } else if ("create".equals(action)) {
      if (!create.getAsBoolean()) return requestJson(operationPath("chat", modelName), payload, false, "json", false, operationMethod("chat"));
    } else if ("none".equals(action)) return null;
    if (cacheName[0].isBlank()) return null;
    Map<String,Object> cached = new LinkedHashMap<>(payload);
    cached.remove("systemInstruction"); cached.remove("tools"); cached.remove("toolConfig");
    cached.put("contents", new ArrayList<>(contents.subList(Math.min(cachedCount, contents.size()), contents.size())));
    cached.put("cachedContent", cacheName[0]);
    try {
      return requestJson(operationPath("chat", modelName), cached, false, "json", false, operationMethod("chat"));
    } catch (AxAIServiceError error) {
      if (!Core.truthy(Core.ai_context_cache_rejection(error.status == null ? 0 : error.status, error.responseBody))) throw error;
      Map<String,Object> recovery = Core.asMap(Core.ai_context_cache_recovery(getEntry.get(), cacheName[0], registry != null));
      if (Core.truthy(recovery.get("invalidated"))) {
        if (registry != null) registry.set(namespace, cacheKey, Core.asMap(recovery.get("externalEntry")));
        else if (Core.truthy(recovery.get("deleteInMemory"))) contextCacheEntries.remove(cacheKey);
      }
      return requestJson(operationPath("chat", modelName), payload, false, "json", false, operationMethod("chat"));
    }
  }

  protected List<Map<String, Object>> streamEvents(Map<String, Object> payload, Object modelName) throws Exception {
    List<Map<String, Object>> out = new ArrayList<>();
    try (AxChatStream stream = streamEventsIncremental(payload, modelName)) {
      for (Map<String, Object> event : stream) out.add(event);
    }
    return out;
  }

  protected AxChatStream streamEventsIncremental(Map<String, Object> payload, Object modelName) throws Exception {
    Map<String, Object> retryCfg = Core.asMap(Core.resolve_stream_retry(options));
    int maxRetries = Core.asInt(retryCfg.getOrDefault("max_retries", 3));
    double initialDelay = Core.asDouble(retryCfg.getOrDefault("initial_delay_ms", 1000));
    double maxDelay = Core.asDouble(retryCfg.getOrDefault("max_delay_ms", 60000));
    double backoff = Core.asDouble(retryCfg.getOrDefault("backoff_factor", 2));
    int attempt = 0;
    while (true) {
      RawSseStream raw = null;
      Object first;
      try {
        raw = requestSse(operationPath("stream_chat", modelName), payload, modelName);
        first = raw.nextEvent();
      } catch (Exception failure) {
        if (raw != null) try { raw.close(); } catch (Exception ignored) {}
        AxAIServiceError error = failure instanceof AxAIServiceError serviceError
            ? serviceError
            : new AxAIServiceNetworkError(failure.getMessage() == null ? failure.toString() : failure.getMessage());
        boolean retryable = error instanceof AxAIServiceNetworkError
            || error instanceof AxAIServiceResponseError
            || error instanceof AxAIServiceStreamTerminatedError
            || error instanceof AxAIServiceTimeoutError
            || error instanceof AxAIServiceStatusError && error.status != null && Core.truthy(Core.is_retryable_status(error.status));
        if (!retryable || attempt >= maxRetries) throw error;
        attempt++;
        double delay = Math.min(initialDelay * Math.pow(backoff, attempt - 1), maxDelay);
        if (delay > 0) Thread.sleep((long) delay);
        continue;
      }
      // Pre-content streaming retry: peek the first raw SSE event before any stateful normalize
      // runs (so peeking has no side effects); if the provider classifies it as a retryable
      // transient status (e.g. Anthropic's HTTP-200 overloaded_error event), re-issue with the
      // same exponential backoff apiCall uses for a 529 before surfacing.
      if (first != null) {
        Object status = Core.provider_classify_stream_error_status(profile, first);
        if (status != null && Core.truthy(Core.is_retryable_status(status)) && attempt < maxRetries) {
          raw.close();
          attempt++;
          double delay = Math.min(initialDelay * Math.pow(backoff, attempt - 1), maxDelay);
          if (delay > 0) Thread.sleep((long) delay);
          continue;
        }
      }
      Map<String, Object> state = new LinkedHashMap<>();
      Map<String, Object> firstNormalized = first == null ? null : Core.asMap(Core.provider_normalize_stream_delta(profile, first, state, name, modelName));
      boolean[] emitFirst = {firstNormalized != null};
      RawSseStream selectedRaw = raw;
      return new AxChatStream(
        () -> {
          if (emitFirst[0]) { emitFirst[0] = false; return firstNormalized; }
          try {
            Object event = selectedRaw.nextEvent();
            return event == null ? null : Core.asMap(Core.provider_normalize_stream_delta(profile, event, state, name, modelName));
          } catch (AxAIServiceError error) {
            throw error;
          } catch (Exception error) {
            throw new AxAIServiceStreamTerminatedError(error.getMessage() == null ? error.toString() : error.getMessage(), null, true);
          }
        },
        selectedRaw
      );
    }
  }

  @Override public AxChatStream openStream(Map<String, Object> request) throws Exception {
    Map<String, Object> req = Core.coerceChatRequest(request);
    Core.validate_chat_request(req);
    AxRuntimeHooks hooks = AxGlobals.effective(Map.of("stream", true), runtimeHooks);
    Map<String, Object> modelConfig = Core.asMap(Core.merge_model_config(modelConfig(), req.get("model_config"), Map.of("stream", true)));
    modelConfig.put("stream", true);
    req.put("model", req.getOrDefault("model", model));
    req.put("model_config", modelConfig);
    Map<String, Object> streamOptions = mergedOptions(Map.of("stream", true));
    Map<String, Object> payload = Core.asMap(Core.provider_build_chat_request(profile, req, streamOptions));
    Object modelName = req.getOrDefault("model", payload.getOrDefault("model", model));
    String selectedModel = String.valueOf(modelName);
    lastUsedChatModel = selectedModel;
    lastUsedModelConfig = new LinkedHashMap<>(modelConfig);
    Map<String, Object> attributes = Map.of("ax.operation", "chat", "ax.ai", name, "ax.model", selectedModel, "ax.streaming", true);
    AxSpan span = AxGlobals.startSpan(hooks, "ax_llm_chat", "client", attributes, AxGlobals.currentSpan());
    AxGlobals.recordMetric(hooks.meter(), "counter", "ax_llm_requests_total", 1, attributes);
    long started = System.nanoTime();
    Throwable failure = null;
    try {
      AxRequestExecutor next = () -> streamEventsIncremental(payload, modelName);
      Object raw = hooks.rateLimiter() == null
          ? next.execute()
          : hooks.rateLimiter().run(next, new AxRateLimitInfo("chat", name, selectedModel, true, lastModelUsage == null ? null : new LinkedHashMap<>(lastModelUsage)));
      if (!(raw instanceof AxChatStream source)) throw new AxAIServiceResponseError("rate limiter returned a non-stream response", raw);
      Iterator<Map<String, Object>> iterator = source.iterator();
      Map<String, Object>[] lastUsage = new Map[] {null};
      return new AxChatStream(
        () -> {
          if (!iterator.hasNext()) return null;
          Map<String, Object> value = iterator.next();
          if (value.get("model_usage") instanceof Map<?, ?> || value.get("modelUsage") instanceof Map<?, ?>) lastUsage[0] = value;
          return value;
        },
        source,
        (streamFailure, cancelled) -> {
          Throwable terminal = streamFailure;
          if (terminal == null && cancelled) terminal = new AxAIServiceStreamTerminatedError("stream cancelled", null, true);
          if (lastUsage[0] != null && terminal == null) AxGlobals.emitUsage("chat", lastUsage[0], streamOptions, true);
          if (terminal != null) AxGlobals.recordMetric(hooks.meter(), "counter", "ax_llm_errors_total", 1, attributes);
          AxGlobals.recordMetric(hooks.meter(), "histogram", "ax_llm_request_duration_ms", (System.nanoTime() - started) / 1_000_000.0, attributes);
          AxGlobals.finishSpan(span, terminal);
        }
      );
    } catch (Throwable error) {
      failure = error;
      if (error instanceof Exception exception) throw exception;
      if (error instanceof Error fatal) throw fatal;
      throw new RuntimeException(error);
    } finally {
      if (failure != null) {
        AxGlobals.recordMetric(hooks.meter(), "counter", "ax_llm_errors_total", 1, attributes);
        AxGlobals.recordMetric(hooks.meter(), "histogram", "ax_llm_request_duration_ms", (System.nanoTime() - started) / 1_000_000.0, attributes);
        AxGlobals.finishSpan(span, failure);
      }
    }
  }

  @Override public AxChatStream stream(Map<String, Object> request) { return AxChatStream.lazy(() -> openStream(request)); }

  public Map<String, Object> transcribe(Map<String, Object> request) throws Exception {
    Map<String, Object> payload = Core.asMap(Core.provider_build_transcribe_request(profile, request));
    Object modelName = request.getOrDefault("model", model);
    Map<String, Object> descriptor = Core.asMap(Core.provider_operation_descriptor(profile, "transcribe"));
    String bodyKey = "multipart".equals(String.valueOf(descriptor.getOrDefault("body", "json"))) ? "data" : "json";
    Object raw = requestJson(operationPath("transcribe", modelName), payload, false, bodyKey, false, operationMethod("transcribe"), "transcribe");
    return Core.asMap(Core.provider_normalize_transcribe_response(profile, raw));
  }

  public Map<String, Object> speak(Map<String, Object> request) throws Exception {
    Map<String, Object> payload = Core.asMap(Core.provider_build_speak_request(profile, request));
    Object modelName = request.getOrDefault("model", model);
    Map<String, Object> descriptor = Core.asMap(Core.provider_operation_descriptor(profile, "speak"));
    String bodyKey = "multipart".equals(String.valueOf(descriptor.getOrDefault("body", "json"))) ? "data" : "json";
    boolean binary = "binary".equals(String.valueOf(descriptor.get("response")));
    Object raw = requestJson(operationPath("speak", modelName), payload, false, bodyKey, binary, operationMethod("speak"), "speak");
    return Core.asMap(Core.provider_normalize_speak_response(profile, raw, request));
  }

  public Iterable<Map<String, Object>> realtime(Iterable<?> events) {
    List<Map<String, Object>> out = new ArrayList<>();
    Map<String, Object> state = new LinkedHashMap<>();
    for (Object event : events) out.add(Core.asMap(Core.provider_normalize_realtime_event(profile, event, state, name, model)));
    return out;
  }

  public Map<String, Object> realtimeAudioSetup(Map<String, Object> request) {
    return Core.asMap(Core.provider_build_realtime_audio_setup(profile, request, options));
  }

  public List<Object> realtimeAudioInput(Map<String, Object> request) {
    return Core.asList(Core.provider_build_realtime_audio_input(profile, request));
  }

  /** Transport seam for the realtime turn driver: a ScriptedRealtimeTransport for
   * deterministic offline turns, the JDK-WebSocket-backed transport for live ones. */
  public interface RealtimeTransport {
    void send(Map<String, Object> event);
    Map<String, Object> recv();
    void close();
  }

  public static final class ScriptedRealtimeTransport implements RealtimeTransport {
    private final java.util.Deque<Map<String, Object>> inbound = new java.util.ArrayDeque<>();
    public final List<Map<String, Object>> sent = new ArrayList<>();
    public ScriptedRealtimeTransport(List<?> inbound) {
      for (Object event : inbound) this.inbound.add(Core.asMap(event));
    }
    public void send(Map<String, Object> event) { sent.add(event); }
    public Map<String, Object> recv() { return inbound.poll(); }
    public void close() {}
  }

  // Bridges the JDK WebSocket's async, fragment-delivering listener to a blocking
  // recv(): onText reassembles fragments and enqueues whole messages; recv() polls
  // the queue. request(1) drives the one-at-a-time backpressure the JDK API needs.
  static final class WebSocketRealtimeTransport implements RealtimeTransport {
    private static final Object CLOSED = new Object();
    private final java.net.http.WebSocket ws;
    private final java.util.concurrent.BlockingQueue<Object> queue = new java.util.concurrent.LinkedBlockingQueue<>();
    private final StringBuilder buffer = new StringBuilder();

    WebSocketRealtimeTransport(String url, Map<String, String> headers) {
      java.net.http.WebSocket.Builder builder = HttpClient.newHttpClient().newWebSocketBuilder();
      for (Map.Entry<String, String> header : headers.entrySet()) builder.header(header.getKey(), header.getValue());
      this.ws = builder.buildAsync(URI.create(url), new java.net.http.WebSocket.Listener() {
        @Override public java.util.concurrent.CompletionStage<?> onText(java.net.http.WebSocket socket, CharSequence data, boolean last) {
          buffer.append(data);
          if (last) { queue.offer(buffer.toString()); buffer.setLength(0); }
          socket.request(1);
          return null;
        }
        @Override public void onError(java.net.http.WebSocket socket, Throwable error) { queue.offer(CLOSED); }
        @Override public java.util.concurrent.CompletionStage<?> onClose(java.net.http.WebSocket socket, int statusCode, String reason) { queue.offer(CLOSED); return null; }
      }).join();
      this.ws.request(1);
    }
    public void send(Map<String, Object> event) { ws.sendText(Json.stringify(event), true).join(); }
    public Map<String, Object> recv() {
      try {
        Object item = queue.poll(30, java.util.concurrent.TimeUnit.SECONDS);
        if (item == null || item == CLOSED) return null;
        return Core.asMap(Json.parse((String) item));
      } catch (InterruptedException e) { Thread.currentThread().interrupt(); return null; }
    }
    public void close() { try { ws.sendClose(java.net.http.WebSocket.NORMAL_CLOSURE, ""); } catch (Exception ignored) {} }
  }

  /** Drive a realtime audio turn over a WebSocket transport: send the Core-built
   * setup + input events, fold the inbound stream through the shared realtime
   * codec, and merge the per-delta results into one turn response (transcript
   * concatenated, audio chunks base64-joined). Pass a ScriptedRealtimeTransport
   * to exercise the loop offline without a socket. */
  public Map<String, Object> realtimeChat(Map<String, Object> request, RealtimeTransport transport) {
    Object model = request.getOrDefault("model", this.model);
    Map<String, Object> setup = realtimeAudioSetup(request);
    List<Object> inputs = realtimeAudioInput(request);
    boolean ownTransport = transport == null;
    if (ownTransport) {
      Object[] target = realtimeWsTarget(String.valueOf(model));
      @SuppressWarnings("unchecked")
      Map<String, String> wsHeaders = (Map<String, String>) target[1];
      transport = new WebSocketRealtimeTransport((String) target[0], wsHeaders);
    }
    try {
      transport.send(setup);
      boolean inputSent = false;
      List<Object> events = new ArrayList<>();
      while (true) {
        Map<String, Object> event = transport.recv();
        if (event == null) break;
        if ("error".equals(String.valueOf(event.get("type")))) {
          Map<String, Object> err = Core.asMap(event.get("error"));
          throw new AxAIServiceError(String.valueOf(err.getOrDefault("message", "realtime error")));
        }
        if (realtimeEventIsReady(event)) {
          if (!inputSent) { inputSent = true; for (Object item : inputs) transport.send(Core.asMap(item)); }
          continue;
        }
        boolean done = realtimeEventIsDone(event);
        events.add(event);
        if (done) break;
      }
      Map<String, Object> state = new LinkedHashMap<>();
      StringBuilder content = new StringBuilder();
      ByteArrayOutputStream audio = new ByteArrayOutputStream();
      boolean hasAudio = false;
      List<Object> functionCalls = new ArrayList<>();
      String responseId = "";
      String finishReason = "";
      Object modelUsage = null;
      for (Object eventObj : events) {
        Map<String, Object> out = Core.asMap(Core.provider_normalize_realtime_event(profile, eventObj, state, name, model));
        List<Object> results = Core.asList(out.get("results"));
        if (results.isEmpty()) continue;
        Map<String, Object> result = Core.asMap(results.get(0));
        Object contentObj = result.get("content");
        if (contentObj != null) content.append(contentObj);
        Object audioObj = result.get("audio");
        if (audioObj instanceof Map) {
          Object data = ((Map<?, ?>) audioObj).get("data");
          if (data != null && !String.valueOf(data).isEmpty()) { audio.writeBytes(Base64.getDecoder().decode(String.valueOf(data))); hasAudio = true; }
        }
        Object fcObj = result.get("function_calls");
        if (fcObj instanceof List) functionCalls.addAll((List<Object>) fcObj);
        Object fr = result.get("finish_reason");
        if (fr != null && !String.valueOf(fr).isEmpty()) finishReason = String.valueOf(fr);
        Object rid = out.getOrDefault("remote_id", result.get("id"));
        if (rid != null && !String.valueOf(rid).isEmpty() && !"0".equals(String.valueOf(rid))) responseId = String.valueOf(rid);
        Object usage = out.get("model_usage");
        if (usage != null) modelUsage = usage;
      }
      if (responseId.isEmpty()) responseId = "realtime";
      if (finishReason.isEmpty()) finishReason = "stop";
      Map<String, Object> result = new LinkedHashMap<>();
      result.put("index", 0);
      result.put("id", responseId);
      result.put("content", content.toString());
      result.put("function_calls", functionCalls);
      result.put("finish_reason", finishReason);
      if (hasAudio) {
        Map<String, Object> audioMap = new LinkedHashMap<>();
        audioMap.put("data", Base64.getEncoder().encodeToString(audio.toByteArray()));
        audioMap.put("format", "pcm16");
        audioMap.put("transcript", content.toString());
        result.put("audio", audioMap);
      }
      Map<String, Object> response = new LinkedHashMap<>();
      response.put("results", List.of(result));
      response.put("remote_id", responseId);
      response.put("model_usage", modelUsage);
      return response;
    } finally {
      if (ownTransport) transport.close();
    }
  }

  private static boolean realtimeEventIsReady(Map<String, Object> event) {
    String type = String.valueOf(event.get("type"));
    if (type.equals("session.created") || type.equals("session.updated") || type.equals("transcription_session.created") || type.equals("transcription_session.updated")) return true;
    return event.containsKey("setupComplete");
  }

  private static boolean realtimeEventIsDone(Map<String, Object> event) {
    String type = String.valueOf(event.get("type"));
    if (type.equals("response.done") || type.equals("response.completed")) return true;
    Object sc = event.get("serverContent");
    return sc instanceof Map && Boolean.TRUE.equals(((Map<?, ?>) sc).get("turnComplete"));
  }

  private Object[] realtimeWsTarget(String model) {
    // Grammar-specific URL + auth construction lives in Core so the client stays
    // provider-agnostic.
    String key = apiKey == null || "null".equals(apiKey) ? "" : apiKey;
    Map<String, Object> target = Core.asMap(Core.provider_realtime_ws_url(profile, model, key));
    Map<String, String> wsHeaders = new LinkedHashMap<>();
    for (Map.Entry<String, Object> header : Core.asMap(target.get("headers")).entrySet()) {
      wsHeaders.put(header.getKey(), String.valueOf(header.getValue()));
    }
    return new Object[] { String.valueOf(target.getOrDefault("url", "")), wsHeaders };
  }

  private Map<String, Object> modelConfig() {
    return new LinkedHashMap<>(this.modelConfig);
  }

  private Object requestJson(String endpoint, Map<String, Object> payload, boolean stream) throws Exception {
    return requestJson(endpoint, payload, stream, "json", false);
  }

  private Object requestJson(String endpoint, Map<String, Object> payload, boolean stream, String bodyKey) throws Exception {
    return requestJson(endpoint, payload, stream, bodyKey, false);
  }

  private Object requestJson(String endpoint, Map<String, Object> payload, boolean stream, String bodyKey, boolean binaryResponse) throws Exception {
    return requestJson(endpoint, payload, stream, bodyKey, binaryResponse, "POST");
  }

  private String operationMethod(String operation) {
    return String.valueOf(Core.asMap(Core.asMap(descriptor.get("operations")).get(operation)).getOrDefault("method", "POST")).toUpperCase(Locale.ROOT);
  }

  private Object requestJson(String endpoint, Map<String, Object> payload, boolean stream, String bodyKey, boolean binaryResponse, String method) throws Exception {
    return requestJson(endpoint, payload, stream, bodyKey, binaryResponse, method, stream ? "stream_chat" : "chat");
  }

  private Object requestJson(String endpoint, Map<String, Object> payload, boolean stream, String bodyKey, boolean binaryResponse, String method, String operation) throws Exception {
    Map<String, Object> call = new LinkedHashMap<>();
    method = method == null || method.isBlank() ? "POST" : method.toUpperCase(Locale.ROOT);
    call.put("method", method);
    String requestUrl = endpoint.startsWith("http://") || endpoint.startsWith("https://") ? endpoint : baseUrl + endpoint;
    call.put("url", requestUrl);
    Map<String, Object> resolvedHeaders = headers();
    if (credentialProvider != null) {
      Map<String, String> fresh = credentialProvider.credentials(
        new CredentialRequest(profile, operation, method, requestUrl)
      );
      if (fresh == null) throw new AxAIServiceAuthenticationError("credential_provider returned null headers", null, null, null, null);
      resolvedHeaders.putAll(fresh);
    }
    call.put("headers", resolvedHeaders);
    String resolvedBodyKey = bodyKey == null || bodyKey.isBlank() ? "json" : bodyKey;
    call.put(resolvedBodyKey, payload);
    call.put("stream", stream);
    if (transport != null) return transportResult(transport.call(call), call);
    if (apiKey == null || apiKey.isBlank() || "null".equals(apiKey)) throw new AxAIServiceAuthenticationError("OPENAI_API_KEY is required", null, null, null, call);
    HttpRequest.Builder builder = HttpRequest.newBuilder()
      .uri(URI.create(requestUrl))
      .timeout(Duration.ofMillis((long) (timeoutSeconds * 1000)));
    Map<String, Object> requestHeaders = new LinkedHashMap<>(resolvedHeaders);
    HttpRequest.BodyPublisher bodyPublisher;
    if ("data".equals(resolvedBodyKey)) {
      byte[] multipartBody = encodeMultipart(payload, MULTIPART_BOUNDARY);
      requestHeaders.put("Content-Type", "multipart/form-data; boundary=" + MULTIPART_BOUNDARY);
      bodyPublisher = HttpRequest.BodyPublishers.ofByteArray(multipartBody);
    } else {
      bodyPublisher = HttpRequest.BodyPublishers.ofString(Json.stringify(payload));
    }
    for (Map.Entry<String, Object> header : requestHeaders.entrySet()) builder.header(header.getKey(), String.valueOf(header.getValue()));
    HttpRequest req = builder.method(method, bodyPublisher).build();
    if (binaryResponse) {
      // Binary operations (e.g. OpenAI /audio/speech returns raw mp3) must not be UTF-8
      // decoded; read the response as bytes and return them as a base64 String.
      HttpResponse<byte[]> res = http.send(req, HttpResponse.BodyHandlers.ofByteArray());
      if (res.statusCode() >= 400) {
        String errorBody = new String(res.body(), StandardCharsets.UTF_8);
        Object parsed;
        try { parsed = Json.parse(errorBody); } catch (RuntimeException ex) { parsed = errorBody; }
        throw Core.asRuntime(Core.openai_normalize_error(res.statusCode(), parsed, call));
      }
      return Base64.getEncoder().encodeToString(res.body());
    }
    HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString());
    String responseBody = res.body();
    if (res.statusCode() >= 400) {
      Object parsed;
      try { parsed = Json.parse(responseBody); } catch (RuntimeException ex) { parsed = responseBody; }
      throw Core.asRuntime(Core.openai_normalize_error(res.statusCode(), parsed, call));
    }
    // Streaming responses are SSE text (text/event-stream): return the raw body
    // for iterSseJson to fold. This explicit branch matches the other ports
    // rather than relying on Json.parse throwing on the SSE body to fall back.
    if (stream) return responseBody;
    return Json.parse(responseBody);
  }

  private RawSseStream requestSse(String endpoint, Map<String, Object> payload, Object modelName) throws Exception {
    Map<String, Object> call = new LinkedHashMap<>();
    String method = operationMethod("stream_chat").toUpperCase(Locale.ROOT);
    String requestUrl = endpoint.startsWith("http://") || endpoint.startsWith("https://") ? endpoint : baseUrl + endpoint;
    Map<String, Object> resolvedHeaders = headers();
    if (credentialProvider != null) {
      Map<String, String> fresh = credentialProvider.credentials(new CredentialRequest(profile, "stream_chat", method, requestUrl));
      if (fresh == null) throw new AxAIServiceAuthenticationError("credential_provider returned null headers", null, null, null, null);
      resolvedHeaders.putAll(fresh);
    }
    call.put("method", method);
    call.put("url", requestUrl);
    call.put("headers", resolvedHeaders);
    call.put("json", payload);
    call.put("stream", true);
    if (transport != null) return RawSseStream.from(transportResult(transport.stream(call), call));
    if (apiKey == null || apiKey.isBlank() || "null".equals(apiKey)) throw new AxAIServiceAuthenticationError("OPENAI_API_KEY is required", null, null, null, call);
    HttpRequest.Builder builder = HttpRequest.newBuilder()
      .uri(URI.create(requestUrl))
      .timeout(Duration.ofMillis((long) (timeoutSeconds * 1000)));
    for (Map.Entry<String, Object> header : resolvedHeaders.entrySet()) builder.header(header.getKey(), String.valueOf(header.getValue()));
    HttpRequest req = builder.method(method, HttpRequest.BodyPublishers.ofString(Json.stringify(payload))).build();
    HttpResponse<InputStream> res = http.send(req, HttpResponse.BodyHandlers.ofInputStream());
    if (res.statusCode() >= 400) {
      try (InputStream body = res.body()) {
        String errorBody = new String(body.readAllBytes(), StandardCharsets.UTF_8);
        Object parsed;
        try { parsed = Json.parse(errorBody); } catch (RuntimeException ex) { parsed = errorBody; }
        throw Core.asRuntime(Core.openai_normalize_error(res.statusCode(), parsed, call));
      }
    }
    return RawSseStream.from(res.body());
  }

  // Encode a request payload as multipart/form-data. Multipart operations (e.g. OpenAI
  // /audio/transcriptions) carry the audio as a binary `file` part; every other field is a
  // plain form field. The `file` value is a base64 String (optionally a data: URL) or a
  // Map {data, mimeType?, filename?}. The body is binary: text parts are UTF-8 bytes and the
  // file part is the raw decoded bytes.
  private static byte[] encodeMultipart(Map<String, Object> payload, String boundary) throws IOException {
    byte[] crlf = "\r\n".getBytes(StandardCharsets.UTF_8);
    byte[] dashes = ("--" + boundary).getBytes(StandardCharsets.UTF_8);
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    for (Map.Entry<String, Object> entry : payload.entrySet()) {
      String key = entry.getKey();
      Object value = entry.getValue();
      if (value == null) continue;
      if ("file".equals(key)) {
        String data;
        String filename;
        String contentType;
        if (value instanceof Map<?, ?> map) {
          Map<String, Object> fileMap = Core.asMap(map);
          data = String.valueOf(fileMap.getOrDefault("data", ""));
          Object rawFilename = fileMap.get("filename");
          filename = rawFilename == null || String.valueOf(rawFilename).isBlank() ? "audio.wav" : String.valueOf(rawFilename);
          Object rawMime = fileMap.get("mimeType");
          if (rawMime == null) rawMime = fileMap.get("mime_type");
          contentType = rawMime == null || String.valueOf(rawMime).isBlank() ? "audio/wav" : String.valueOf(rawMime);
        } else {
          data = String.valueOf(value);
          filename = "audio.wav";
          contentType = "audio/wav";
        }
        if (data.startsWith("data:") && data.contains(",")) {
          data = data.substring(data.indexOf(',') + 1);
        }
        byte[] fileBytes;
        try {
          fileBytes = Base64.getDecoder().decode(data);
        } catch (IllegalArgumentException ex) {
          fileBytes = data.getBytes(StandardCharsets.UTF_8);
        }
        out.write(dashes);
        out.write(crlf);
        out.write(("Content-Disposition: form-data; name=\"file\"; filename=\"" + filename + "\"").getBytes(StandardCharsets.UTF_8));
        out.write(crlf);
        out.write(("Content-Type: " + contentType).getBytes(StandardCharsets.UTF_8));
        out.write(crlf);
        out.write(crlf);
        out.write(fileBytes);
        out.write(crlf);
      } else {
        out.write(dashes);
        out.write(crlf);
        out.write(("Content-Disposition: form-data; name=\"" + key + "\"").getBytes(StandardCharsets.UTF_8));
        out.write(crlf);
        out.write(crlf);
        out.write(String.valueOf(value).getBytes(StandardCharsets.UTF_8));
        out.write(crlf);
      }
    }
    out.write(dashes);
    out.write("--".getBytes(StandardCharsets.UTF_8));
    out.write(crlf);
    return out.toByteArray();
  }

  private String operationPath(String operation) {
    return operationPath(operation, null);
  }

  private String operationPath(String operation, Object modelName) {
    Map<String, Object> desc = Core.asMap(Core.asMap(descriptor.get("operations")).get(operation));
    String path = String.valueOf(desc.getOrDefault("path", "/" + operation));
    if (modelName != null) {
      path = path.replace("{model}", URLEncoder.encode(String.valueOf(modelName), StandardCharsets.UTF_8));
    }
    if ("api_key_query".equals(String.valueOf(descriptor.get("auth")))) {
      String keyName = String.valueOf(descriptor.getOrDefault("apiKeyQuery", "key"));
      path += (path.contains("?") ? "&" : "?") + URLEncoder.encode(keyName, StandardCharsets.UTF_8) + "=" + URLEncoder.encode(apiKey == null || "null".equals(apiKey) ? "" : apiKey, StandardCharsets.UTF_8);
    }
    if (apiVersion != null && !apiVersion.isBlank() && !"null".equals(apiVersion)) {
      path += (path.contains("?") ? "&" : "?") + "api-version=" + URLEncoder.encode(apiVersion, StandardCharsets.UTF_8);
    }
    return path;
  }

  private Map<String, Object> headers() {
    Map<String, Object> headers = new LinkedHashMap<>();
    headers.put("Content-Type", "application/json");
    if ("bearer".equals(String.valueOf(descriptor.get("auth")))) {
      headers.put("Authorization", "Bearer " + (apiKey == null ? "" : apiKey));
    }
    if (java.util.Set.of("anthropic_key", "x-api-key").contains(String.valueOf(descriptor.get("auth")))) {
      headers.put("x-api-key", apiKey == null ? "" : apiKey);
    }
    if ("api_key_header".equals(String.valueOf(descriptor.get("auth")))) {
      headers.put(String.valueOf(descriptor.getOrDefault("apiKeyHeader", "api-key")), apiKey == null ? "" : apiKey);
    }
    Object extraHeaders = descriptor.get("headers");
    if (extraHeaders instanceof Map<?, ?> rawHeaders) {
      for (Map.Entry<?, ?> entry : rawHeaders.entrySet()) headers.put(String.valueOf(entry.getKey()), String.valueOf(entry.getValue()));
    }
    return headers;
  }

  private Object transportResult(Object result, Map<String, Object> request) {
    if (result instanceof Map<?, ?> raw) {
      Map<String, Object> map = Core.asMap(raw);
      if (map.containsKey("status")) {
        int status = Core.asInt(map.getOrDefault("status", 200));
        Object body = map.containsKey("json") ? map.get("json") : map.containsKey("body") ? map.get("body") : map.get("data");
        if (status >= 400) throw Core.asRuntime(Core.openai_normalize_error(status, body, request));
        return body;
      }
    }
    return result;
  }

  private Iterable<Object> iterSseJson(Object raw) {
    if (raw instanceof Iterable<?> items) {
      List<Object> out = new ArrayList<>();
      for (Object item : items) if (!"[DONE]".equals(item)) out.add(item);
      return out;
    }
    // Mirror src/ax/util/sse.ts: normalize CRLF/CR, then fold the data: lines of
    // each event (events are blank-line separated) into a single payload before
    // parsing. A spec-legal SSE event may split one JSON value across several
    // data: lines, joined with "\n"; parsing each line on its own would choke.
    String text = String.valueOf(raw).replace("\r\n", "\n").replace("\r", "\n");
    List<Object> out = new ArrayList<>();
    StringBuilder buffer = new StringBuilder();
    for (String line : text.split("\n", -1)) {
      if (line.isEmpty()) {
        flushSseEvent(buffer, out);
        continue;
      }
      if (line.startsWith(":")) continue; // comment line
      String value;
      int colon = line.indexOf(':');
      if (colon >= 0) {
        if (!"data".equals(line.substring(0, colon).trim())) continue; // not a data: line
        value = line.substring(colon + 1).trim();
      } else {
        value = line.trim();
      }
      if (buffer.length() > 0 && buffer.charAt(buffer.length() - 1) != '\n') buffer.append('\n');
      buffer.append(value);
    }
    flushSseEvent(buffer, out);
    return out;
  }

  private static void flushSseEvent(StringBuilder buffer, List<Object> out) {
    String payload = buffer.toString().trim();
    buffer.setLength(0);
    if (payload.isEmpty() || "[DONE]".equals(payload)) return;
    out.add(Json.parse(payload));
  }
}
