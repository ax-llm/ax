package dev.axllm.ax;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public final class AxProviderRouter implements AiClient,ChatRunSelector,AxChatSession.Provider {
  private final List<AxAIService> providers = new ArrayList<>();
  private final Map<String, Object> routing;
  private final Map<String, Object> processing;

  public java.util.function.Supplier<AiClient> ownedWorkerFactory() {
    var factories=new ArrayList<java.util.function.Supplier<AiClient>>();for(var provider:providers){var factory=provider.ownedWorkerFactory();if(factory==null)return null;factories.add(factory);}
    var processing=Core.asMap(Core.ownedCopy(this.processing));var routing=Core.asMap(Core.ownedCopy(this.routing));
    return ()->{var worker=new AxProviderRouter(Map.of("processing",Core.ownedCopy(processing),"routing",Map.of("capability",Core.ownedCopy(routing))));for(var factory:factories)worker.providers.add((AxAIService)factory.get());return worker;};
  }

  public AxProviderRouter(Map<String, Object> config) {
    Map<String, Object> providersConfig = Core.asMap(config.getOrDefault("providers", Map.of()));
    Object primary = providersConfig.get("primary");
    if (primary instanceof AxAIService service) providers.add(service);
    for (Object item : Core.asList(providersConfig.getOrDefault("alternatives", List.of()))) if (item instanceof AxAIService service) providers.add(service);
    Map<String, Object> routingConfig = Core.asMap(config.getOrDefault("routing", Map.of()));
    routing = Core.asMap(routingConfig.getOrDefault("capability", Map.of()));
    processing = Core.asMap(config.getOrDefault("processing", Map.of()));
  }

  @FunctionalInterface
  public interface FileToText { String extract(String data, String mimeType) throws Exception; }

  private static Map<String,Object> preprocess(Map<String,Object> features, Map<String,Object> request, Map<String,Object> processing) {
    Map<String,Object> prepared = new LinkedHashMap<>(processing);
    prepared.remove("file_texts");
    Object raw = processing.getOrDefault("fileToText", processing.get("file_to_text"));
    if (raw != null) {
      if (!(raw instanceof FileToText extractor)) throw new IllegalArgumentException("fileToText must implement FileToText");
      Map<String,Object> texts = new LinkedHashMap<>();
      for (Object entry : Core.asList(Core.provider_route_file_extractions(features, request))) {
        Map<String,Object> task = Core.asMap(entry);
        try { texts.put(String.valueOf(task.get("slot")), extractor.extract(String.valueOf(task.get("data")), String.valueOf(task.get("mime_type")))); }
        catch (Exception error) { throw new IllegalStateException("File content processing failed: " + error.getMessage(), error); }
      }
      prepared.put("file_texts", texts);
    }
    return Core.asMap(Core.provider_route_preprocess_request(features, request, prepared));
  }

  public Map<String,Object> getFeatures(String model){return AxBalancer.mergedFeatures(providers,model);}
  public AiClient pinChatRun(Map<String,Object> request,Map<String,Object> options)throws Exception {
    AiClient selected=selectedProvider(request);
    var visited=java.util.Collections.newSetFromMap(new java.util.IdentityHashMap<AiClient,Boolean>());
    while(selected instanceof ChatRunSelector selector){if(!visited.add(selected))throw new IllegalStateException("Cyclic run routing");selected=selector.pinChatRun(request,options);}
    return new PinnedProvider(selected,options,processing);
  }
  public AxChatSession openChatSession(Map<String,Object> request,Map<String,Object> options)throws Exception{return ((AxChatSession.Provider)pinChatRun(request,options)).openChatSession(request,options);}
  public Map<String,Object> complete(Map<String,Object> request)throws Exception{return Core.asMap(Core.chat_response_to_completion(chat(request,Map.of()).get("response")));}
  private static final class PinnedProvider implements AiClient,ChatRunFeatures,AxChatSession.Provider {
    private final AiClient client;private final Map<String,Object> options;private final Map<String,Object> processing;
    PinnedProvider(AiClient client,Map<String,Object> options,Map<String,Object> processing){this.client=client;this.options=options;this.processing=processing;}
    public Map<String,Object> getFeatures(String model){return Core.asMap(Core.aiClientFeatures(client,model));}
    private Map<String,Object> request(Map<String,Object> request){return preprocess(Core.asMap(Core.aiClientFeatures(client,request.get("model"))),request,processing);}
    public Map<String,Object> complete(Map<String,Object> request)throws Exception{return Core.asMap(Core.aiCompleteOnce(client,request(request),options));}
    public AxChatSession openChatSession(Map<String,Object> request,Map<String,Object> options)throws Exception {
      if(!(client instanceof AxChatSession.Provider provider))throw new IllegalArgumentException("Selected provider does not support chat sessions");return provider.openChatSession(request(request),options);
    }
  }

  private List<Object> providerRecords() {return providerRecords(null);}
  private List<Object> providerRecords(String model) {
    List<Object> records = new ArrayList<>();
    for (AxAIService provider : providers) {
      Map<String, Object> record = new LinkedHashMap<>();
      record.put("name", provider.getName());
      record.put("id", provider.getId());
      record.put("features", provider.getFeatures(model));
      records.add(record);
    }
    return records;
  }

  private AxAIService serviceForName(Object name) {
    for (AxAIService provider : providers) if (provider.getName().equals(String.valueOf(name))) return provider;
    return providers.isEmpty() ? null : providers.get(0);
  }

  public Map<String, Object> getRoutingRecommendation(Map<String, Object> request) {
    Map<String, Object> rec = Core.asMap(Core.provider_route_recommendation(providerRecords(request.get("model")==null?null:String.valueOf(request.get("model"))), Core.coerceChatRequest(request), routing));
    Map<String, Object> out = new LinkedHashMap<>(rec);
    out.put("provider", serviceForName(out.get("providerName")));
    return out;
  }

  public Map<String, Object> validateRequest(Map<String, Object> request) {
    return Core.asMap(Core.provider_route_validation(providerRecords((String)request.get("model")), Core.coerceChatRequest(request), processing, routing));
  }

  public Map<String, Object> getRoutingStats() {
    return Core.asMap(Core.provider_routing_stats(providerRecords()));
  }

  private AxAIService selectedProvider(Map<String, Object> request) throws Exception {
    Map<String, Object> rec = getRoutingRecommendation(request);
    AxAIService provider = (AxAIService) rec.get("provider");
    if (provider == null) throw new AxUnsupportedCapabilityError("No provider selected");
    return provider;
  }

  public Map<String, Object> chat(Map<String, Object> request, Map<String, Object> options) throws Exception {
    Map<String, Object> rec = getRoutingRecommendation(request);
    AxAIService provider = selectedProvider(request);
    Map<String, Object> processedRequest = preprocess(provider.getFeatures((String)request.get("model")), request, processing);
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("response", provider.chat(processedRequest, options));
    out.put("routing", rec);
    return out;
  }

  public Iterable<Map<String, Object>> stream(Map<String, Object> request, Map<String, Object> options) throws Exception {
    Object raw=options==null?null:options.getOrDefault("cancellation",options.getOrDefault("cancellationToken",options.get("cancellation_token")));
    AxCancellationToken cancellation=raw instanceof AxCancellationToken token?token:null;
    return AxChatStream.lazy(() -> openStream(request,cancellation));
  }

  public AxChatStream openStream(Map<String, Object> request) throws Exception {
    return openStream(request,null);
  }

  public AxChatStream openStream(Map<String,Object> request,AxCancellationToken cancellation)throws Exception{
    if(cancellation!=null)cancellation.throwIfCancelled();
    AxAIService provider = selectedProvider(request);
    Map<String, Object> processedRequest = preprocess(provider.getFeatures((String)request.get("model")), request, processing);
    return provider.openStream(processedRequest,cancellation);
  }

  public Map<String, Object> embed(Map<String, Object> request, Map<String, Object> options) throws Exception {
    return selectedProvider(request).embed(request, options);
  }

  public Map<String, Object> transcribe(Map<String, Object> request, Map<String, Object> options) throws Exception {
    return selectedProvider(request).transcribe(request, options);
  }

  public Map<String, Object> speak(Map<String, Object> request, Map<String, Object> options) throws Exception {
    return selectedProvider(request).speak(request, options);
  }
}
