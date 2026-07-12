package dev.axllm.ax;

import java.net.URI;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Consumer;

public final class AxMCPClient {
  public static final String AX_MCP_PROTOCOL_VERSION = "2025-11-25";
  public static final List<String> AX_MCP_SUPPORTED_PROTOCOL_VERSIONS = List.of(
    AX_MCP_PROTOCOL_VERSION,
    "2025-06-18",
    "2025-03-26",
    "2024-11-05"
  );

  private final AxMCPTransport transport;
  private final Map<String, Object> options;
  private final List<Map<String, Object>> tools = new ArrayList<>();
  private final List<Map<String, Object>> prompts = new ArrayList<>();
  private final List<Map<String, Object>> resources = new ArrayList<>();
  private final List<Map<String, Object>> resourceTemplates = new ArrayList<>();
  private Map<String, Object> serverCapabilities = new LinkedHashMap<>();
  private Map<String, Object> serverInfo = new LinkedHashMap<>();
  private String serverInstructions;
  private String negotiatedProtocolVersion;
  private int nextId = 1;

  public AxMCPClient(AxMCPTransport transport) {
    this(transport, Map.of());
  }

  public AxMCPClient(AxMCPTransport transport, Map<String, Object> options) {
    this.transport = transport;
    this.options = options == null ? Map.of() : new LinkedHashMap<>(options);
    this.transport.setMessageHandler(this::handleInboundMessage);
  }

  public void init() {
    transport.connect();
    Map<String, Object> params = new LinkedHashMap<>();
    params.put("protocolVersion", options.getOrDefault("protocolVersion", AX_MCP_PROTOCOL_VERSION));
    params.put("capabilities", clientCapabilities());
    Map<String, Object> info = new LinkedHashMap<>();
    info.put("name", "AxMCPClient");
    info.put("title", "Ax MCP Client");
    info.put("version", "1.0.0");
    info.putAll(Core.asMap(options.get("clientInfo")));
    params.put("clientInfo", info);
    Map<String, Object> result = request("initialize", params);
    String negotiated = String.valueOf(result.get("protocolVersion"));
    List<Object> supportedRaw = Core.asList(options.getOrDefault("supportedProtocolVersions", AX_MCP_SUPPORTED_PROTOCOL_VERSIONS));
    List<String> supported = supportedRaw.stream().map(String::valueOf).toList();
    if (!supported.contains(negotiated)) throw new AxMCPError("Unsupported MCP protocol version " + negotiated);
    negotiatedProtocolVersion = negotiated;
    transport.setProtocolVersion(negotiated);
    serverCapabilities = Core.asMap(result.getOrDefault("capabilities", Map.of()));
    serverInfo = Core.asMap(result.getOrDefault("serverInfo", Map.of()));
    if (result.get("instructions") != null) serverInstructions = String.valueOf(result.get("instructions"));
    notify("notifications/initialized", null);
    refresh();
  }

  public void refresh() {
    tools.clear();
    prompts.clear();
    resources.clear();
    resourceTemplates.clear();
    if (capability("tools")) for (Object item : Core.asList(listTools(null).get("tools"))) tools.add(Core.asMap(item));
    if (capability("prompts")) for (Object item : Core.asList(listPrompts(null).get("prompts"))) prompts.add(Core.asMap(item));
    if (capability("resources")) {
      for (Object item : Core.asList(listResources(null).get("resources"))) resources.add(Core.asMap(item));
      for (Object item : Core.asList(listResourceTemplates(null).get("resourceTemplates"))) resourceTemplates.add(Core.asMap(item));
    }
  }

  public String getProtocolVersion() { return negotiatedProtocolVersion; }
  public Map<String, Object> getServerCapabilities() { return serverCapabilities; }
  public Map<String, Object> getServerInfo() { return serverInfo; }
  public String getServerInstructions() { return serverInstructions; }
  public List<Map<String, Object>> getTools() { return List.copyOf(tools); }

