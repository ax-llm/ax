package dev.axllm.ax;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;

public final class AxMCPStreamableHTTPTransport implements AxMCPTransport {
  private final String endpoint;
  private final Map<String, Object> options;
  private final HttpClient client = HttpClient.newHttpClient();
  private String sessionId;
  private String protocolVersion;
  private java.util.function.Consumer<Map<String, Object>> handler;
  private Consumer<String> lifecycleHandler;
  private final Map<String, String> headers = new LinkedHashMap<>();
  private Map<String, String> lastHeaders = new LinkedHashMap<>();
  private final AtomicBoolean listenStop = new AtomicBoolean(true);
  private volatile Thread listenThread;
  private volatile InputStream listenBody;
  private volatile String lastEventId;

  public AxMCPStreamableHTTPTransport(String endpoint) {
    this(endpoint, Map.of());
  }

  public AxMCPStreamableHTTPTransport(String endpoint, Map<String, Object> options) {
    this.options = options == null ? Map.of() : new LinkedHashMap<>(options);
    this.endpoint = AxMCPClient.validateEndpoint(endpoint, Core.asMap(this.options.get("ssrfProtection")));
    for (Map.Entry<String, Object> entry : Core.asMap(this.options.get("headers")).entrySet()) headers.put(entry.getKey(), String.valueOf(entry.getValue()));
    if (this.options.get("authorization") != null) headers.put("Authorization", String.valueOf(this.options.get("authorization")));
  }

  public Map<String, Object> send(Map<String, Object> message) {
    try {
      HttpRequest.Builder builder = HttpRequest.newBuilder(URI.create(endpoint)).POST(HttpRequest.BodyPublishers.ofString(Json.stringify(message)));
      for (Map.Entry<String, String> entry : buildHeaders(Map.of("Content-Type", "application/json", "Accept", "application/json, text/event-stream"), !"initialize".equals(message.get("method"))).entrySet()) builder.header(entry.getKey(), entry.getValue());
      HttpResponse<String> response = client.send(builder.build(), HttpResponse.BodyHandlers.ofString());
      response.headers().firstValue("MCP-Session-Id").ifPresent(value -> sessionId = value);
      if (response.statusCode() == 401 && applyOAuth()) return send(message);
      if (response.statusCode() < 200 || response.statusCode() >= 300) throw new AxMCPError("HTTP error " + response.statusCode());
      String bodyText = response.body();
      Object requestId = message.get("id");
      if (bodyText == null || bodyText.isBlank()) return jsonRpcResult(requestId);
      // A spec-compliant MCP server may answer a JSON-RPC POST with an SSE stream
      // (Content-Type: text/event-stream) carrying the response — and any
      // interleaved notifications/keepalives — in `data:` frames; parse those
      // rather than JSON-decoding the raw stream. Otherwise keep the JSON path.
      String contentType = response.headers().firstValue("Content-Type").orElse("").toLowerCase();
      if (contentType.contains("text/event-stream")) return selectSseResponse(parseSse(bodyText), requestId);
      return Core.asMap(Json.parse(bodyText));
    } catch (AxMCPError error) {
      throw error;
    } catch (Exception error) {
      throw new AxMCPError(error.getMessage());
    }
  }

  private static Map<String, Object> jsonRpcResult(Object requestId) {
    Map<String, Object> envelope = new LinkedHashMap<>();
    envelope.put("jsonrpc", "2.0");
    envelope.put("id", requestId);
    envelope.put("result", new LinkedHashMap<>());
    return envelope;
  }

  // Extract JSON-RPC messages from the `data:` frames of an SSE body.
  private static List<Map<String, Object>> parseSse(String body) {
    List<Map<String, Object>> messages = new ArrayList<>();
    for (String raw : body.split("\n")) {
      String line = raw.trim();
      if (!line.startsWith("data:")) continue;
      String data = line.substring(5).trim();
      if (data.isEmpty() || data.equals("[DONE]")) continue;
      messages.add(Core.asMap(Json.parse(data)));
    }
    return messages;
  }

  // Return the JSON-RPC response whose id matches the request, routing any
  // interleaved server notifications/requests to the inbound handler (mirroring
  // the stdio transport).
  private Map<String, Object> selectSseResponse(List<Map<String, Object>> messages, Object requestId) {
    Map<String, Object> response = null;
    for (Map<String, Object> msg : messages) {
      if (response == null && msg.containsKey("id") && Objects.equals(msg.get("id"), requestId)) {
        response = msg;
        continue;
      }
      if (handler != null) handler.accept(msg);
    }
    if (response != null) return response;
    if (!messages.isEmpty()) return messages.get(messages.size() - 1);
    return jsonRpcResult(requestId);
  }

  public void sendNotification(Map<String, Object> message) {
    send(message);
  }

  public void setMessageHandler(java.util.function.Consumer<Map<String, Object>> handler) { this.handler = handler; }
  public void setLifecycleHandler(Consumer<String> handler) { this.lifecycleHandler = handler; }
  public void setProtocolVersion(String protocolVersion) { this.protocolVersion = protocolVersion; }
  public void setSessionId(String sessionId) { this.sessionId = sessionId; }
  public Map<String, String> headers() { return headers; }
  public Map<String, String> lastHeaders() { return lastHeaders; }

