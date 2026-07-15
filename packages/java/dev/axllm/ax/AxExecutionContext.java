package dev.axllm.ax;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

public final class AxExecutionContext {
  private final List<AxMCPClient> mcp;
  private final List<AxUCPClient> ucp;
  private final Set<AxMCPClient> initialized = new HashSet<>();

  public AxExecutionContext(List<AxMCPClient> mcp, List<AxUCPClient> ucp) {
    this.mcp = new ArrayList<>(mcp == null ? List.of() : mcp);
    this.ucp = new ArrayList<>(ucp == null ? List.of() : ucp);
    List<String> names = namespaces();
    if (new HashSet<>(names).size() != names.size()) throw new IllegalArgumentException("MCP/UCP namespace collision");
  }

  public List<AxMCPClient> mcp() { return List.copyOf(mcp); }
  public List<AxUCPClient> ucp() { return List.copyOf(ucp); }

  public synchronized AxExecutionContext initialize() {
    for (AxMCPClient client : mcp) if (initialized.add(client)) client.init();
    return this;
  }

  public List<Tool> nativeTools() {
    initialize();
    List<Tool> out = new ArrayList<>();
    for (AxMCPClient client : mcp) out.addAll(client.nativeTools());
    for (AxUCPClient client : ucp) out.addAll(client.nativeTools());
    Set<String> names = new HashSet<>();
    for (Tool tool : out) if (!names.add(tool.name)) throw new IllegalArgumentException("MCP/UCP tool collision " + tool.name);
    return out;
  }

  public List<Map<String, Object>> runtimeModules() {
    List<Map<String, Object>> out = new ArrayList<>();
    for (AxMCPClient client : mcp) out.add(Map.of("name", "mcp." + client.namespace(), "functions", client.nativeTools(), "client", client));
    for (AxUCPClient client : ucp) out.add(Map.of("name", "ucp." + client.namespace(), "functions", client.nativeTools(), "client", client));
    return out;
  }

  public AxExecutionContext derive(Object inheritance) {
    if ("none".equals(inheritance)) return new AxExecutionContext(List.of(), List.of());
    if (inheritance instanceof List<?> allowedRaw) {
      Set<String> allowed = new HashSet<>(allowedRaw.stream().map(String::valueOf).toList());
      return new AxExecutionContext(mcp.stream().filter(c -> allowed.contains(c.namespace())).toList(), ucp.stream().filter(c -> allowed.contains(c.namespace())).toList());
    }
    return this;
  }

  public List<String> namespaces() {
    List<String> out = new ArrayList<>();
    for (AxMCPClient client : mcp) out.add(client.namespace());
    for (AxUCPClient client : ucp) out.add(client.namespace());
    return out;
  }

  public AxMCPContinuationState continuationState() {
    try {
      byte[] digest = MessageDigest.getInstance("SHA-256").digest(String.join("\n", namespaces()).getBytes(StandardCharsets.UTF_8));
      return new AxMCPContinuationState(namespaces(), List.of(), List.of(), java.util.HexFormat.of().formatHex(digest));
    } catch (Exception error) {
      throw new IllegalStateException(error);
    }
  }

  public static AxExecutionContext resolve(Map<String, Object> options, AxExecutionContext parent) {
    Map<String, Object> opts = options == null ? Map.of() : options;
    Object explicit = opts.getOrDefault("executionContext", opts.get("mcpExecutionContext"));
    if (explicit instanceof AxExecutionContext context) return context.derive(opts.getOrDefault("mcpInheritance", "all"));
    if (opts.containsKey("mcp") || opts.containsKey("ucp")) {
      List<AxMCPClient> mcp = new ArrayList<>();
      Object rawMcp = opts.get("mcp");
      if (rawMcp instanceof AxMCPClient client) mcp.add(client);
      else for (Object item : Core.asList(rawMcp)) if (item instanceof AxMCPClient client) mcp.add(client);
      List<AxUCPClient> ucp = new ArrayList<>();
      Object rawUcp = opts.get("ucp");
      if (rawUcp instanceof AxUCPClient client) ucp.add(client);
      else for (Object item : Core.asList(rawUcp)) if (item instanceof AxUCPClient client) ucp.add(client);
      return new AxExecutionContext(mcp, ucp);
    }
    return parent == null ? null : parent.derive(opts.getOrDefault("mcpInheritance", "all"));
  }
}