  public Map<String, Object> ping() { return request("ping", Map.of()); }
  public Map<String, Object> listTools(String cursor) { return request("tools/list", cursor == null ? Map.of() : Map.of("cursor", cursor)); }
  public Map<String, Object> callTool(String name, Map<String, Object> arguments) { return request("tools/call", Map.of("name", name, "arguments", arguments == null ? Map.of() : arguments)); }
  public Map<String, Object> listPrompts(String cursor) { return request("prompts/list", cursor == null ? Map.of() : Map.of("cursor", cursor)); }
  public Map<String, Object> getPrompt(String name, Map<String, Object> arguments) { return request("prompts/get", Map.of("name", name, "arguments", arguments == null ? Map.of() : arguments)); }
  public Map<String, Object> listResources(String cursor) { return request("resources/list", cursor == null ? Map.of() : Map.of("cursor", cursor)); }
  public Map<String, Object> readResource(String uri) { return request("resources/read", Map.of("uri", uri)); }
  public Map<String, Object> listResourceTemplates(String cursor) { return request("resources/templates/list", cursor == null ? Map.of() : Map.of("cursor", cursor)); }

  public void cancelRequest(Object requestId, String reason) {
    Map<String, Object> params = new LinkedHashMap<>();
    params.put("requestId", requestId);
    if (reason != null) params.put("reason", reason);
    notify("notifications/cancelled", params);
  }

  public List<Tool> toFunction() {
    List<Tool> out = new ArrayList<>();
    for (Map<String, Object> tool : tools) out.add(toolToFunction(tool));
    for (Map<String, Object> prompt : prompts) out.add(promptToFunction(prompt));
    for (Map<String, Object> resource : resources) out.add(resourceToFunction(resource));
    for (Map<String, Object> template : resourceTemplates) out.add(resourceTemplateToFunction(template));
    return out;
  }

  public List<Tool> nativeTools() {
    List<Tool> out = new ArrayList<>();
    for (Map<String, Object> tool : tools) {
      String original = String.valueOf(tool.getOrDefault("name", ""));
      out.add(new Tool(overrideName(original), overrideDescription(tool), List.of(), List.of(), args -> callTool(original, args)));
    }
    return out;
  }

  public List<Map<String, Object>> getPrompts() { return List.copyOf(prompts); }
  public List<Map<String, Object>> getResources() { return List.copyOf(resources); }
  public List<Map<String, Object>> getResourceTemplates() { return List.copyOf(resourceTemplates); }

  public String namespace() {
    Object configured = options.get("namespace");
    if (configured != null) return String.valueOf(configured);
    Object serverName = serverInfo.get("name");
    return serverName == null ? "mcp" : String.valueOf(serverName);
  }

  public Map<String, Object> request(String method, Map<String, Object> params) {
    Map<String, Object> message = new LinkedHashMap<>();
    message.put("jsonrpc", "2.0");
    message.put("id", String.valueOf(nextId++));
    message.put("method", method);
    if (params != null) message.put("params", params);
    Map<String, Object> response = transport.send(message);
    if (response.containsKey("error")) {
      Map<String, Object> error = Core.asMap(response.get("error"));
      throw new AxMCPError(String.valueOf(error.getOrDefault("message", "MCP JSON-RPC error")));
    }
    return Core.asMap(response.getOrDefault("result", Map.of()));
  }

  void notify(String method, Map<String, Object> params) {
    Map<String, Object> message = new LinkedHashMap<>();
    message.put("jsonrpc", "2.0");
    message.put("method", method);
    if (params != null) message.put("params", params);
    transport.sendNotification(message);
  }

  private Map<String, Object> clientCapabilities() {
    Map<String, Object> capabilities = new LinkedHashMap<>(Core.asMap(options.get("capabilities")));
    if (options.containsKey("roots") && !capabilities.containsKey("roots")) capabilities.put("roots", Map.of("listChanged", true));
    return capabilities;
  }

  private boolean capability(String name) {
    Object value = serverCapabilities.get(name);
    return value != null && !Boolean.FALSE.equals(value);
  }

