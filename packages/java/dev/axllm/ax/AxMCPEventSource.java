package dev.axllm.ax;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.BiPredicate;
import java.util.function.Consumer;

/** MCP notifications enter AxEventRuntime through this composable source. */
public final class AxMCPEventSource implements AxEventSource {
  @FunctionalInterface public interface ResourceSubscriptionPolicy { List<String> select(AxMCPClient.CatalogSnapshot catalog);default boolean requested(){return true;} }
  private static final ResourceSubscriptionPolicy NONE=new ResourceSubscriptionPolicy(){public List<String> select(AxMCPClient.CatalogSnapshot catalog){return List.of();}public boolean requested(){return false;}};
  private static List<String> selected(List<Map<String,Object>> resources,String mode,List<String> explicit){return Core.asList(Core.mcp_resource_subscription_selection(resources,mode,explicit)).stream().map(String::valueOf).sorted().toList();}
  public static ResourceSubscriptionPolicy none(){return NONE;}
  public static ResourceSubscriptionPolicy all(){return catalog->selected(catalog.resources(),"all",List.of());}
  public static ResourceSubscriptionPolicy uris(String...uris){return catalog->selected(List.of(),"explicit",List.of(uris));}
  public static ResourceSubscriptionPolicy select(BiPredicate<Map<String,Object>,AxMCPClient.CatalogSnapshot> selector){return catalog->selected(catalog.resources().stream().filter(resource->selector.test(resource,catalog)).toList(),"selector",List.of());}

  private final AxMCPClient client;
  private final String namespace,identityScope,trust,owner="event-source:"+UUID.randomUUID();
  private final ResourceSubscriptionPolicy policy;
  private final List<String> subscriptions=new ArrayList<>();
  private final List<RuntimeException> errors=new ArrayList<>();
  private Consumer<AxEventEnvelope> publish;
  private int listenerId,lifecycleListenerId,nextId=1;

  /** Compatibility constructor: the list is treated as explicit resource URIs. */
  public AxMCPEventSource(AxMCPClient client,String namespace,String identityScope,String trust,List<String> subscriptions){this(client,namespace,identityScope,trust,subscriptions==null?none():catalog->subscriptions.stream().distinct().sorted().toList());}
  public AxMCPEventSource(AxMCPClient client,String namespace,String identityScope,String trust,ResourceSubscriptionPolicy policy){this.client=client;this.namespace=namespace==null||namespace.isBlank()?client.namespace():namespace;this.identityScope=identityScope==null?"anonymous":identityScope;this.trust=trust==null?"untrusted":trust;this.policy=policy==null?none():policy;}
  public String identityScope(){return identityScope;}public String trust(){return trust;}public List<RuntimeException> errors(){return List.copyOf(errors);}

  public void start(Consumer<AxEventEnvelope> publish){client.init();this.publish=publish;listenerId=client.addNotificationListener(this::onNotification);lifecycleListenerId=client.addLifecycleListener(state->{if(state.equals("reconnected"))reconcile();});reconcile();}
  public void reconnect(){client.restoreResourceSubscriptions();reconcile();}
  private void reconcile(){AxMCPClient.CatalogSnapshot catalog=client.inspectCatalog();List<String> desired;try{desired=new ArrayList<>(new LinkedHashSet<>(policy.select(catalog)));desired.sort(String::compareTo);}catch(RuntimeException error){errors.add(error);return;}if(policy.requested()){Map<String,Object> resources=Core.asMap(catalog.serverCapabilities().get("resources"));if(!Boolean.TRUE.equals(resources.get("subscribe")))throw new AxMCPError("MCP server "+catalog.namespace()+" does not advertise resource subscriptions");}Map<String,Object> plan=Core.asMap(Core.mcp_resource_subscription_plan(desired,subscriptions));for(Object value:Core.asList(plan.get("removals"))){String uri=String.valueOf(value);try{client.releaseResourceSubscription(uri,owner);subscriptions.remove(uri);}catch(RuntimeException error){errors.add(error);}}for(Object value:Core.asList(plan.get("additions"))){String uri=String.valueOf(value);try{client.acquireResourceSubscription(uri,owner);subscriptions.add(uri);subscriptions.sort(String::compareTo);}catch(RuntimeException error){errors.add(error);}}}
  @SuppressWarnings("unchecked") private void onNotification(Map<String,Object> message){if(publish==null||message.get("method")==null)return;String method=String.valueOf(message.get("method"));if(method.equals("notifications/resources/list_changed"))reconcile();Map<String,Object> normalized=AxEventRuntime.normalizeMCP(namespace,method,message.getOrDefault("params",Map.of()));Map<String,Object> data=Core.asMap(normalized.get("data"));List<Map<String,String>> correlation=new ArrayList<>();Map<String,Object> key=Core.asMap(normalized.get("correlation"));if(!key.isEmpty())correlation.add(Map.of("kind",String.valueOf(key.get("kind")),"value",String.valueOf(key.get("value"))));Object task=data.get("task");String subject=data.get("uri")!=null?String.valueOf(data.get("uri")):task instanceof Map<?,?> map&&map.get("taskId")!=null?String.valueOf(map.get("taskId")):null;publish.accept(new AxEventEnvelope("1.0","mcp:"+namespace+":"+(nextId++),String.valueOf(normalized.get("source")),String.valueOf(normalized.get("type")),subject,data,Map.of(),correlation));}
  public void close(){for(String uri:List.copyOf(subscriptions))try{client.releaseResourceSubscription(uri,owner);}catch(RuntimeException ignored){}subscriptions.clear();if(listenerId>0)client.removeNotificationListener(listenerId);if(lifecycleListenerId>0)client.removeLifecycleListener(lifecycleListenerId);listenerId=0;lifecycleListenerId=0;publish=null;}
}
