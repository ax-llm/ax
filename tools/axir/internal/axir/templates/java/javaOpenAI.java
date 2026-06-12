package dev.axllm.ax;

import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public class OpenAICompatibleClient extends AxBaseAI {
  public interface Transport {
    Object call(Map<String, Object> request) throws Exception;
  }

  protected final String profile;
  private final Map<String, Object> descriptor;
  private final String baseUrl;
  private final String apiKey;
  private final String apiVersion;
  private final double timeoutSeconds;
  private final Transport transport;
  private final HttpClient http = HttpClient.newHttpClient();

  public OpenAICompatibleClient(String model) {
    this(Map.of("model", model));
  }

  public OpenAICompatibleClient(Map<String, Object> options) {
    this("openai-compatible", "openai", options == null ? Map.of() : options, "gpt-4.1-mini", "text-embedding-3-small");
  }

  protected OpenAICompatibleClient(String profile, String name, Map<String, Object> options, String defaultModel, String defaultEmbedModel) {
    super(
      name,
      String.valueOf(options.getOrDefault("model", defaultModel)),
      String.valueOf(options.getOrDefault("embed_model", options.getOrDefault("embedModel", defaultEmbedModel))),
      Core.asMap(options.get("model_config")),
      Core.asMap(options.get("options"))
    );
    this.profile = profile == null || profile.isBlank() ? "openai-compatible" : profile;
    this.descriptor = Core.asMap(Core.provider_descriptor(this.profile));
    String descriptorBaseUrl = String.valueOf(this.descriptor.getOrDefault("baseUrl", "https://api.openai.com/v1"));
    this.baseUrl = String.valueOf(options.getOrDefault("base_url", options.getOrDefault("baseUrl", System.getenv().getOrDefault("OPENAI_BASE_URL", descriptorBaseUrl)))).replaceAll("/+$", "");
    this.apiKey = String.valueOf(options.getOrDefault("api_key", options.getOrDefault("apiKey", System.getenv("OPENAI_API_KEY"))));
    this.apiVersion = String.valueOf(options.getOrDefault("api_version", options.getOrDefault("apiVersion", this.descriptor.getOrDefault("apiVersion", ""))));
    Object timeout = options.getOrDefault("timeout", 60.0);
    this.timeoutSeconds = timeout instanceof Number n ? n.doubleValue() : 60.0;
    this.transport = options.get("transport") instanceof Transport t ? t : null;
  }

  protected Map<String, Object> doChat(Map<String, Object> request, Map<String, Object> options) throws Exception {
    Map<String, Object> payload = Core.asMap(Core.provider_build_chat_request(profile, request));
    Object stream = payload.get("stream");
    if (Boolean.TRUE.equals(stream)) {
      List<Map<String, Object>> out = new ArrayList<>();
      Map<String, Object> state = new LinkedHashMap<>();
      Object modelName = request.getOrDefault("model", payload.getOrDefault("model", model));
      for (Object event : iterSseJson(requestJson(operationPath("stream_chat", modelName), payload, true))) {
        out.add(Core.asMap(Core.provider_normalize_stream_delta(profile, event, state, name, modelName)));
      }
      return Map.of("results", out);
    }
    Object modelName = request.getOrDefault("model", payload.getOrDefault("model", model));
    Object raw = requestJson(operationPath("chat", modelName), payload, false);
    return Core.asMap(Core.provider_normalize_chat_response(profile, raw, name, modelName));
  }

  protected Map<String, Object> doEmbed(Map<String, Object> request, Map<String, Object> options) throws Exception {
    Map<String, Object> payload = Core.asMap(Core.provider_build_embed_request(profile, request));
    Object modelName = request.getOrDefault("embed_model", request.getOrDefault("embedModel", payload.getOrDefault("model", embedModel)));
    Object raw = requestJson(operationPath("embed", modelName), payload, false);
    return Core.asMap(Core.provider_normalize_embed_response(profile, raw, name, modelName));
  }

  public Iterable<Map<String, Object>> stream(Map<String, Object> request) throws Exception {
    Map<String, Object> req = Core.coerceChatRequest(request);
    Core.validate_chat_request(req);
    Map<String, Object> modelConfig = Core.asMap(Core.merge_model_config(modelConfig(), req.get("model_config"), Map.of("stream", true)));
    modelConfig.put("stream", true);
    req.put("model", req.getOrDefault("model", model));
    req.put("model_config", modelConfig);
    Map<String, Object> payload = Core.asMap(Core.provider_build_chat_request(profile, req));
    Object modelName = req.getOrDefault("model", payload.getOrDefault("model", model));
    Object raw = requestJson(operationPath("stream_chat", modelName), payload, true);
    Map<String, Object> state = new LinkedHashMap<>();
    List<Map<String, Object>> out = new ArrayList<>();
    for (Object event : iterSseJson(raw)) out.add(Core.asMap(Core.provider_normalize_stream_delta(profile, event, state, name, modelName)));
    return out;
  }

  public Map<String, Object> transcribe(Map<String, Object> request) throws Exception {
    Map<String, Object> payload = Core.asMap(Core.provider_build_transcribe_request(profile, request));
    Object modelName = request.getOrDefault("model", model);
    Map<String, Object> descriptor = Core.asMap(Core.provider_operation_descriptor(profile, "transcribe"));
    String bodyKey = "multipart".equals(String.valueOf(descriptor.getOrDefault("body", "json"))) ? "data" : "json";
    Object raw = requestJson(operationPath("transcribe", modelName), payload, false, bodyKey);
    return Core.asMap(Core.provider_normalize_transcribe_response(profile, raw));
  }

  public Map<String, Object> speak(Map<String, Object> request) throws Exception {
    Map<String, Object> payload = Core.asMap(Core.provider_build_speak_request(profile, request));
    Object modelName = request.getOrDefault("model", model);
    Map<String, Object> descriptor = Core.asMap(Core.provider_operation_descriptor(profile, "speak"));
    String bodyKey = "multipart".equals(String.valueOf(descriptor.getOrDefault("body", "json"))) ? "data" : "json";
    Object raw = requestJson(operationPath("speak", modelName), payload, false, bodyKey);
    return Core.asMap(Core.provider_normalize_speak_response(profile, raw, request));
  }

  public Iterable<Map<String, Object>> realtime(Iterable<?> events) {
    List<Map<String, Object>> out = new ArrayList<>();
    Map<String, Object> state = new LinkedHashMap<>();
    for (Object event : events) out.add(Core.asMap(Core.provider_normalize_realtime_event(profile, event, state, name, model)));
    return out;
  }

  public Map<String, Object> realtimeAudioSetup(Map<String, Object> request) {
    return Core.asMap(Core.provider_build_realtime_audio_setup(profile, request));
  }

  public List<Object> realtimeAudioInput(Map<String, Object> request) {
    return Core.asList(Core.provider_build_realtime_audio_input(profile, request));
  }

  private Map<String, Object> modelConfig() {
    return new LinkedHashMap<>(this.modelConfig);
  }

  private Object requestJson(String endpoint, Map<String, Object> payload, boolean stream) throws Exception {
    return requestJson(endpoint, payload, stream, "json");
  }

  private Object requestJson(String endpoint, Map<String, Object> payload, boolean stream, String bodyKey) throws Exception {
    Map<String, Object> call = new LinkedHashMap<>();
    call.put("method", "POST");
    call.put("url", baseUrl + endpoint);
    call.put("headers", headers());
    call.put(bodyKey == null || bodyKey.isBlank() ? "json" : bodyKey, payload);
    call.put("stream", stream);
    if (transport != null) return transportResult(transport.call(call), call);
    if (apiKey == null || apiKey.isBlank() || "null".equals(apiKey)) throw new AxAIServiceAuthenticationError("OPENAI_API_KEY is required", null, null, null, call);
    HttpRequest.Builder builder = HttpRequest.newBuilder()
      .uri(URI.create(baseUrl + endpoint))
      .timeout(Duration.ofMillis((long) (timeoutSeconds * 1000)));
    for (Map.Entry<String, Object> header : headers().entrySet()) builder.header(header.getKey(), String.valueOf(header.getValue()));
    HttpRequest req = builder.POST(HttpRequest.BodyPublishers.ofString(Json.stringify(payload))).build();
    HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString());
    Object body;
    try { body = Json.parse(res.body()); } catch (RuntimeException ex) { body = res.body(); }
    if (res.statusCode() >= 400) throw Core.asRuntime(Core.openai_normalize_error(res.statusCode(), body, call));
    return body;
  }

  private String operationPath(String operation) {
    return operationPath(operation, null);
  }

  private String operationPath(String operation, Object modelName) {
    Map<String, Object> desc = Core.asMap(Core.provider_operation_descriptor(profile, operation));
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
    if ("anthropic_key".equals(String.valueOf(descriptor.get("auth")))) {
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
    List<Object> out = new ArrayList<>();
    for (String line : String.valueOf(raw).split("\\R")) {
      line = line.trim();
      if (!line.startsWith("data:")) continue;
      String data = line.substring(5).trim();
      if (data.isBlank() || "[DONE]".equals(data)) continue;
      out.add(Json.parse(data));
    }
    return out;
  }
}