  private void handleInboundMessage(Map<String, Object> message) {
    if ("roots/list".equals(message.get("method")) && message.containsKey("id")) {
      Map<String, Object> response = new LinkedHashMap<>();
      response.put("jsonrpc", "2.0");
      response.put("id", message.get("id"));
      response.put("result", Map.of("roots", options.getOrDefault("roots", List.of())));
      transport.sendResponse(response);
      return;
    }
    Object callback = options.get("onNotification");
    if (callback instanceof Consumer<?> raw) {
      @SuppressWarnings("unchecked")
      Consumer<Map<String, Object>> consumer = (Consumer<Map<String, Object>>) raw;
      consumer.accept(message);
    }
  }

  private Tool toolToFunction(Map<String, Object> tool) {
    String original = String.valueOf(tool.getOrDefault("name", ""));
    String name = overrideName(original);
    String description = overrideDescription(tool);
    return new Tool(name, description, List.of(), List.of(), args -> {
      Map<String, Object> result = callTool(original, args);
      if (result.containsKey("structuredContent")) return result.get("structuredContent");
      return Map.of("content", contentText(Core.asList(result.get("content"))));
    });
  }

  private Tool promptToFunction(Map<String, Object> prompt) {
    String original = String.valueOf(prompt.getOrDefault("name", ""));
    return new Tool(overrideName("prompt_" + original), overrideDescription(prompt), List.of(), List.of(), args -> getPrompt(original, args));
  }

  private Tool resourceToFunction(Map<String, Object> resource) {
    String uri = String.valueOf(resource.get("uri"));
    return new Tool(overrideName("resource_" + safeName(String.valueOf(resource.getOrDefault("name", uri)))), overrideDescription(resource), List.of(), List.of(), args -> readResource(uri));
  }

  private Tool resourceTemplateToFunction(Map<String, Object> template) {
    return new Tool(overrideName("resource_template_" + safeName(String.valueOf(template.getOrDefault("name", "template")))), overrideDescription(template), List.of(), List.of(), args -> readResource(String.valueOf(args.get("uri"))));
  }

  private String overrideName(String name) {
    for (Object raw : Core.asList(options.get("functionOverrides"))) {
      Map<String, Object> item = Core.asMap(raw);
      if (name.equals(item.get("name"))) return String.valueOf(Core.asMap(item.get("updates")).getOrDefault("name", name));
    }
    return name;
  }

  private String overrideDescription(Map<String, Object> item) {
    String name = String.valueOf(item.getOrDefault("name", ""));
    String description = String.valueOf(item.getOrDefault("description", item.getOrDefault("title", name)));
    for (Object raw : Core.asList(options.get("functionOverrides"))) {
      Map<String, Object> override = Core.asMap(raw);
      if (name.equals(override.get("name"))) return String.valueOf(Core.asMap(override.get("updates")).getOrDefault("description", description));
    }
    return description;
  }

  static String safeName(String value) {
    return value.replaceAll("[^A-Za-z0-9]+", "_").replaceAll("^_+|_+$", "");
  }

  static String contentText(List<Object> content) {
    List<String> text = new ArrayList<>();
    for (Object raw : content) {
      Map<String, Object> item = Core.asMap(raw);
      if ("text".equals(item.get("type"))) text.add(String.valueOf(item.getOrDefault("text", "")));
    }
    return String.join("\n", text);
  }

  public static String pkceVerifier() {
    return Base64.getUrlEncoder().withoutPadding().encodeToString((UUID.randomUUID().toString() + UUID.randomUUID()).getBytes(java.nio.charset.StandardCharsets.UTF_8));
  }

  public static String pkceChallenge(String verifier) {
    try {
      MessageDigest digest = MessageDigest.getInstance("SHA-256");
      return Base64.getUrlEncoder().withoutPadding().encodeToString(digest.digest(verifier.getBytes(java.nio.charset.StandardCharsets.US_ASCII)));
    } catch (Exception error) {
      throw new AxMCPError(error.getMessage());
    }
  }

