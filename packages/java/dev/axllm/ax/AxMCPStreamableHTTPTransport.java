package dev.axllm.ax;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.LinkedHashMap;
import java.util.Map;

public final class AxMCPStreamableHTTPTransport implements AxMCPTransport {
  private final String endpoint;
  private final Map<String, Object> options;
  private final HttpClient client = HttpClient.newHttpClient();
  private String sessionId;
  private String protocolVersion;
  private java.util.function.Consumer<Map<String, Object>> handler;
  private final Map<String, String> headers = new LinkedHashMap<>();
  private Map<String, String> lastHeaders = new LinkedHashMap<>();

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
      return Core.asMap(Json.parse(response.body().isBlank() ? "{}" : response.body()));
    } catch (AxMCPError error) {
      throw error;
    } catch (Exception error) {
      throw new AxMCPError(error.getMessage());
    }
  }

  public void sendNotification(Map<String, Object> message) {
    Map<String, Object> withId = new LinkedHashMap<>(message);
    withId.put("id", "__notification__");
    send(withId);
  }

  public void setMessageHandler(java.util.function.Consumer<Map<String, Object>> handler) { this.handler = handler; }
  public void setProtocolVersion(String protocolVersion) { this.protocolVersion = protocolVersion; }
  public void setSessionId(String sessionId) { this.sessionId = sessionId; }
  public Map<String, String> headers() { return headers; }
  public Map<String, String> lastHeaders() { return lastHeaders; }

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
