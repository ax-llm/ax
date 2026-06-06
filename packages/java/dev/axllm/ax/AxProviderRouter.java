package dev.axllm.ax;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public final class AxProviderRouter {
  private final List<AxAIService> providers = new ArrayList<>();
  private final Map<String, Object> routing;
  private final Map<String, Object> processing;

  public AxProviderRouter(Map<String, Object> config) {
    Map<String, Object> providersConfig = Core.asMap(config.getOrDefault("providers", Map.of()));
    Object primary = providersConfig.get("primary");
    if (primary instanceof AxAIService service) providers.add(service);
    for (Object item : Core.asList(providersConfig.getOrDefault("alternatives", List.of()))) if (item instanceof AxAIService service) providers.add(service);
    Map<String, Object> routingConfig = Core.asMap(config.getOrDefault("routing", Map.of()));
    routing = Core.asMap(routingConfig.getOrDefault("capability", Map.of()));
    processing = Core.asMap(config.getOrDefault("processing", Map.of()));
  }

  private List<Object> providerRecords() {
    List<Object> records = new ArrayList<>();
    for (AxAIService provider : providers) {
      Map<String, Object> record = new LinkedHashMap<>();
      record.put("name", provider.getName());
      record.put("id", provider.getId());
      record.put("features", provider.getFeatures(null));
      records.add(record);
    }
    return records;
  }

  private AxAIService serviceForName(Object name) {
    for (AxAIService provider : providers) if (provider.getName().equals(String.valueOf(name))) return provider;
    return providers.isEmpty() ? null : providers.get(0);
  }

  public Map<String, Object> getRoutingRecommendation(Map<String, Object> request) {
    Map<String, Object> rec = Core.asMap(Core.provider_route_recommendation(providerRecords(), Core.coerceChatRequest(request), routing));
    Map<String, Object> out = new LinkedHashMap<>(rec);
    out.put("provider", serviceForName(out.get("providerName")));
    return out;
  }

  public Map<String, Object> validateRequest(Map<String, Object> request) {
    return Core.asMap(Core.provider_route_validation(providerRecords(), Core.coerceChatRequest(request), processing, routing));
  }

  public Map<String, Object> getRoutingStats() {
    return Core.asMap(Core.provider_routing_stats(providerRecords()));
  }

  public Map<String, Object> chat(Map<String, Object> request, Map<String, Object> options) throws Exception {
    Map<String, Object> rec = getRoutingRecommendation(request);
    AxAIService provider = (AxAIService) rec.get("provider");
    if (provider == null) throw new AxUnsupportedCapabilityError("No provider selected");
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("response", provider.chat(request));
    out.put("routing", rec);
    return out;
  }
}