  public synchronized void startListening() {
    if (listenThread != null && listenThread.isAlive()) return;
    listenStop.set(false);
    listenThread = new Thread(this::listenLoop, "ax-mcp-sse");
    listenThread.setDaemon(true);
    listenThread.start();
  }

  private void listenLoop() {
    boolean connectedOnce = false;
    long reconnectDelay = ((Number) options.getOrDefault("reconnectDelayMs", 100)).longValue();
    while (!listenStop.get()) {
      try {
        HttpRequest.Builder builder = HttpRequest.newBuilder(URI.create(endpoint)).GET();
        Map<String, String> requestHeaders = buildHeaders(Map.of("Accept", "text/event-stream"), true);
        if (lastEventId != null && !lastEventId.isBlank()) requestHeaders.put("Last-Event-ID", lastEventId);
        for (Map.Entry<String, String> entry : requestHeaders.entrySet()) builder.header(entry.getKey(), entry.getValue());
        HttpResponse<InputStream> response = client.send(builder.build(), HttpResponse.BodyHandlers.ofInputStream());
        if (response.statusCode() < 200 || response.statusCode() >= 300) {
          response.body().close();
          throw new AxMCPError("HTTP listen error " + response.statusCode());
        }
        response.headers().firstValue("MCP-Session-Id").ifPresent(value -> sessionId = value);
        listenBody = response.body();
        if (connectedOnce && lifecycleHandler != null) lifecycleHandler.accept("reconnected");
        connectedOnce = true;
        consumeSse(listenBody);
        listenBody.close();
        listenBody = null;
        if (!listenStop.get() && lifecycleHandler != null) lifecycleHandler.accept("disconnected");
      } catch (Exception error) {
        listenBody = null;
        if (!listenStop.get() && connectedOnce && lifecycleHandler != null) lifecycleHandler.accept("disconnected");
      }
      if (!listenStop.get()) {
        try { Thread.sleep(reconnectDelay); } catch (InterruptedException ignored) { Thread.currentThread().interrupt(); }
      }
    }
  }

  private void consumeSse(InputStream body) throws Exception {
    BufferedReader reader = new BufferedReader(new InputStreamReader(body, java.nio.charset.StandardCharsets.UTF_8));
    List<String> data = new ArrayList<>();
    String eventId = null;
    String line;
    while (!listenStop.get() && (line = reader.readLine()) != null) {
      if (line.isEmpty()) {
        if (eventId != null) lastEventId = eventId;
        if (!data.isEmpty() && handler != null) handler.accept(Core.asMap(Json.parse(String.join("\n", data))));
        data.clear(); eventId = null;
      } else if (line.startsWith("id:")) eventId = line.substring(3).trim();
      else if (line.startsWith("data:")) data.add(line.substring(5).stripLeading());
    }
  }

  public synchronized void close() {
    listenStop.set(true);
    InputStream body = listenBody;
    if (body != null) try { body.close(); } catch (Exception ignored) {}
    Thread thread = listenThread;
    if (thread != null) {
      thread.interrupt();
      try { thread.join(2000); } catch (InterruptedException ignored) { Thread.currentThread().interrupt(); }
    }
    listenThread = null; listenBody = null;
  }

  public Map<String, String> buildHeaders(Map<String, String> base, boolean includeProtocolVersion) {
    Map<String, String> out = new LinkedHashMap<>(headers);
    out.putAll(base == null ? Map.of() : base);
    if (sessionId != null) out.put("MCP-Session-Id", sessionId);
    if (includeProtocolVersion && protocolVersion != null) out.put("MCP-Protocol-Version", protocolVersion);
    lastHeaders = new LinkedHashMap<>(out);
    return out;
  }

  boolean applyOAuth() {
    Object raw = options.get("oauth");
    if (raw == null) return false;
    AxMCPOAuthOptions oauth = raw instanceof AxMCPOAuthOptions typed ? typed : null;
    if (oauth == null) return false;
    AxMCPTokenSet token = oauth.tokenStore == null ? null : oauth.tokenStore.getToken(endpoint);
    if (token != null && token.accessToken != null) {
      headers.put("Authorization", "Bearer " + token.accessToken);
      return true;
    }
    if (oauth.onAuthCode == null) return false;
    String verifier = AxMCPClient.pkceVerifier();
    String challenge = AxMCPClient.pkceChallenge(verifier);
    Map<String, String> auth = oauth.onAuthCode.apply(endpoint + "?response_type=code&code_challenge=" + challenge + "&code_challenge_method=S256");
    if (auth == null || auth.get("code") == null) return false;
    AxMCPTokenSet next = new AxMCPTokenSet("mcp-auth-code-" + auth.get("code"), null, null, endpoint);
    if (oauth.tokenStore != null) oauth.tokenStore.setToken(endpoint, next);
    headers.put("Authorization", "Bearer " + next.accessToken);
    return true;
  }
}