  public static String validateEndpoint(String endpoint, Map<String, Object> options) {
    URI uri = URI.create(endpoint);
    if (!"http".equals(uri.getScheme()) && !"https".equals(uri.getScheme())) throw new AxMCPError("MCP endpoint must use http or https");
    boolean requireHttps = !Boolean.FALSE.equals(Core.asMap(options).getOrDefault("requireHttps", Core.asMap(options).getOrDefault("require_https", true)));
    if (requireHttps && !"https".equals(uri.getScheme())) throw new AxMCPError("MCP endpoint must use https");
    String host = uri.getHost();
    if (host == null || host.isBlank()) throw new AxMCPError("MCP endpoint must include a host");
    boolean allowLocalhost = Core.truthy(Core.asMap(options).getOrDefault("allowLocalhost", Core.asMap(options).get("allow_localhost")));
    boolean allowPrivate = Core.truthy(Core.asMap(options).getOrDefault("allowPrivateNetworks", Core.asMap(options).get("allow_private_networks")));
    if ((host.equals("localhost") || host.equals("localhost.localdomain")) && !allowLocalhost) throw new AxMCPError("MCP endpoint host is local");
    if (host.matches("\\d+\\.\\d+\\.\\d+\\.\\d+")) {
      String[] parts = host.split("\\.");
      int a = Integer.parseInt(parts[0]);
      int b = Integer.parseInt(parts[1]);
      boolean local = a == 127;
      boolean priv = a == 10 || (a == 172 && b >= 16 && b <= 31) || (a == 192 && b == 168) || (a == 169 && b == 254);
      if ((local && !allowLocalhost) || (priv && !allowPrivate) || a == 0 || a >= 224) throw new AxMCPError("MCP endpoint host is not allowed by SSRF protection");
    }
    return endpoint;
  }

  public static String stdioEncode(Map<String, Object> message) { return Json.stringify(message) + "\n"; }
  public static Map<String, Object> stdioDecode(String line) { return Core.asMap(Json.parse(line.trim())); }

