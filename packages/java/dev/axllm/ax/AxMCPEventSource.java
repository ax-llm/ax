package dev.axllm.ax;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;

/** MCP notifications enter AxEventRuntime through this composable source. */
public final class AxMCPEventSource implements AxEventSource {
  private final AxMCPClient client;private final String namespace,identityScope,trust;private final List<String> subscriptions;private Consumer<AxEventEnvelope> publish;private int listenerId,lifecycleListenerId;private int nextId=1;
  public AxMCPEventSource(AxMCPClient client,String namespace,String identityScope,String trust,List<String> subscriptions){this.client=client;this.namespace=namespace==null||namespace.isBlank()?client.namespace():namespace;this.identityScope=identityScope==null?"anonymous":identityScope;this.trust=trust==null?"untrusted":trust;this.subscriptions=List.copyOf(subscriptions==null?List.of():subscriptions);}
  public String identityScope(){return identityScope;}public String trust(){return trust;}
  public void start(Consumer<AxEventEnvelope> publish){client.init();this.publish=publish;listenerId=client.addNotificationListener(this::onNotification);lifecycleListenerId=client.addLifecycleListener(state->{if(state.equals("reconnected"))reconnect();});reconnect();}
  public void reconnect(){for(String uri:subscriptions)client.subscribeResource(uri);}
  @SuppressWarnings("unchecked") private void onNotification(Map<String,Object> message){if(publish==null||message.get("method")==null)return;Map<String,Object> normalized=AxEventRuntime.normalizeMCP(namespace,String.valueOf(message.get("method")),message.getOrDefault("params",Map.of()));Map<String,Object> data=Core.asMap(normalized.get("data"));List<Map<String,String>> correlation=new ArrayList<>();Map<String,Object> key=Core.asMap(normalized.get("correlation"));if(!key.isEmpty())correlation.add(Map.of("kind",String.valueOf(key.get("kind")),"value",String.valueOf(key.get("value"))));Object task=data.get("task");String subject=data.get("uri")!=null?String.valueOf(data.get("uri")):task instanceof Map<?,?> map&&map.get("taskId")!=null?String.valueOf(map.get("taskId")):null;publish.accept(new AxEventEnvelope("1.0","mcp:"+namespace+":"+(nextId++),String.valueOf(normalized.get("source")),String.valueOf(normalized.get("type")),subject,data,Map.of(),correlation));}
  public void close(){for(String uri:subscriptions)try{client.unsubscribeResource(uri);}catch(RuntimeException ignored){}if(listenerId>0)client.removeNotificationListener(listenerId);if(lifecycleListenerId>0)client.removeLifecycleListener(lifecycleListenerId);listenerId=0;lifecycleListenerId=0;publish=null;}
}
