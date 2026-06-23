package dev.axllm.ax;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public class OpenAICompatibleClient extends AxBaseAI {
  public interface Transport {
    Object call(Map<String, Object> request) throws Exception;
  }

  private static final String MULTIPART_BOUNDARY = "----axllmFormBoundary" + UUID.randomUUID().toString().replace("-", "");

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
    boolean binary = "binary".equals(String.valueOf(descriptor.get("response")));
    Object raw = requestJson(operationPath("speak", modelName), payload, false, bodyKey, binary);
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
    Map<String, Object> call = new LinkedHashMap<>();
    call.put("method", "POST");
    call.put("url", baseUrl + endpoint);
    call.put("headers", headers());
    String resolvedBodyKey = bodyKey == null || bodyKey.isBlank() ? "json" : bodyKey;
    call.put(resolvedBodyKey, payload);
    call.put("stream", stream);
    if (transport != null) return transportResult(transport.call(call), call);
    if (apiKey == null || apiKey.isBlank() || "null".equals(apiKey)) throw new AxAIServiceAuthenticationError("OPENAI_API_KEY is required", null, null, null, call);
    HttpRequest.Builder builder = HttpRequest.newBuilder()
      .uri(URI.create(baseUrl + endpoint))
      .timeout(Duration.ofMillis((long) (timeoutSeconds * 1000)));
    Map<String, Object> requestHeaders = headers();
    HttpRequest.BodyPublisher bodyPublisher;
    if ("data".equals(resolvedBodyKey)) {
      byte[] multipartBody = encodeMultipart(payload, MULTIPART_BOUNDARY);
      requestHeaders.put("Content-Type", "multipart/form-data; boundary=" + MULTIPART_BOUNDARY);
      bodyPublisher = HttpRequest.BodyPublishers.ofByteArray(multipartBody);
    } else {
      bodyPublisher = HttpRequest.BodyPublishers.ofString(Json.stringify(payload));
    }
    for (Map.Entry<String, Object> header : requestHeaders.entrySet()) builder.header(header.getKey(), String.valueOf(header.getValue()));
    HttpRequest req = builder.POST(bodyPublisher).build();
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
    Object body;
    try { body = Json.parse(res.body()); } catch (RuntimeException ex) { body = res.body(); }
    if (res.statusCode() >= 400) throw Core.asRuntime(Core.openai_normalize_error(res.statusCode(), body, call));
    return body;
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