  public static void runConformanceFixture(Map<String, Object> fixture) {
    String operation = String.valueOf(fixture.getOrDefault("operation", "initialize"));
    String expectedError = fixture.containsKey("expected_error_contains") ? String.valueOf(fixture.get("expected_error_contains")) : null;
    try {
      if ("ssrf".equals(operation)) {
        validateEndpoint(String.valueOf(fixture.getOrDefault("endpoint", "https://127.0.0.1/mcp")), Core.asMap(fixture.get("ssrfProtection")));
        if (expectedError != null) throw new AssertionError("expected SSRF validation to fail");
        return;
      }
      if ("stdio_framing".equals(operation)) {
        String encoded = stdioEncode(Core.asMap(fixture.get("message")));
        if (fixture.get("expected_line") != null && !encoded.equals(fixture.get("expected_line"))) throw new AssertionError("stdio line mismatch");
        assertSubset(stdioDecode(encoded), fixture.get("message"), "stdio decoded");
        return;
      }
      if ("oauth".equals(operation)) {
        String challenge = pkceChallenge(String.valueOf(fixture.getOrDefault("verifier", "test-verifier")));
        if (fixture.get("expected_challenge") != null && !challenge.equals(fixture.get("expected_challenge"))) throw new AssertionError("PKCE challenge mismatch");
        MapTokenStore store = new MapTokenStore();
        AxMCPOAuthOptions oauth = new AxMCPOAuthOptions();
        oauth.tokenStore = store;
        oauth.onAuthCode = url -> Map.of("code", "abc");
        AxMCPStreamableHTTPTransport transport = new AxMCPStreamableHTTPTransport(String.valueOf(fixture.getOrDefault("endpoint", "https://example.com/mcp")), Map.of("oauth", oauth));
        if (!transport.applyOAuth()) throw new AssertionError("OAuth flow did not produce a token");
        if (!transport.headers().containsKey("Authorization")) throw new AssertionError("OAuth flow did not set Authorization");
        return;
      }
      if ("http_session_headers".equals(operation)) {
        AxMCPStreamableHTTPTransport transport = new AxMCPStreamableHTTPTransport(String.valueOf(fixture.getOrDefault("endpoint", "https://example.com/mcp")), Core.asMap(fixture.get("transport_options")));
        transport.setSessionId(String.valueOf(fixture.getOrDefault("session_id", "session-1")));
        transport.setProtocolVersion(String.valueOf(fixture.getOrDefault("protocol_version", AX_MCP_PROTOCOL_VERSION)));
        assertSubset(transport.buildHeaders(Map.of("Accept", "application/json"), true), fixture.getOrDefault("expected_headers", Map.of()), "headers");
        return;
      }
      if ("execution_context_ucp".equals(operation)) {
        AxMCPScriptedTransport transport = new AxMCPScriptedTransport(Core.asList(fixture.getOrDefault("responses", List.of())));
        AxMCPClient mcp = new AxMCPClient(transport, Core.asMap(fixture.get("client_options")));
        AxUCPClient ucp = new AxUCPClient(Core.asMap(fixture.get("ucp_profile")), (_operation, _payload, _options) -> Core.asMap(fixture.get("ucp_response")), Core.asMap(fixture.get("ucp_options")));
        AxExecutionContext context = new AxExecutionContext(List.of(mcp), List.of(ucp)).initialize();
        List<String> expectedNamespaces = Core.asList(fixture.get("expected_namespaces")).stream().map(String::valueOf).toList();
        if (!context.namespaces().equals(expectedNamespaces)) throw new AssertionError("context namespaces mismatch: " + context.namespaces());
        List<String> names = context.nativeTools().stream().map(tool -> tool.name).toList();
        for (Object expected : Core.asList(fixture.get("expected_native_tools"))) if (!names.contains(String.valueOf(expected))) throw new AssertionError("missing native context tool " + expected);
        Map<String, Object> call = Core.asMap(fixture.get("call_ucp"));
        Map<String, Object> outcome = ucp.call(String.valueOf(call.getOrDefault("operation", "catalog.search")), Core.asMap(call.get("payload")), "fixture-key");
        assertSubset(outcome, fixture.getOrDefault("expected_ucp_outcome", Map.of()), "UCP outcome");
        AxMCPContinuationState state = context.continuationState();
        if (!state.namespaces().equals(expectedNamespaces) || state.catalogFingerprint().isBlank()) throw new AssertionError("invalid execution context continuation state");
        return;
      }
      AxMCPScriptedTransport transport = new AxMCPScriptedTransport(Core.asList(fixture.getOrDefault("responses", fixture.getOrDefault("transport_responses", List.of()))));
      AxMCPClient client = new AxMCPClient(transport, Core.asMap(fixture.get("client_options")));
      client.init();
      if (fixture.get("expected_protocol_version") != null && !String.valueOf(fixture.get("expected_protocol_version")).equals(client.getProtocolVersion())) throw new AssertionError("protocol version mismatch");
      if ("initialize".equals(operation)) {
        assertRequests(transport.requests, fixture);
      } else if ("protocol_negotiation".equals(operation)) {
        return;
      } else if ("ping".equals(operation)) {
        client.ping();
        assertRequests(transport.requests, fixture);
      } else if ("tools".equals(operation)) {
        List<Tool> functions = client.nativeTools();
        List<String> names = functions.stream().map(tool -> tool.name).toList();
        if (fixture.get("expected_function_names") != null && !names.equals(Core.asList(fixture.get("expected_function_names")).stream().map(String::valueOf).toList())) throw new AssertionError("function names mismatch: " + names);
        if (fixture.get("call_function") != null) {
          Map<String, Object> call = Core.asMap(fixture.get("call_function"));
          Object result = functions.stream().filter(tool -> tool.name.equals(call.get("name"))).findFirst().orElseThrow().call(Core.asMap(call.get("arguments")));
          assertSubset(result, fixture.getOrDefault("expected_call_result", Map.of()), "tool result");
        }
        assertRequests(transport.requests, fixture);
      } else if ("prompts_resources".equals(operation)) {
        assertCatalogNames(client.getPrompts(), fixture.get("expected_prompt_names"), "prompt names");
        assertCatalogNames(client.getResources(), fixture.get("expected_resource_names"), "resource names");
        assertCatalogNames(client.getResourceTemplates(), fixture.get("expected_resource_template_names"), "resource template names");
      } else if ("roots_notifications".equals(operation)) {
        transport.emit(new LinkedHashMap<>(Map.of("jsonrpc", "2.0", "id", "server-1", "method", "roots/list")));
        assertSubset(transport.sentResponses.get(0), fixture.getOrDefault("expected_roots_response", Map.of()), "roots response");
      } else if ("cancellation".equals(operation)) {
        client.cancelRequest(fixture.getOrDefault("request_id", "1"), String.valueOf(fixture.getOrDefault("reason", "cancelled")));
        assertSubset(transport.notifications.get(transport.notifications.size() - 1), fixture.getOrDefault("expected_notification", Map.of()), "cancel notification");
      } else {
        throw new AssertionError("unsupported MCP conformance operation " + operation);
      }
    } catch (Throwable error) {
      if (expectedError != null && error.getMessage() != null && error.getMessage().contains(expectedError)) return;
      if (error instanceof RuntimeException runtime) throw runtime;
      throw new RuntimeException(error);
    }
  }

