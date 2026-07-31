package dev.axllm.ax;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.URI;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.ArrayList;
import java.util.Base64;
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
  private String era;
  private final String eraCacheKey;
  private java.util.function.Consumer<Map<String, Object>> handler;
  private Consumer<String> lifecycleHandler;
  private final Map<String, String> headers = new LinkedHashMap<>();
  private Map<String, String> lastHeaders = new LinkedHashMap<>();
  private final AtomicBoolean listenStop = new AtomicBoolean(true);
  private volatile Thread listenThread;
  private volatile InputStream listenBody;
  private volatile AtomicBoolean requestStreamStop;
  private volatile Thread requestStreamThread;
  private volatile InputStream requestStreamBody;
  private volatile HttpURLConnection requestStreamConnection;
  private volatile String lastEventId;

  public AxMCPStreamableHTTPTransport(String endpoint) {
    this(endpoint, Map.of());
  }

  public AxMCPStreamableHTTPTransport(String endpoint, Map<String, Object> options) {
    this.options = options == null ? Map.of() : new LinkedHashMap<>(options);
    this.endpoint = AxMCPClient.validateEndpoint(endpoint, Core.asMap(this.options.get("ssrfProtection")));
    URI parsedEndpoint = URI.create(this.endpoint);
    this.eraCacheKey = parsedEndpoint.getScheme() + "://" + parsedEndpoint.getAuthority();
    for (Map.Entry<String, Object> entry : Core.asMap(this.options.get("headers")).entrySet()) headers.put(entry.getKey(), String.valueOf(entry.getValue()));
    if (this.options.get("authorization") != null) headers.put("Authorization", String.valueOf(this.options.get("authorization")));
  }

  public Map<String, Object> send(Map<String, Object> message) {
    return sendWithHeaders(message, Map.of());
  }

  public Map<String, Object> sendWithHeaders(Map<String, Object> message, Map<String, String> extraHeaders) {
    try {
      HttpRequest.Builder builder = HttpRequest.newBuilder(URI.create(endpoint)).POST(HttpRequest.BodyPublishers.ofString(Json.stringify(message)));
      String method = String.valueOf(message.getOrDefault("method", ""));
      for (Map.Entry<String, String> entry : buildHeaders(Map.of("Content-Type", "application/json", "Accept", "application/json, text/event-stream"), !"initialize".equals(method), method, Core.asMap(message.get("params")), extraHeaders).entrySet()) builder.header(entry.getKey(), entry.getValue());
      HttpResponse<String> response = client.send(builder.build(), HttpResponse.BodyHandlers.ofString());
      if (!"modern".equals(era)) response.headers().firstValue("MCP-Session-Id").ifPresent(value -> sessionId = value);
      if (response.statusCode() == 401 && applyOAuth(response.headers().firstValue("WWW-Authenticate").orElse(""))) return sendWithHeaders(message, extraHeaders);
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
  public void setEra(String era) { this.era = era; if ("modern".equals(era)) { sessionId = null; protocolVersion = "2026-07-28"; } else if ("2026-07-28".equals(protocolVersion)) protocolVersion = null; }
  public String eraCacheKey() { return eraCacheKey; }
  public void setSessionId(String sessionId) { this.sessionId = sessionId; }
  public Map<String, String> headers() { return headers; }
  public Map<String, String> lastHeaders() { return lastHeaders; }

  public synchronized void startListening() {
    if ("modern".equals(era)) throw new AxMCPError("Modern MCP uses subscriptions/listen via openRequestStream, not HTTP GET");
    if (listenThread != null && listenThread.isAlive()) return;
    listenStop.set(false);
    listenThread = new Thread(this::listenLoop, "ax-mcp-sse");
    listenThread.setDaemon(true);
    listenThread.start();
  }

  public synchronized void openRequestStream(Map<String,Object> message){
    if(!"modern".equals(era))throw new AxMCPError("Request streams are only available for modern MCP");
    closeRequestStream();Map<String,Object> request=new LinkedHashMap<>(message);AtomicBoolean stop=new AtomicBoolean(false);requestStreamStop=stop;
    Thread thread=new Thread(()->requestStreamOnce(request,stop),"ax-mcp-request-stream");requestStreamThread=thread;thread.setDaemon(true);thread.start();
  }

  private void requestStreamOnce(Map<String,Object> message,AtomicBoolean stop){
    HttpURLConnection connection=null;
    try{
      connection=(HttpURLConnection)new URL(endpoint).openConnection();synchronized(this){if(stop.get()||requestStreamStop!=stop)return;requestStreamConnection=connection;}connection.setRequestMethod("POST");connection.setDoOutput(true);
      String method=String.valueOf(message.getOrDefault("method",""));for(Map.Entry<String,String> entry:buildHeaders(Map.of("Content-Type","application/json","Accept","text/event-stream"),true,method,Core.asMap(message.get("params")),Map.of()).entrySet())connection.setRequestProperty(entry.getKey(),entry.getValue());
      byte[] body=Json.stringify(message).getBytes(java.nio.charset.StandardCharsets.UTF_8);connection.setFixedLengthStreamingMode(body.length);connection.connect();try(java.io.OutputStream output=connection.getOutputStream()){output.write(body);}
      if(connection.getResponseCode()<200||connection.getResponseCode()>=300)throw new AxMCPError("HTTP listen error "+connection.getResponseCode());InputStream streamBody=connection.getInputStream();synchronized(this){if(requestStreamStop==stop)requestStreamBody=streamBody;}consumeRequestSse(streamBody,stop);streamBody.close();connection.disconnect();
    }catch(Exception ignored){}finally{if(connection!=null)connection.disconnect();if(requestStreamStop==stop){requestStreamBody=null;requestStreamConnection=null;requestStreamThread=null;}if(!stop.get()&&lifecycleHandler!=null)new Thread(()->lifecycleHandler.accept("disconnected"),"ax-mcp-listen-lifecycle").start();}
  }

  private void consumeRequestSse(InputStream body,AtomicBoolean stop)throws Exception{BufferedReader reader=new BufferedReader(new InputStreamReader(body,java.nio.charset.StandardCharsets.UTF_8));List<String> data=new ArrayList<>();String line;while(!stop.get()&&(line=reader.readLine())!=null){if(line.isEmpty()){if(!data.isEmpty()&&handler!=null)handler.accept(Core.asMap(Json.parse(String.join("\n",data))));data.clear();}else if(line.startsWith("data:"))data.add(line.substring(5).stripLeading());}}

  public synchronized void closeRequestStream(){AtomicBoolean stop=requestStreamStop;Thread thread=requestStreamThread;InputStream body=requestStreamBody;HttpURLConnection connection=requestStreamConnection;requestStreamStop=null;requestStreamThread=null;requestStreamBody=null;requestStreamConnection=null;if(stop!=null)stop.set(true);if(thread!=null)thread.interrupt();if(connection!=null||body!=null){Thread cleanup=new Thread(()->{if(connection!=null)connection.disconnect();if(body!=null)try{body.close();}catch(Exception ignored){}},"ax-mcp-request-stream-close");cleanup.setDaemon(true);cleanup.start();}}

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
        if (!"modern".equals(era)) response.headers().firstValue("MCP-Session-Id").ifPresent(value -> sessionId = value);
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
    return buildHeaders(base, includeProtocolVersion, null, Map.of(), Map.of());
  }

  public Map<String, String> buildHeaders(Map<String, String> base, boolean includeProtocolVersion, String method, Map<String, Object> params, Map<String, String> extraHeaders) {
    Map<String, String> out = new LinkedHashMap<>(headers);
    out.putAll(base == null ? Map.of() : base);
    for (Map.Entry<String, String> entry : (extraHeaders == null ? Map.<String, String>of() : extraHeaders).entrySet()) out.put(entry.getKey(), "modern".equals(era) && entry.getKey().toLowerCase().startsWith("mcp-param-") ? encodeHeaderValue(entry.getValue()) : entry.getValue());
    if (!"modern".equals(era) && sessionId != null) out.put("MCP-Session-Id", sessionId);
    if (("modern".equals(era) || includeProtocolVersion) && protocolVersion != null) out.put("MCP-Protocol-Version", protocolVersion);
    if ("modern".equals(era) && method != null && !method.isBlank()) {
      out.put("Mcp-Method", method);
      String name = String.valueOf(Core.mcp_request_name(method, params == null ? Map.of() : params));
      if (!name.isBlank()) out.put("Mcp-Name", encodeHeaderValue(name));
    }
    lastHeaders = new LinkedHashMap<>(out);
    return out;
  }

  public void terminateSession() { if (!"modern".equals(era)) sessionId = null; }

  private static String encodeHeaderValue(String value) {
    Map<String, Object> plan = Core.asMap(Core.mcp_header_value_plan(value));
    if ("plain".equals(plan.get("mode"))) return value;
    return "=?base64?" + Base64.getEncoder().encodeToString(value.getBytes(java.nio.charset.StandardCharsets.UTF_8)) + "?=";
  }

  private static Map<String, Object> oauthTokenValue(AxMCPTokenSet token) {
    if (token == null) return null;
    Map<String,Object> out = new LinkedHashMap<>(); out.put("accessToken", token.accessToken);
    if (token.refreshToken != null) out.put("refreshToken", token.refreshToken); if (token.expiresAt != null) out.put("expiresAt", token.expiresAt); if (token.issuer != null) out.put("issuer", token.issuer); if (token.tokenType != null) out.put("tokenType", token.tokenType); if (token.scope != null) out.put("scope", token.scope); return out;
  }

  private static AxMCPTokenSet oauthTokenSet(Object value) {
    Map<String,Object> token = Core.asMap(value); Object expiresAt = token.get("expiresAt");
    return new AxMCPTokenSet(String.valueOf(token.getOrDefault("accessToken", "")), token.get("refreshToken") == null ? null : String.valueOf(token.get("refreshToken")), expiresAt instanceof Number number ? number.longValue() : null, token.get("issuer") == null ? null : String.valueOf(token.get("issuer")), token.get("tokenType") == null ? "Bearer" : String.valueOf(token.get("tokenType")), token.get("scope") == null ? null : String.valueOf(token.get("scope")));
  }

  private Map<String,Object> oauthGetJson(String endpoint, AxMCPOAuthOptions oauth) throws Exception {
    String checked = AxMCPClient.validateEndpoint(endpoint, oauth.ssrfProtection); HttpRequest request = HttpRequest.newBuilder(URI.create(checked)).header("Accept", "application/json").GET().build(); HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
    if (response.statusCode() < 200 || response.statusCode() >= 300) throw new AxMCPError("OAuth discovery HTTP error " + response.statusCode()); return Core.asMap(Json.parse(response.body()));
  }

  private Map<String,Object> oauthPostToken(String endpoint, Map<String,Object> body, AxMCPOAuthOptions oauth) throws Exception {
    String checked = AxMCPClient.validateEndpoint(endpoint, oauth.ssrfProtection); List<String> fields = new ArrayList<>();
    for (Map.Entry<String,Object> entry : body.entrySet()) if (!"__order".equals(entry.getKey())) fields.add(java.net.URLEncoder.encode(entry.getKey(), java.nio.charset.StandardCharsets.UTF_8) + "=" + java.net.URLEncoder.encode(String.valueOf(entry.getValue()), java.nio.charset.StandardCharsets.UTF_8));
    HttpRequest request = HttpRequest.newBuilder(URI.create(checked)).header("Accept", "application/json").header("Content-Type", "application/x-www-form-urlencoded").POST(HttpRequest.BodyPublishers.ofString(String.join("&", fields))).build(); HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
    if (response.statusCode() < 200 || response.statusCode() >= 300) throw new AxMCPError("OAuth token HTTP error " + response.statusCode() + ": " + response.body()); return Core.asMap(Json.parse(response.body()));
  }

  boolean applyOAuth() { return applyOAuth(""); }

  boolean applyOAuth(String wwwAuthenticate) {
    Object raw = options.get("oauth");
    if (raw == null) return false;
    AxMCPOAuthOptions oauth = raw instanceof AxMCPOAuthOptions typed ? typed : null;
    if (oauth == null) return false;
    try {
      AxMCPTokenSet stored = oauth.tokenStore == null ? null : oauth.tokenStore.getToken(endpoint); String grantType = oauth.grantType == null ? "authorization_code" : oauth.grantType;
      Map<String,Object> plan = Core.asMap(Core.mcp_oauth_plan_ensure_token(oauthTokenValue(stored), System.currentTimeMillis(), false, grantType, oauth.onAuthCode != null));
      if (!Boolean.TRUE.equals(plan.get("ok"))) throw new AxMCPError(String.valueOf(plan.getOrDefault("message", "OAuth token planning failed"))); String action = String.valueOf(plan.get("action"));
      if ("cached".equals(action)) { AxMCPTokenSet token = oauthTokenSet(plan.get("token")); headers.put("Authorization", "Bearer " + token.accessToken); return true; }
      Map<String,Object> parsedChallenge = Core.asMap(Core.mcp_oauth_parse_www_authenticate(wwwAuthenticate == null ? "" : wwwAuthenticate)); String resource = oauth.resource == null ? "" : oauth.resource; Map<String,Object> asMetadata = oauth.authorizationServerMetadata; String issuer = asMetadata == null ? "" : String.valueOf(asMetadata.getOrDefault("issuer", "")); String clientAuth = oauth.clientSecret == null || oauth.clientSecret.isBlank() ? "none" : "client_secret_post";
      if (asMetadata == null) {
        Map<String,Object> discovery = Core.asMap(Core.mcp_oauth_discovery_endpoints(endpoint, "", parsedChallenge.getOrDefault("resourceMetadata", ""))); Map<String,Object> resourceMetadata = null; Exception lastError = null;
        for (Object candidate : Core.asList(discovery.get("resourceMetadataEndpoints"))) try { resourceMetadata = oauthGetJson(String.valueOf(candidate), oauth); break; } catch (Exception error) { lastError = error; }
        if (resourceMetadata == null) throw new AxMCPError("Failed to resolve protected resource metadata: " + lastError); Map<String,Object> coverage = Core.asMap(Core.mcp_oauth_validate_resource_coverage(endpoint, resourceMetadata)); if (!Boolean.TRUE.equals(coverage.get("ok"))) throw new AxMCPError(String.valueOf(coverage.getOrDefault("message", "OAuth resource coverage validation failed")));
        if (resource.isBlank()) resource = String.valueOf(coverage.get("resource")); List<Object> issuers = Core.asList(coverage.get("issuers")); if (issuers.isEmpty()) throw new AxMCPError("No OAuth authorization server discovered"); issuer = String.valueOf(issuers.get(0));
        discovery = Core.asMap(Core.mcp_oauth_discovery_endpoints(endpoint, issuer, "")); lastError = null;
        for (Object candidateEndpoint : Core.asList(discovery.get("authorizationServerMetadataEndpoints"))) try { Map<String,Object> candidate = oauthGetJson(String.valueOf(candidateEndpoint), oauth); Map<String,Object> validation = Core.asMap(Core.mcp_oauth_validate_as_metadata(candidate, issuer, !"client_credentials".equals(grantType), clientAuth)); if (!Boolean.TRUE.equals(validation.get("ok"))) throw new AxMCPError(String.valueOf(validation.getOrDefault("message", "OAuth AS metadata validation failed"))); asMetadata = candidate; break; } catch (Exception error) { lastError = error; }
        if (asMetadata == null) throw new AxMCPError("Failed to discover authorization server metadata: " + lastError);
      }
      if (resource.isBlank()) resource = endpoint; if (issuer.isBlank()) issuer = String.valueOf(asMetadata.getOrDefault("issuer", "")); Map<String,Object> metadataValidation = Core.asMap(Core.mcp_oauth_validate_as_metadata(asMetadata, issuer, !"client_credentials".equals(grantType), clientAuth)); if (!Boolean.TRUE.equals(metadataValidation.get("ok"))) throw new AxMCPError(String.valueOf(metadataValidation.getOrDefault("message", "OAuth AS metadata validation failed")));
      oauth.authorizationServerMetadata = asMetadata; oauth.resource = resource;
      List<Object> scopes = new ArrayList<>(Core.asList(parsedChallenge.get("scopes"))); if (scopes.isEmpty()) scopes.addAll(oauth.scopes); if (scopes.isEmpty()) scopes.addAll(Core.asList(asMetadata.get("scopes_supported"))); String clientId = oauth.clientId == null || oauth.clientId.isBlank() ? "ax-mcp-client" : oauth.clientId; String clientSecret = oauth.clientSecret == null ? "" : oauth.clientSecret; String redirectUri = oauth.redirectUri == null || oauth.redirectUri.isBlank() ? "http://localhost:8787/callback" : oauth.redirectUri;
      final String flowResource = resource, flowIssuer = issuer; final Map<String,Object> flowMetadata = asMetadata; final List<Object> flowScopes = scopes;
      java.util.function.Function<Map<String,String>,AxMCPTokenSet> exchange = values -> { try { String selectedGrant = values.get("grant"), refresh = values.getOrDefault("refresh", ""); Map<String,Object> grant = Core.asMap(Core.mcp_oauth_grant_body(selectedGrant, clientId, clientSecret, clientAuth, flowResource, flowScopes, values.getOrDefault("code", ""), redirectUri, values.getOrDefault("verifier", ""), refresh)); if (!Boolean.TRUE.equals(grant.get("ok"))) throw new AxMCPError(String.valueOf(grant.getOrDefault("message", "OAuth grant planning failed"))); Map<String,Object> response = oauthPostToken(String.valueOf(flowMetadata.get("token_endpoint")), Core.asMap(grant.get("body")), oauth); Map<String,Object> parsed = Core.asMap(Core.mcp_oauth_parse_token_response(response, System.currentTimeMillis(), refresh, flowIssuer)); if (!Boolean.TRUE.equals(parsed.get("ok"))) throw new AxMCPError(String.valueOf(parsed.getOrDefault("message", "OAuth token response validation failed"))); return oauthTokenSet(parsed.get("token")); } catch (AxMCPError error) { throw error; } catch (Exception error) { throw new AxMCPError(error.getMessage()); } };
      AxMCPTokenSet next = null; if ("refresh".equals(action)) try { next = exchange.apply(Map.of("grant", "refresh_token", "refresh", String.valueOf(plan.get("refreshToken")))); } catch (Exception error) { if (oauth.tokenStore != null) oauth.tokenStore.clearToken(endpoint); action = "client_credentials".equals(grantType) ? "client_credentials" : "authorize"; }
      if ("client_credentials".equals(action)) next = exchange.apply(Map.of("grant", "client_credentials")); else if ("authorize".equals(action)) { if (oauth.onAuthCode == null) throw new AxMCPError("Authorization required. Provide oauth.onAuthCode to complete the flow"); String verifier = AxMCPClient.pkceVerifier(), challenge = AxMCPClient.pkceChallenge(verifier), state = AxMCPClient.pkceVerifier(); Map<String,Object> params = Core.asMap(Core.mcp_oauth_authorization_request_params(clientId, redirectUri, scopes, resource, state, challenge)); String authorizationEndpoint = AxMCPClient.validateEndpoint(String.valueOf(asMetadata.get("authorization_endpoint")), oauth.ssrfProtection); List<String> query = new ArrayList<>(); for (Map.Entry<String,Object> entry : params.entrySet()) if (!"__order".equals(entry.getKey())) query.add(java.net.URLEncoder.encode(entry.getKey(), java.nio.charset.StandardCharsets.UTF_8) + "=" + java.net.URLEncoder.encode(String.valueOf(entry.getValue()), java.nio.charset.StandardCharsets.UTF_8)); Map<String,String> auth = oauth.onAuthCode.apply(authorizationEndpoint + (authorizationEndpoint.contains("?") ? "&" : "?") + String.join("&", query)); if (auth == null || auth.get("code") == null) return false; Map<String,Object> authResponse = new LinkedHashMap<>(auth); authResponse.put("expectedState", state); Map<String,Object> validation = Core.asMap(Core.mcp_oauth_validate_issuer(authResponse, issuer, oauth.requireIss || Boolean.TRUE.equals(metadataValidation.get("requireIss")))); if (!Boolean.TRUE.equals(validation.get("ok"))) throw new AxMCPError(String.valueOf(validation.getOrDefault("message", "OAuth authorization response validation failed"))); next = exchange.apply(Map.of("grant", "authorization_code", "code", auth.get("code"), "verifier", verifier)); }
      if (next == null) throw new AxMCPError("OAuth flow produced no token"); if (oauth.tokenStore != null) oauth.tokenStore.setToken(endpoint, next); headers.put("Authorization", "Bearer " + next.accessToken); return true;
    } catch (AxMCPError error) { throw error; } catch (Exception error) { throw new AxMCPError(error.getMessage()); }
  }
}
