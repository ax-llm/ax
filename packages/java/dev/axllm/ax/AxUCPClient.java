package dev.axllm.ax;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

public final class AxUCPClient {
  public static final String UCP_VERSION = "2026-04-08";
  public static final Set<String> OPERATIONS = Set.of(
    "catalog.search", "catalog.lookup", "catalog.product",
    "cart.create", "cart.get", "cart.update", "cart.cancel",
    "checkout.create", "checkout.get", "checkout.update", "checkout.complete", "checkout.cancel",
    "fulfillment.quote", "discounts.apply", "payments.create", "payments.confirm",
    "orders.get", "identity.link", "attribution.record", "handoff.create"
  );

  private final Map<String, Object> profile;
  private final AxUCPBinding binding;
  private final Map<String, Object> options;
  private final String version;

  public AxUCPClient(Map<String, Object> profile, AxUCPBinding binding) {
    this(profile, binding, Map.of());
  }

  public AxUCPClient(Map<String, Object> profile, AxUCPBinding binding, Map<String, Object> options) {
    this.profile = new LinkedHashMap<>(profile == null ? Map.of() : profile);
    this.binding = binding;
    this.options = new LinkedHashMap<>(options == null ? Map.of() : options);
    this.version = String.valueOf(this.profile.getOrDefault("version", this.options.getOrDefault("version", UCP_VERSION)));
    List<Object> supported = Core.asList(this.options.getOrDefault("supportedVersions", List.of(UCP_VERSION)));
    if (supported.stream().noneMatch(value -> version.equals(String.valueOf(value)))) {
      throw new IllegalArgumentException("Unsupported UCP version " + version);
    }
  }

  public String namespace() {
    return String.valueOf(options.getOrDefault("namespace", profile.getOrDefault("name", "ucp")));
  }

  public Map<String, Object> getProfile() { return Map.copyOf(profile); }
  public String getVersion() { return version; }

  public Map<String, Object> call(String operation, Map<String, Object> payload) {
    return call(operation, payload, null);
  }

  public Map<String, Object> call(String operation, Map<String, Object> payload, String idempotencyKey) {
    if (!OPERATIONS.contains(operation)) throw new IllegalArgumentException("Unsupported UCP operation " + operation);
    String key = idempotencyKey == null ? UUID.randomUUID().toString() : idempotencyKey;
    Map<String, Object> value = binding.call(operation, payload == null ? Map.of() : payload, Map.of("version", version, "idempotencyKey", key));
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("operation", operation);
    out.put("value", value);
    out.put("warnings", value.get("warnings"));
    out.put("partialSuccess", Boolean.TRUE.equals(value.get("partial_success")) || Boolean.TRUE.equals(value.get("partialSuccess")));
    out.put("continuationUrl", value.getOrDefault("continuation_url", value.get("continuationUrl")));
    out.put("idempotencyKey", key);
    return out;
  }

  public List<Tool> nativeTools() {
    List<Tool> out = new ArrayList<>();
    for (String operation : OPERATIONS) {
      String name = namespace() + "_" + operation.replace('.', '_');
      out.add(new Tool(name, "UCP " + operation + " operation", List.of(), List.of(), args -> call(operation, args)));
    }
    return out;
  }

  public Map<String, Object> catalogSearch(Map<String, Object> payload) { return call("catalog.search", payload); }
  public Map<String, Object> catalogLookup(Map<String, Object> payload) { return call("catalog.lookup", payload); }
  public Map<String, Object> catalogProduct(Map<String, Object> payload) { return call("catalog.product", payload); }
  public Map<String, Object> cartCreate(Map<String, Object> payload) { return call("cart.create", payload); }
  public Map<String, Object> cartGet(Map<String, Object> payload) { return call("cart.get", payload); }
  public Map<String, Object> cartUpdate(Map<String, Object> payload) { return call("cart.update", payload); }
  public Map<String, Object> cartCancel(Map<String, Object> payload) { return call("cart.cancel", payload); }
  public Map<String, Object> checkoutCreate(Map<String, Object> payload) { return call("checkout.create", payload); }
  public Map<String, Object> checkoutGet(Map<String, Object> payload) { return call("checkout.get", payload); }
  public Map<String, Object> checkoutUpdate(Map<String, Object> payload) { return call("checkout.update", payload); }
  public Map<String, Object> checkoutComplete(Map<String, Object> payload) { return call("checkout.complete", payload); }
  public Map<String, Object> checkoutCancel(Map<String, Object> payload) { return call("checkout.cancel", payload); }
  public Map<String, Object> orderGet(Map<String, Object> payload) { return call("orders.get", payload); }
  public Map<String, Object> identityLink(Map<String, Object> payload) { return call("identity.link", payload); }
}