  private static void assertCatalogNames(List<Map<String, Object>> catalog, Object expected, String label) {
    if (expected == null) return;
    List<String> names = catalog.stream().map(item -> String.valueOf(item.get("name"))).toList();
    List<String> expectedNames = Core.asList(expected).stream().map(String::valueOf).toList();
    if (!names.equals(expectedNames)) throw new AssertionError(label + " mismatch: " + names);
  }

  static void assertRequests(List<Map<String, Object>> requests, Map<String, Object> fixture) {
    List<Object> expected = Core.asList(fixture.get("expected_requests"));
    if (requests.size() < expected.size()) throw new AssertionError("expected at least " + expected.size() + " requests, got " + requests.size());
    for (int i = 0; i < expected.size(); i++) assertSubset(requests.get(i), expected.get(i), "request " + i);
  }

  @SuppressWarnings("unchecked")
  static void assertSubset(Object actual, Object expected, String label) {
    if (expected instanceof Map<?, ?> expectedMap) {
      if (!(actual instanceof Map<?, ?> actualMap)) throw new AssertionError(label + ": expected object");
      for (Map.Entry<?, ?> entry : expectedMap.entrySet()) {
        if (!actualMap.containsKey(entry.getKey())) throw new AssertionError(label + ": missing key " + entry.getKey());
        assertSubset(actualMap.get(entry.getKey()), entry.getValue(), label + "." + entry.getKey());
      }
    } else if (expected instanceof List<?> expectedList) {
      if (!(actual instanceof List<?> actualList)) throw new AssertionError(label + ": expected list");
      if (actualList.size() < expectedList.size()) throw new AssertionError(label + ": expected list length at least " + expectedList.size());
      for (int i = 0; i < expectedList.size(); i++) assertSubset(actualList.get(i), expectedList.get(i), label + "[" + i + "]");
    } else if (expected != null && !expected.equals(actual)) {
      throw new AssertionError(label + ": expected " + expected + ", got " + actual);
    }
  }

  static final class MapTokenStore implements AxMCPOAuthOptions.TokenStore {
    final Map<String, AxMCPTokenSet> tokens = new LinkedHashMap<>();
    public AxMCPTokenSet getToken(String key) { return tokens.get(key); }
    public void setToken(String key, AxMCPTokenSet token) { tokens.put(key, token); }
  }
}

final class AxMCPError extends RuntimeException {
  AxMCPError(String message) { super(message); }
}
