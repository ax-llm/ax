package dev.axllm.ax;

import java.net.URI;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Consumer;

public final class AxMCPClient {
  public static final String AX_MCP_PROTOCOL_VERSION = "2025-11-25";
  public static final List<String> AX_MCP_SUPPORTED_PROTOCOL_VERSIONS = List.of(
    "2026-07-28",
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
  private final Map<String,Map<String,Object>> catalogCache = new LinkedHashMap<>();
  private final Map<String,Map<String,Object>> resourceReadCache = new LinkedHashMap<>();
  private final Map<String,Set<String>> subscriptionOwners = new LinkedHashMap<>();
  private String activeSubscriptionId;
  private boolean subscriptionReady;
  private long catalogRevision;
  private Map<String, Object> serverCapabilities = new LinkedHashMap<>();
  private Map<String, Object> serverInfo = new LinkedHashMap<>();
  private String serverInstructions;
  private String negotiatedProtocolVersion;
  private String era;
  private Map<String,Object> discoverResult = new LinkedHashMap<>();
  private Map<String,Object> negotiatedExtensions = new LinkedHashMap<>();
  private static final Map<String,String> ERA_CACHE = new LinkedHashMap<>();
  private int nextId = 1;
  private int nextListenerId = 1;
  private final Map<Integer,Consumer<Map<String,Object>>> notificationListeners = new LinkedHashMap<>();
  private final Map<Integer,Consumer<String>> lifecycleListeners = new LinkedHashMap<>();
  private boolean initialized;

  public AxMCPClient(AxMCPTransport transport) {
    this(transport, Map.of());
  }

  public AxMCPClient(AxMCPTransport transport, Map<String, Object> options) {
    this.transport = transport;
    this.options = options == null ? Map.of() : new LinkedHashMap<>(options);
    this.transport.setMessageHandler(this::handleInboundMessage);
    this.transport.setLifecycleHandler(this::emitLifecycle);
  }

  public synchronized void init() {
    if (initialized) return;
    transport.connect();
    String configured=String.valueOf(options.getOrDefault("era","auto"));String key=transport.eraCacheKey();String cached=key==null?null:ERA_CACHE.get(key);String stored=null;Object rawStore=options.get("eraStore");if(rawStore instanceof Map<?,?> map&&key!=null)stored=String.valueOf(map.get(key));Map<String,Object> resolution=Core.asMap(Core.mcp_resolve_known_era(configured,transport.eraHint(),cached,stored));String resolved=String.valueOf(resolution.getOrDefault("era","modern"));
    if(!Boolean.TRUE.equals(resolution.get("probe"))){if("legacy".equals(resolved))initializeLegacy();else{applyEra("modern");applyDiscovery(requestDiscovery());refresh();}rememberEra(resolved);initialized=true;if("legacy".equals(resolved))transport.startListening();return;}
    applyEra("modern");try{applyDiscovery(requestDiscovery());}catch(AxMCPError error){if(error.code==-32022)throw error;initializeLegacy();rememberEra("legacy");initialized=true;transport.startListening();return;}catch(RuntimeException error){initializeLegacy();rememberEra("legacy");initialized=true;transport.startListening();return;}rememberEra("modern");refresh();initialized=true;
  }

  private void initializeLegacy(){
    applyEra("legacy");
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
    negotiateExtensions();
    notify("notifications/initialized", null);
    refresh();
  }

  private void applyEra(String value){era=value;transport.setEra(value);if("modern".equals(value)){negotiatedProtocolVersion="2026-07-28";transport.setProtocolVersion(negotiatedProtocolVersion);}else negotiatedProtocolVersion=null;}
  @SuppressWarnings("unchecked") private void rememberEra(String value){String key=transport.eraCacheKey();if(key==null||key.isBlank())return;ERA_CACHE.put(key,value);Object store=options.get("eraStore");if(store instanceof Map<?,?> map)((Map<String,Object>)map).put(key,value);}
  private Map<String,Object> requestDiscovery(){return request("server/discover",Map.of());}
  private void applyDiscovery(Map<String,Object> result){Map<String,Object> classified=Core.asMap(Core.mcp_classify_discovery_result(result));if(!Boolean.TRUE.equals(classified.get("valid")))throw new AxMCPError("Invalid MCP server/discover result");discoverResult=cloneMap(result);serverCapabilities=cloneMap(Core.asMap(classified.get("capabilities")));if(result.get("instructions")!=null)serverInstructions=String.valueOf(result.get("instructions"));Map<String,Object> info=Core.asMap(classified.get("serverInfo"));if(!info.isEmpty())serverInfo=cloneMap(info);negotiateExtensions();}
  private void negotiateExtensions(){negotiatedExtensions=Core.asMap(Core.mcp_negotiate_extensions(Core.asMap(clientCapabilities().get("extensions")),Core.asMap(serverCapabilities.get("extensions"))));}
  public String getEra(){return era;}
  public Map<String,Object> discover(){init();if(!"modern".equals(era))throw new AxMCPError("server/discover is only available for modern MCP");Map<String,Object> result=requestDiscovery();applyDiscovery(result);return cloneMap(result);}

  public synchronized void close() { initialized = false;activeSubscriptionId=null;transport.closeRequestStream();subscriptionOwners.clear();catalogCache.clear();resourceReadCache.clear();transport.close(); }

  public void refresh() { refresh(true); }
  public void refresh(boolean force) {
    boolean changed=false;
    if (capability("tools")&&(force||!catalogCacheFresh("tools"))){tools.clear();for(Map<String,Object> tool:collectCatalog("tools/list","tools")){try{Core.mcp_param_header_bindings(tool.getOrDefault("inputSchema",Map.of()));tools.add(tool);}catch(RuntimeException ignored){}}changed=true;}
    if (capability("prompts")&&(force||!catalogCacheFresh("prompts"))){prompts.clear();prompts.addAll(collectCatalog("prompts/list","prompts"));changed=true;}
    if (capability("resources")) {
      if(force||!catalogCacheFresh("resources")){resources.clear();resources.addAll(collectCatalog("resources/list","resources"));changed=true;}
      if(force||!catalogCacheFresh("resourceTemplates")){resourceTemplates.clear();resourceTemplates.addAll(collectCatalog("resources/templates/list","resourceTemplates"));changed=true;}
    }
    if(changed)catalogRevision++;
  }

  private List<Map<String,Object>> collectCatalog(String method,String field){List<Map<String,Object>> out=new ArrayList<>();List<Map<String,Object>> pages=new ArrayList<>();String cursor=null;Set<String> seen=new LinkedHashSet<>();int max=((Number)options.getOrDefault("maxPaginationPages",1000)).intValue();for(int page=0;page<max;page++){Map<String,Object> result=request(method,cursor==null?Map.of():Map.of("cursor",cursor));pages.add(cloneMap(result));for(Object item:Core.asList(result.get(field)))out.add(cloneMap(Core.asMap(item)));Object next=result.get("nextCursor");if(next==null||String.valueOf(next).isBlank()){String name=Map.of("tools/list","tools","prompts/list","prompts","resources/list","resources","resources/templates/list","resourceTemplates").get(method);if(name!=null)catalogCache.put(name,Core.asMap(Core.mcp_fold_cache_info(pages,System.currentTimeMillis())));return out;}cursor=String.valueOf(next);if(!seen.add(cursor))throw new AxMCPError("MCP "+method+" repeated pagination cursor "+cursor);}throw new AxMCPError("MCP "+method+" exceeded "+max+" pagination pages");}
  private boolean catalogCacheFresh(String name){return Boolean.TRUE.equals(Core.mcp_cache_freshness(catalogCache.get(name),System.currentTimeMillis()));}

  public record CatalogSnapshot(String namespace,String protocolVersion,long revision,Map<String,Object> serverInfo,Map<String,Object> serverCapabilities,List<Map<String,Object>> tools,List<Map<String,Object>> prompts,List<Map<String,Object>> resources,List<Map<String,Object>> resourceTemplates,List<String> subscriptions){}
  public synchronized CatalogSnapshot inspectCatalog(boolean refresh){init();if(refresh)refresh();List<String> subscriptions=new ArrayList<>(subscriptionOwners.keySet());subscriptions.sort(String::compareTo);return new CatalogSnapshot(namespace(),negotiatedProtocolVersion,catalogRevision,cloneMap(serverInfo),cloneMap(serverCapabilities),cloneList(tools),cloneList(prompts),cloneList(resources),cloneList(resourceTemplates),List.copyOf(subscriptions));}
  public CatalogSnapshot inspectCatalog(){return inspectCatalog(false);}
  private static List<Map<String,Object>> cloneList(List<Map<String,Object>> values){List<Map<String,Object>> out=new ArrayList<>();for(Map<String,Object> value:values)out.add(cloneMap(value));return List.copyOf(out);}
  private static Map<String,Object> cloneMap(Map<String,Object> value){Map<String,Object> out=new LinkedHashMap<>();for(Map.Entry<String,Object> entry:value.entrySet())out.put(entry.getKey(),cloneValue(entry.getValue()));return out;}
  private static Object cloneValue(Object value){if(value instanceof Map<?,?> map){Map<String,Object> out=new LinkedHashMap<>();for(Map.Entry<?,?> entry:map.entrySet())out.put(String.valueOf(entry.getKey()),cloneValue(entry.getValue()));return out;}if(value instanceof List<?> list){List<Object> out=new ArrayList<>();for(Object item:list)out.add(cloneValue(item));return out;}return value;}

  public String getProtocolVersion() { return negotiatedProtocolVersion; }
  public Map<String, Object> getServerCapabilities() { return serverCapabilities; }
  public Map<String, Object> getServerInfo() { return serverInfo; }
  public String getServerInstructions() { return serverInstructions; }
  public List<Map<String, Object>> getTools() { return List.copyOf(tools); }

  public Map<String, Object> ping() { return request("ping", Map.of()); }
  public Map<String, Object> listTools(String cursor) { return request("tools/list", cursor == null ? Map.of() : Map.of("cursor", cursor)); }
  public Map<String, Object> callTool(String name, Map<String, Object> arguments) {Map<String,Object> args=arguments==null?Map.of():arguments;Map<String,String> headers=toolHeaders(name,args);Map<String,Object> result;try{result=requestWithInputRounds("tools/call",Map.of("name",name,"arguments",args),headers);}catch(AxMCPError error){if(!"modern".equals(era)||error.code!=-32020)throw error;tools.clear();for(Map<String,Object> tool:collectCatalog("tools/list","tools")){try{Core.mcp_param_header_bindings(tool.getOrDefault("inputSchema",Map.of()));tools.add(tool);}catch(RuntimeException ignored){}}result=requestWithInputRounds("tools/call",Map.of("name",name,"arguments",args),toolHeaders(name,args));}if(!"task".equals(String.valueOf(result.get("resultType"))))return result;if(!hasTasksCapability())throw new AxMCPError("MCP protocol violation: server returned a task without negotiating io.modelcontextprotocol/tasks");if(!Boolean.TRUE.equals(Core.mcp_validate_modern_task(result)))throw new AxMCPError("MCP protocol violation: invalid CreateTaskResult");return awaitModernTask(String.valueOf(result.get("taskId")));}
  private Map<String,Object> awaitModernTask(String taskId){int max=((Number)options.getOrDefault("maxTaskPolls",1000)).intValue();for(int poll=0;poll<max;poll++){Map<String,Object> outcome=Core.asMap(Core.mcp_task_terminal_outcome(getTask(taskId)));String kind=String.valueOf(outcome.get("kind"));if("result".equals(kind))return cloneMap(Core.asMap(outcome.get("result")));if("protocol_error".equals(kind))throw new AxMCPError(String.valueOf(outcome.get("message")),((Number)outcome.getOrDefault("code",0)).intValue(),outcome.get("data"));if(List.of("violation","failure","cancelled").contains(kind))throw new AxMCPError(String.valueOf(outcome.get("message")));}throw new AxMCPError("MCP task "+taskId+" exceeded "+max+" polls");}
  private Map<String,String> toolHeaders(String name,Map<String,Object> args){Map<String,String> out=new LinkedHashMap<>();if(!"modern".equals(era))return out;for(Map<String,Object> tool:tools)if(name.equals(String.valueOf(tool.get("name")))){Object bindings=Core.mcp_param_header_bindings(tool.getOrDefault("inputSchema",Map.of()));for(Map.Entry<String,Object> entry:Core.asMap(Core.mcp_param_header_values(bindings,args)).entrySet())out.put(entry.getKey(),String.valueOf(entry.getValue()));break;}return out;}
  public Map<String, Object> listPrompts(String cursor) { return request("prompts/list", cursor == null ? Map.of() : Map.of("cursor", cursor)); }
  public Map<String, Object> getPrompt(String name, Map<String, Object> arguments) { return requestWithInputRounds("prompts/get", Map.of("name", name, "arguments", arguments == null ? Map.of() : arguments),Map.of()); }
  public Map<String, Object> listResources(String cursor) { return request("resources/list", cursor == null ? Map.of() : Map.of("cursor", cursor)); }
  public Map<String, Object> readResource(String uri) {if("modern".equals(era)&&Boolean.TRUE.equals(options.get("readCache"))){Map<String,Object> cached=resourceReadCache.get(uri);if(cached!=null&&Boolean.TRUE.equals(Core.mcp_cache_freshness(cached.get("cache"),System.currentTimeMillis())))return cloneMap(Core.asMap(cached.get("result")));resourceReadCache.remove(uri);}Map<String,Object> result=requestWithInputRounds("resources/read",Map.of("uri",uri),Map.of());if("modern".equals(era)&&Boolean.TRUE.equals(options.get("readCache"))){Map<String,Object> cache=Core.asMap(Core.mcp_fold_cache_info(List.of(result),System.currentTimeMillis()));if(Boolean.TRUE.equals(Core.mcp_cache_freshness(cache,System.currentTimeMillis())))resourceReadCache.put(uri,new LinkedHashMap<>(Map.of("result",cloneMap(result),"cache",cache)));}return result;}
  private void assertResourceSubscriptions(){Map<String,Object> resourceCapability=Core.asMap(serverCapabilities.get("resources"));if(!Boolean.TRUE.equals(resourceCapability.get("subscribe")))throw new AxMCPError("Resource subscriptions are not supported");}
  public synchronized Map<String,Object> acquireResourceSubscription(String uri,String owner){assertResourceSubscriptions();List<String> current=new ArrayList<>(subscriptionOwners.getOrDefault(uri,Set.of()));current.sort(String::compareTo);Map<String,Object> transition=Core.asMap(Core.mcp_resource_subscription_ownership(current,owner,"acquire"));subscriptionOwners.put(uri,new LinkedHashSet<>(Core.asList(transition.get("owners")).stream().map(String::valueOf).toList()));if("modern".equals(era)){if(Boolean.TRUE.equals(transition.get("changed"))&&activeSubscriptionId!=null)restartModernListener();return Map.of();}return "subscribe".equals(transition.get("wireAction"))?request("resources/subscribe",Map.of("uri",uri)):Map.of();}
  public synchronized Map<String,Object> releaseResourceSubscription(String uri,String owner){assertResourceSubscriptions();List<String> current=new ArrayList<>(subscriptionOwners.getOrDefault(uri,Set.of()));current.sort(String::compareTo);Map<String,Object> transition=Core.asMap(Core.mcp_resource_subscription_ownership(current,owner,"release"));Set<String> remaining=new LinkedHashSet<>(Core.asList(transition.get("owners")).stream().map(String::valueOf).toList());if(remaining.isEmpty())subscriptionOwners.remove(uri);else subscriptionOwners.put(uri,remaining);if("modern".equals(era)){if(Boolean.TRUE.equals(transition.get("changed"))&&activeSubscriptionId!=null)restartModernListener();return Map.of();}return "unsubscribe".equals(transition.get("wireAction"))?request("resources/unsubscribe",Map.of("uri",uri)):Map.of();}
  public synchronized void restoreResourceSubscriptions(){if("modern".equals(era)){if(activeSubscriptionId!=null)restartModernListener();return;}List<String> uris=new ArrayList<>(subscriptionOwners.keySet());uris.sort(String::compareTo);for(String uri:uris)request("resources/subscribe",Map.of("uri",uri));}
  public synchronized void startListening(){init();if(!"modern".equals(era)){transport.startListening();return;}transport.closeRequestStream();String id=UUID.randomUUID().toString();activeSubscriptionId=id;subscriptionReady=false;List<String> uris=new ArrayList<>(subscriptionOwners.keySet());uris.sort(String::compareTo);Map<String,Object> params=new LinkedHashMap<>();params.put("notifications",Core.mcp_listen_interests(uris,options.getOrDefault("subscriptionFilters",Map.of())));params.put("_meta",Core.mcp_build_request_meta(Map.of(),negotiatedProtocolVersion,clientCapabilities(),Map.of("name","AxMCPClient","title","Ax MCP Client","version","1.0.0"),options.get("logLevel"),null,null));transport.openRequestStream(new LinkedHashMap<>(Map.of("jsonrpc","2.0","id",id,"method","subscriptions/listen","params",params)));long timeout=((Number)options.getOrDefault("listenAckTimeoutMs",2000)).longValue();long deadline=System.currentTimeMillis()+timeout;while(!subscriptionReady){long remaining=deadline-System.currentTimeMillis();if(remaining<=0)throw new AxMCPError("subscriptions/listen acknowledgement timed out");try{wait(remaining);}catch(InterruptedException error){Thread.currentThread().interrupt();throw new AxMCPError("subscriptions/listen acknowledgement interrupted");}}}
  private synchronized void restartModernListener(){if("modern".equals(era)&&activeSubscriptionId!=null)startListening();}
  public Map<String,Object> subscribeResource(String uri){return acquireResourceSubscription(uri,"manual");}
  public Map<String,Object> unsubscribeResource(String uri){return releaseResourceSubscription(uri,"manual");}
  private boolean hasTasksCapability(){return "modern".equals(era)?negotiatedExtensions.containsKey("io.modelcontextprotocol/tasks"):capability("tasks");}
  public Map<String,Object> getTask(String taskId){if(!hasTasksCapability())throw new AxMCPError("Tasks are not supported");Map<String,Object> result=request("tasks/get",Map.of("taskId",taskId));if("modern".equals(era)&&!Boolean.TRUE.equals(Core.mcp_validate_modern_task(result)))throw new AxMCPError("MCP protocol violation: invalid tasks/get result");return result;}
  public Map<String,Object> cancelTask(String taskId){if(!hasTasksCapability())throw new AxMCPError("Tasks are not supported");Map<String,Object> result=request("tasks/cancel",Map.of("taskId",taskId));return "modern".equals(era)?Map.of():result;}
  public Map<String,Object> listTasks(String cursor){if("modern".equals(era))throw new AxMCPError("tasks/list is only available for legacy MCP tasks");if(!hasTasksCapability())throw new AxMCPError("Tasks are not supported");return request("tasks/list",cursor==null||cursor.isBlank()?Map.of():Map.of("cursor",cursor));}
  public Map<String,Object> getTaskResult(String taskId){if("modern".equals(era))throw new AxMCPError("tasks/result is only available for legacy MCP tasks; modern results are embedded in tasks/get");if(!hasTasksCapability())throw new AxMCPError("Tasks are not supported");return request("tasks/result",Map.of("taskId",taskId));}
  public void provideTaskInput(String taskId,Map<String,Object> inputResponses){if(!"modern".equals(era)||!hasTasksCapability())throw new AxMCPError("tasks/update is only available for modern MCP Tasks v2");request("tasks/update",Map.of("taskId",taskId,"inputResponses",inputResponses==null?Map.of():inputResponses));}
  public Map<String, Object> listResourceTemplates(String cursor) { return request("resources/templates/list", cursor == null ? Map.of() : Map.of("cursor", cursor)); }

  public void cancelRequest(Object requestId, String reason) {
    Map<String, Object> params = new LinkedHashMap<>();
    params.put("requestId", requestId);
    if (reason != null) params.put("reason", reason);
    notify("notifications/cancelled", params);
  }
  public int addNotificationListener(Consumer<Map<String,Object>> listener){int id=nextListenerId++;notificationListeners.put(id,listener);return id;}
  public void removeNotificationListener(int id){notificationListeners.remove(id);}
  public int addLifecycleListener(Consumer<String> listener){int id=nextListenerId++;lifecycleListeners.put(id,listener);return id;}
  public void removeLifecycleListener(int id){lifecycleListeners.remove(id);}
  public void emitLifecycle(String state){if("modern".equals(era)&&state.equals("disconnected")&&activeSubscriptionId!=null)new Thread(this::restartModernListener,"ax-mcp-listen-restart").start();else if(state.equals("reconnected"))restoreResourceSubscriptions();for(Consumer<String> listener:List.copyOf(lifecycleListeners.values()))listener.accept(state);}

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
    return requestWithHeaders(method,params,Map.of(),true);
  }

  private Map<String,Object> requestWithInputRounds(String method,Map<String,Object> baseParams,Map<String,String> headers){Map<String,Object> params=cloneMap(baseParams);Object maxRounds=options.get("maxInputRounds");for(int round=0;;round++){Map<String,Object> result=requestWithHeaders(method,params,headers,true);Map<String,Object> plan=Core.asMap(Core.mcp_mrtr_plan_round(result,era==null?"legacy":era,method,round,maxRounds));String action=String.valueOf(plan.get("action"));if("complete".equals(action))return result;if("violation".equals(action))throw new AxMCPError(String.valueOf(plan.get("message")));Object inputResponses=null;if(Boolean.TRUE.equals(plan.get("hasInputRequests"))&&plan.get("inputRequests") instanceof Map<?,?>){Object roots=options.containsKey("roots")?options.get("roots"):null;Map<String,Object> fulfillment=Core.asMap(Core.mcp_mrtr_fulfill_roots(plan.get("inputRequests"),roots));if(!Boolean.TRUE.equals(fulfillment.get("ok")))throw new AxMCPError(String.valueOf(fulfillment.get("message")));inputResponses=fulfillment.get("responses");}Object requestState=Boolean.TRUE.equals(plan.get("hasRequestState"))?plan.get("requestState"):null;params=Core.asMap(Core.mcp_mrtr_next_params(baseParams,inputResponses,requestState));}}

  private Map<String,Object> requestWithHeaders(String method,Map<String,Object> params,Map<String,String> headers,boolean allowVersionRetry){
    Map<String, Object> message = new LinkedHashMap<>();
    message.put("jsonrpc", "2.0");
    message.put("id", String.valueOf(nextId++));
    message.put("method", method);
    Map<String,Object> requestParams=new LinkedHashMap<>(params==null?Map.of():params);if("modern".equals(era)){Map<String,Object> info=new LinkedHashMap<>(Map.of("name","AxMCPClient","title","Ax MCP Client","version","1.0.0"));info.putAll(Core.asMap(options.get("clientInfo")));requestParams.put("_meta",Core.mcp_build_request_meta(Core.asMap(requestParams.get("_meta")),negotiatedProtocolVersion,clientCapabilities(),info,options.get("logLevel"),null,null));}
    if (params != null) message.put("params", requestParams);
    Map<String, Object> response = transport.sendWithHeaders(message,headers);
    if (response.containsKey("error")) {
      Map<String, Object> error = Core.asMap(response.get("error"));
      int code=error.get("code") instanceof Number number?number.intValue():0;AxMCPError protocol=new AxMCPError(String.valueOf(error.getOrDefault("message","MCP JSON-RPC error")),code,error.get("data"));if("modern".equals(era)&&allowVersionRetry&&code==-32022){String version=String.valueOf(Core.mcp_select_mutual_version(error.get("data"),AX_MCP_SUPPORTED_PROTOCOL_VERSIONS));if(!version.isBlank()){negotiatedProtocolVersion=version;transport.setProtocolVersion(version);return requestWithHeaders(method,params,headers,false);}}throw protocol;
    }
    Map<String,Object> result=Core.asMap(response.getOrDefault("result",Map.of()));if("modern".equals(era)){Map<String,Object> info=Core.asMap(Core.asMap(result.get("_meta")).get("io.modelcontextprotocol/serverInfo"));if(info.get("name") instanceof String&&info.get("version") instanceof String)serverInfo=cloneMap(info);}return result;
  }

  void notify(String method, Map<String, Object> params) {
    if("modern".equals(era)&&(method.equals("notifications/initialized")||method.equals("notifications/roots/list_changed")||method.equals("notifications/cancelled")))return;
    Map<String, Object> message = new LinkedHashMap<>();
    message.put("jsonrpc", "2.0");
    message.put("method", method);
    if (params != null) message.put("params", params);
    transport.sendNotification(message);
  }

  private Map<String, Object> clientCapabilities() {
    Map<String, Object> capabilities = new LinkedHashMap<>(Core.asMap(options.get("capabilities")));
    Map<String,Object> derived=Core.asMap(Core.mcp_client_capabilities(options.containsKey("roots"),options.containsKey("sampling"),options.containsKey("elicitation"),era==null?"legacy":era,!Boolean.FALSE.equals(options.get("tasksExtension"))));for(Map.Entry<String,Object> entry:derived.entrySet())capabilities.putIfAbsent(entry.getKey(),entry.getValue());
    return capabilities;
  }

  private boolean capability(String name) {
    Object value = serverCapabilities.get(name);
    return value != null && !Boolean.FALSE.equals(value);
  }

  private void handleInboundMessage(Map<String, Object> message) {
    if("modern".equals(era)){Map<String,Object> filtered=Core.asMap(Core.mcp_notification_subscription_filter(message,activeSubscriptionId));if(!Boolean.TRUE.equals(filtered.get("deliver")))return;message=Core.asMap(filtered.get("message"));if(Boolean.TRUE.equals(filtered.get("acknowledged")))synchronized(this){subscriptionReady=true;notifyAll();}}
    if ("roots/list".equals(message.get("method")) && message.containsKey("id")) {
      Map<String, Object> response = new LinkedHashMap<>();
      response.put("jsonrpc", "2.0");
      response.put("id", message.get("id"));
      response.put("result", Map.of("roots", options.getOrDefault("roots", List.of())));
      transport.sendResponse(response);
      return;
    }
    Object method=message.get("method");
    if("notifications/tools/list_changed".equals(method)||"notifications/prompts/list_changed".equals(method)||"notifications/resources/list_changed".equals(method))refresh();
    if("notifications/resources/updated".equals(method)){Object uri=Core.asMap(message.get("params")).get("uri");if(uri!=null)resourceReadCache.remove(String.valueOf(uri));}
    Object callback = options.get("onNotification");
    if (callback instanceof Consumer<?> raw) {
      @SuppressWarnings("unchecked")
      Consumer<Map<String, Object>> consumer = (Consumer<Map<String, Object>>) raw;
      consumer.accept(message);
    }
    for(Consumer<Map<String,Object>> listener:List.copyOf(notificationListeners.values()))listener.accept(message);
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
      if ("oauth_issuer".equals(operation)) {
        for (Object raw : Core.asList(fixture.get("cases"))) {
          Map<String, Object> testCase = Core.asMap(raw);
          Object actual = Core.mcp_oauth_validate_issuer(testCase.getOrDefault("response", Map.of()), testCase.getOrDefault("expected_issuer", ""), testCase.getOrDefault("require_iss", false));
          assertSubset(actual, testCase.getOrDefault("expected", Map.of()), "OAuth issuer validation");
        }
        String endpoint = String.valueOf(fixture.getOrDefault("endpoint", "https://auth.example"));
        AxMCPOAuthOptions oauth = new AxMCPOAuthOptions();
        oauth.requireIss = true;
        oauth.onAuthCode = url -> {
          String state = "";
          for (String part : URI.create(url).getQuery().split("&")) if (part.startsWith("state=")) state = part.substring("state=".length());
          return Map.of("code", "abc", "state", state, "iss", endpoint);
        };
        AxMCPStreamableHTTPTransport transport = new AxMCPStreamableHTTPTransport(endpoint, Map.of("oauth", oauth));
        if (!transport.applyOAuth()) throw new AssertionError("OAuth issuer-validating stub did not produce a token");
        if (!String.valueOf(fixture.get("stub_expected_authorization")).equals(transport.headers().get("Authorization"))) throw new AssertionError("OAuth issuer-validating stub did not set Authorization");
        return;
      }
      if ("oauth".equals(operation)) {
        String challenge = pkceChallenge(String.valueOf(fixture.getOrDefault("verifier", "test-verifier")));
        if (fixture.get("expected_challenge") != null && !challenge.equals(fixture.get("expected_challenge"))) throw new AssertionError("PKCE challenge mismatch");
        MapTokenStore store = new MapTokenStore();
        AxMCPOAuthOptions oauth = new AxMCPOAuthOptions();
        oauth.tokenStore = store;
        oauth.onAuthCode = url -> {
          String state = "";
          for (String part : URI.create(url).getQuery().split("&")) if (part.startsWith("state=")) state = part.substring("state=".length());
          return Map.of("code", "abc", "state", state);
        };
        AxMCPStreamableHTTPTransport transport = new AxMCPStreamableHTTPTransport(String.valueOf(fixture.getOrDefault("endpoint", "https://example.com/mcp")), Map.of("oauth", oauth));
        if (!transport.applyOAuth()) throw new AssertionError("OAuth flow did not produce a token");
        if (!transport.headers().containsKey("Authorization")) throw new AssertionError("OAuth flow did not set Authorization");
        return;
      }
      if ("discover".equals(operation)) {
        Map<String, Object> constants = Core.asMap(Core.mcp_protocol_constants());
        String version = String.valueOf(fixture.getOrDefault("protocol_version", "2026-07-28"));
        if (!Core.asList(constants.get("supportedProtocolVersions")).stream().map(String::valueOf).toList().contains(version)) throw new AssertionError("missing supported MCP protocol version " + version);
        Object request = Core.mcp_jsonrpc_request(fixture.getOrDefault("request_id", "discover-1"), "server/discover", fixture.getOrDefault("params", Map.of()));
        assertSubset(request, fixture.getOrDefault("expected_request", Map.of()), "discover request");
        return;
      }
      if ("modern_headers".equals(operation)) {
        Map<String, Object> headers = Core.asMap(Core.mcp_modern_request_headers(fixture.getOrDefault("method", "server/discover"), fixture.get("resource_name"), fixture.get("protocol_version")));
        assertSubset(headers, fixture.getOrDefault("expected_headers", Map.of()), "modern headers");
        for (Object key : Core.asList(fixture.get("forbidden_headers"))) if (headers.containsKey(String.valueOf(key))) throw new AssertionError("modern headers contain forbidden " + key);
        return;
      }
      if ("era_classification".equals(operation)) {
        Object classification = Core.mcp_classify_discovery_result(fixture.get("discovery_result"));
        assertSubset(classification, fixture.getOrDefault("expected_classification", Map.of()), "discovery classification");
        for (Object invalid : Core.asList(fixture.get("invalid_discovery_results"))) {
          if (Core.truthy(Core.asMap(Core.mcp_classify_discovery_result(invalid)).get("valid"))) throw new AssertionError("invalid discovery result classified as valid");
        }
        for (Object raw : Core.asList(fixture.get("era_cases"))) {
          Map<String, Object> c = Core.asMap(raw);
          Object actual = Core.mcp_resolve_known_era(c.getOrDefault("configured", "auto"), c.get("hint"), c.get("cached"), c.get("stored"));
          assertSubset(actual, c.getOrDefault("expected", Map.of()), "era resolution");
        }
        Map<String, Object> capabilityCase = Core.asMap(fixture.get("capability_case"));
        Object capabilities = Core.mcp_client_capabilities(
          capabilityCase.getOrDefault("has_roots", false), capabilityCase.getOrDefault("has_sampling", false),
          capabilityCase.getOrDefault("has_elicitation", false), capabilityCase.getOrDefault("era", "legacy"),
          capabilityCase.getOrDefault("tasks_extension", false));
        assertSubset(capabilities, capabilityCase.getOrDefault("expected", Map.of()), "client capabilities");
        for (Object raw : Core.asList(fixture.get("request_name_cases"))) {
          Map<String, Object> c = Core.asMap(raw);
          String actual = String.valueOf(Core.mcp_request_name(c.getOrDefault("method", ""), c.getOrDefault("params", Map.of())));
          if (!actual.equals(String.valueOf(c.getOrDefault("expected", "")))) throw new AssertionError("request name mismatch");
        }
        return;
      }
      if ("mutual_version".equals(operation)) {
        for (Object raw : Core.asList(fixture.get("cases"))) {
          Map<String, Object> c = Core.asMap(raw);
          String actual = String.valueOf(Core.mcp_select_mutual_version(c.get("error_data"), c.getOrDefault("client_versions", List.of())));
          if (!actual.equals(String.valueOf(c.getOrDefault("expected_version", "")))) throw new AssertionError("mutual version mismatch");
        }
        return;
      }
      if ("request_meta".equals(operation)) {
        Object actual = Core.mcp_build_request_meta(fixture.get("existing"), fixture.getOrDefault("protocol_version", "2026-07-28"), fixture.getOrDefault("client_capabilities", Map.of()), fixture.getOrDefault("client_info", Map.of()), fixture.get("log_level"), fixture.get("traceparent"), fixture.get("tracestate"));
        assertSubset(actual, fixture.getOrDefault("expected_meta", Map.of()), "request meta");
        return;
      }
      if ("extension_negotiation".equals(operation)) {
        Object actual = Core.mcp_negotiate_extensions(fixture.getOrDefault("client_extensions", Map.of()), fixture.getOrDefault("server_extensions", Map.of()));
        if (!actual.equals(fixture.getOrDefault("expected_extensions", Map.of()))) throw new AssertionError("extension negotiation mismatch: " + actual);
        return;
      }
      if ("param_headers".equals(operation)) {
        Object bindings = Core.mcp_param_header_bindings(fixture.getOrDefault("input_schema", Map.of()));
        if (!bindings.equals(fixture.getOrDefault("expected_bindings", List.of()))) throw new AssertionError("parameter header bindings mismatch: " + bindings);
        Object values = Core.mcp_param_header_values(bindings, fixture.getOrDefault("arguments", Map.of()));
        if (!values.equals(fixture.getOrDefault("expected_values", Map.of()))) throw new AssertionError("parameter header values mismatch: " + values);
        for (Object raw : Core.asList(fixture.get("invalid_schemas"))) {
          Map<String, Object> c = Core.asMap(raw);
          try {
            Core.mcp_param_header_bindings(c.getOrDefault("schema", Map.of()));
            throw new AssertionError("invalid parameter header schema was accepted");
          } catch (RuntimeException error) {
            if (error.getMessage() == null || !error.getMessage().contains(String.valueOf(c.getOrDefault("expected_error_contains", "")))) throw error;
          }
        }
        for (Object raw : Core.asList(fixture.get("invalid_values"))) {
          Map<String, Object> c = Core.asMap(raw);
          try {
            Core.mcp_param_header_values(bindings, c.getOrDefault("arguments", Map.of()));
            throw new AssertionError("invalid parameter header value was accepted");
          } catch (RuntimeException error) {
            if (error.getMessage() == null || !error.getMessage().contains(String.valueOf(c.getOrDefault("expected_error_contains", "")))) throw error;
          }
        }
        return;
      }
      if ("header_value".equals(operation)) {
        for (Object raw : Core.asList(fixture.get("cases"))) {
          Map<String, Object> c = Core.asMap(raw);
          Object actual = Core.mcp_header_value_plan(c.getOrDefault("value", ""));
          if (!actual.equals(c.getOrDefault("expected_plan", Map.of()))) throw new AssertionError("header value plan mismatch: " + actual);
        }
        return;
      }
      if ("cache_fold".equals(operation)) {
        for(Object raw:Core.asList(fixture.get("cases"))){Map<String,Object> c=Core.asMap(raw);Map<String,Object> actual=Core.asMap(Core.mcp_fold_cache_info(c.getOrDefault("pages",List.of()),c.getOrDefault("fetched_at",0)));assertSubset(actual,c.getOrDefault("expected",Map.of()),"cache info");for(Object field:Core.asList(c.get("forbidden_fields")))if(actual.containsKey(String.valueOf(field)))throw new AssertionError("cache info contains forbidden field "+field);boolean fresh=Boolean.TRUE.equals(Core.mcp_cache_freshness(actual,c.getOrDefault("now",0)));if(fresh!=Boolean.TRUE.equals(c.get("expected_fresh")))throw new AssertionError("cache freshness mismatch");}
        return;
      }
      if("tasks_v2_violations".equals(operation)){for(Object raw:Core.asList(fixture.get("validation_cases"))){Map<String,Object> c=Core.asMap(raw);boolean actual=Boolean.TRUE.equals(Core.mcp_validate_modern_task(c.get("task")));if(actual!=Boolean.TRUE.equals(c.get("expected_valid")))throw new AssertionError("modern task validation mismatch");}for(Object raw:Core.asList(fixture.get("terminal_cases"))){Map<String,Object> c=Core.asMap(raw);assertSubset(Core.mcp_task_terminal_outcome(c.get("task")),c.getOrDefault("expected",Map.of()),"task terminal outcome");}for(Object raw:Core.asList(fixture.get("scenarios"))){Map<String,Object> scenario=Core.asMap(raw);AxMCPScriptedTransport transport=new AxMCPScriptedTransport(Core.asList(scenario.get("responses")));AxMCPClient client=new AxMCPClient(transport,Core.asMap(scenario.get("client_options")));client.init();try{client.callTool("slow",Map.of());throw new AssertionError("expected Tasks v2 protocol violation");}catch(AxMCPError error){if(!error.getMessage().contains(String.valueOf(scenario.get("expected_error"))))throw error;}}return;}
      if("mrtr_violations".equals(operation)){for(Object raw:Core.asList(fixture.get("plan_cases"))){Map<String,Object> c=Core.asMap(raw);Object actual=Core.mcp_mrtr_plan_round(c.getOrDefault("result",Map.of()),c.getOrDefault("era","legacy"),c.getOrDefault("method","tools/call"),c.getOrDefault("round",0),c.get("max_rounds"));assertSubset(actual,c.getOrDefault("expected",Map.of()),"MRTR round plan");}for(Object raw:Core.asList(fixture.get("fulfill_cases"))){Map<String,Object> c=Core.asMap(raw);Object actual=Core.mcp_mrtr_fulfill_roots(c.getOrDefault("input_requests",Map.of()),c.get("roots"));assertSubset(actual,c.getOrDefault("expected",Map.of()),"MRTR roots fulfillment");}for(Object raw:Core.asList(fixture.get("next_params_cases"))){Map<String,Object> c=Core.asMap(raw);Object actual=Core.mcp_mrtr_next_params(c.getOrDefault("base_params",Map.of()),c.get("input_responses"),c.get("request_state"));if(!actual.equals(c.getOrDefault("expected",Map.of())))throw new AssertionError("MRTR next params mismatch: "+actual);}return;}
      if ("http_session_headers".equals(operation)) {
        AxMCPStreamableHTTPTransport transport = new AxMCPStreamableHTTPTransport(String.valueOf(fixture.getOrDefault("endpoint", "https://example.com/mcp")), Core.asMap(fixture.get("transport_options")));
        transport.setSessionId(String.valueOf(fixture.getOrDefault("session_id", "session-1")));
        transport.setProtocolVersion(String.valueOf(fixture.getOrDefault("protocol_version", AX_MCP_PROTOCOL_VERSION)));
        assertSubset(transport.buildHeaders(Map.of("Accept", "application/json"), true), fixture.getOrDefault("expected_headers", Map.of()), "headers");
        return;
      }
      if ("modern_transport_headers".equals(operation)) {
        AxMCPStreamableHTTPTransport transport = new AxMCPStreamableHTTPTransport(String.valueOf(fixture.getOrDefault("endpoint", "https://example.com/mcp")));
        transport.setSessionId(String.valueOf(fixture.getOrDefault("session_id", "legacy-session")));
        transport.setEra(String.valueOf(fixture.getOrDefault("era", "modern")));
        transport.setProtocolVersion(String.valueOf(fixture.getOrDefault("protocol_version", "2026-07-28")));
        Map<String, String> extraHeaders = new LinkedHashMap<>();
        for (Map.Entry<String, Object> entry : Core.asMap(fixture.get("extra_headers")).entrySet()) extraHeaders.put(entry.getKey(), String.valueOf(entry.getValue()));
        Map<String, String> headers = transport.buildHeaders(Map.of("Accept", "application/json"), true, String.valueOf(fixture.getOrDefault("method", "")), Core.asMap(fixture.get("params")), extraHeaders);
        assertSubset(headers, fixture.getOrDefault("expected_headers", Map.of()), "modern headers");
        for (Object name : Core.asList(fixture.get("forbidden_headers"))) if (headers.containsKey(String.valueOf(name))) throw new AssertionError("forbidden modern header present: " + name);
        if (!transport.eraCacheKey().equals(String.valueOf(fixture.get("expected_era_cache_key")))) throw new AssertionError("era cache key mismatch: " + transport.eraCacheKey());
        try { transport.startListening(); throw new AssertionError("modern transport allowed legacy HTTP GET listening"); }
        catch (AxMCPError error) { if (!error.getMessage().contains(String.valueOf(fixture.get("expected_listen_error_contains")))) throw error; }
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
      if (!"client_discovery".equals(operation) && fixture.get("expected_protocol_version") != null && !String.valueOf(fixture.get("expected_protocol_version")).equals(client.getProtocolVersion())) throw new AssertionError("protocol version mismatch");
      if ("client_discovery".equals(operation)) {
        if(fixture.get("call_tool")!=null){Map<String,Object> call=Core.asMap(fixture.get("call_tool"));Map<String,Object> result=client.callTool(String.valueOf(call.get("name")),Core.asMap(call.get("arguments")));assertSubset(result,fixture.getOrDefault("expected_call_result",Map.of()),"tool result");}
        if(!String.valueOf(fixture.get("expected_era")).equals(client.getEra()))throw new AssertionError("era mismatch");if(fixture.get("expected_protocol_version")!=null&&!String.valueOf(fixture.get("expected_protocol_version")).equals(client.getProtocolVersion()))throw new AssertionError("protocol version mismatch");
        List<String> names=client.getTools().stream().map(tool->String.valueOf(tool.get("name"))).toList();if(fixture.get("expected_tool_names")!=null&&!names.equals(Core.asList(fixture.get("expected_tool_names")).stream().map(String::valueOf).toList()))throw new AssertionError("tool names mismatch");assertSubset(client.getServerInfo(),fixture.getOrDefault("expected_server_info",Map.of()),"server info");assertRequests(transport.requests,fixture);
        List<Object> expectedHeaders=Core.asList(fixture.get("expected_request_headers"));for(int i=0;i<expectedHeaders.size();i++)assertSubset(transport.requestHeaders.get(i),expectedHeaders.get(i),"request headers "+i);
        for(Object forbidden:Core.asList(fixture.get("forbidden_methods"))){String method=String.valueOf(forbidden);if(transport.requests.stream().anyMatch(request->method.equals(request.get("method")))||transport.notifications.stream().anyMatch(item->method.equals(item.get("method"))))throw new AssertionError("forbidden modern method emitted: "+method);}
        if(fixture.get("expected_notification_methods")!=null){List<String> methods=transport.notifications.stream().map(item->String.valueOf(item.get("method"))).toList();if(!methods.equals(Core.asList(fixture.get("expected_notification_methods")).stream().map(String::valueOf).toList()))throw new AssertionError("notification methods mismatch");}
      } else if ("read_cache".equals(operation)) {
        client.refresh(false);int catalogs=0;for(Map<String,Object> request:transport.requests){String method=String.valueOf(request.get("method"));if("resources/list".equals(method)||"resources/templates/list".equals(method))catalogs++;}if(catalogs!=((Number)fixture.getOrDefault("expected_catalog_requests_after_fresh_refresh",0)).intValue())throw new AssertionError("fresh catalog issued extra requests: "+catalogs);String uri=String.valueOf(fixture.getOrDefault("uri",""));Map<String,Object> first=client.readResource(uri);Map<String,Object> second=client.readResource(uri);assertSubset(first,fixture.getOrDefault("expected_first",Map.of()),"first resource read");assertSubset(second,fixture.getOrDefault("expected_first",Map.of()),"cached resource read");transport.emit(Core.asMap(fixture.get("notification")));Map<String,Object> after=client.readResource(uri);assertSubset(after,fixture.getOrDefault("expected_after_update",Map.of()),"resource read after update");int reads=0;for(Map<String,Object> request:transport.requests)if("resources/read".equals(request.get("method")))reads++;if(reads!=((Number)fixture.getOrDefault("expected_read_requests",0)).intValue())throw new AssertionError("resource read request count mismatch: "+reads);
      } else if("tasks_v2_modern".equals(operation)){assertSubset(client.callTool("slow",Map.of()),fixture.getOrDefault("expected_call_result",Map.of()),"task call result");client.provideTaskInput("task-1",Map.of());client.cancelTask("task-1");try{client.listTasks(null);throw new AssertionError("missing modern tasks/list rejection");}catch(AxMCPError error){if(!error.getMessage().contains(String.valueOf(fixture.get("expected_list_error"))))throw error;}try{client.getTaskResult("task-1");throw new AssertionError("missing modern tasks/result rejection");}catch(AxMCPError error){if(!error.getMessage().contains(String.valueOf(fixture.get("expected_result_error"))))throw error;}List<String> methods=transport.requests.stream().map(request->String.valueOf(request.get("method"))).toList();if(!methods.equals(Core.asList(fixture.get("expected_methods")).stream().map(String::valueOf).toList()))throw new AssertionError("task request methods mismatch: "+methods);
      } else if("mrtr_roots".equals(operation)){assertSubset(client.callTool("work",Map.of("value",1.0)),fixture.getOrDefault("expected_call_result",Map.of()),"MRTR tool result");assertSubset(client.getPrompt("ask",Map.of()),fixture.getOrDefault("expected_prompt_result",Map.of()),"MRTR prompt result");assertSubset(client.readResource("file:///resource"),fixture.getOrDefault("expected_resource_result",Map.of()),"MRTR resource result");List<String> methods=transport.requests.stream().map(request->String.valueOf(request.get("method"))).toList();if(!methods.equals(Core.asList(fixture.get("expected_methods")).stream().map(String::valueOf).toList()))throw new AssertionError("MRTR request methods mismatch: "+methods);List<Map<String,Object>> toolCalls=transport.requests.stream().filter(request->"tools/call".equals(request.get("method"))).toList();Set<String> ids=new LinkedHashSet<>();for(Map<String,Object> request:toolCalls)ids.add(String.valueOf(request.get("id")));if(ids.size()!=toolCalls.size())throw new AssertionError("MRTR rounds reused a request id");List<Object> expectedParams=Core.asList(fixture.get("expected_tool_call_params"));for(int i=0;i<expectedParams.size();i++){Map<String,Object> expected=Core.asMap(expectedParams.get(i));Map<String,Object> params=Core.asMap(toolCalls.get(i).get("params"));assertSubset(params,expected,"MRTR tool params "+i);if(!expected.containsKey("inputResponses")){if(params.containsKey("inputResponses")||params.containsKey("requestState"))throw new AssertionError("initial MRTR request included round state");}else if(!Core.asMap(params.get("inputResponses")).keySet().equals(Core.asMap(expected.get("inputResponses")).keySet()))throw new AssertionError("MRTR request retained stale input responses");if(!expected.containsKey("requestState")&&params.containsKey("requestState"))throw new AssertionError("MRTR request retained stale requestState");}
      } else if("subscriptions_listen".equals(operation)){for(Object raw:Core.asList(fixture.get("semantic_cases"))){Map<String,Object> item=Core.asMap(raw);Object actual=Core.mcp_listen_interests(item.getOrDefault("subscribed_uris",List.of()),item.getOrDefault("filters",Map.of()));if(!actual.equals(item.getOrDefault("expected",Map.of())))throw new AssertionError("listen interests mismatch: "+actual);}List<Map<String,Object>> delivered=new ArrayList<>();client.addNotificationListener(message->delivered.add(cloneMap(message)));client.startListening();if(transport.requestStreams.size()!=1)throw new AssertionError("initial subscriptions/listen stream missing");Map<String,Object> first=transport.requestStreams.get(0);assertSubset(Core.asMap(first.get("params")).get("notifications"),fixture.getOrDefault("expected_first_notifications",Map.of()),"initial listen interests");client.acquireResourceSubscription(String.valueOf(fixture.getOrDefault("uri","")),"fixture");if(transport.requestStreams.size()!=((Number)fixture.getOrDefault("expected_stream_count",0)).intValue())throw new AssertionError("subscription interest change did not restart request stream");Map<String,Object> second=transport.requestStreams.get(transport.requestStreams.size()-1);if(first.get("id").equals(second.get("id")))throw new AssertionError("subscriptions/listen restart reused its request id");assertSubset(Core.asMap(second.get("params")).get("notifications"),fixture.getOrDefault("expected_second_notifications",Map.of()),"updated listen interests");java.util.function.IntSupplier updateCount=()->(int)delivered.stream().filter(item->"notifications/resources/updated".equals(item.get("method"))).count();int before=updateCount.getAsInt();Map<String,Object> notification=cloneMap(Core.asMap(fixture.get("delivered_notification")));Map<String,Object> notificationParams=new LinkedHashMap<>(Core.asMap(notification.get("params")));Map<String,Object> meta=new LinkedHashMap<>(Map.of("io.modelcontextprotocol/subscriptionId","other"));notificationParams.put("_meta",meta);notification.put("params",notificationParams);transport.emit(notification);if(updateCount.getAsInt()!=before)throw new AssertionError("cross-subscription notification was delivered");meta.put("io.modelcontextprotocol/subscriptionId",second.get("id"));transport.emit(notification);if(updateCount.getAsInt()!=before+1)throw new AssertionError("active subscription notification was not delivered");Map<String,Object> last=delivered.get(delivered.size()-1);if(Core.asMap(last.get("params")).containsKey("_meta"))throw new AssertionError("subscription id leaked to notification consumer");for(Object forbidden:Core.asList(fixture.get("expected_forbidden_methods")))if(transport.requests.stream().anyMatch(request->String.valueOf(forbidden).equals(request.get("method"))))throw new AssertionError("modern subscription emitted legacy method "+forbidden);
      } else if ("initialize".equals(operation)) {
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
  final int code;final Object data;
  AxMCPError(String message) { this(message,0,null); }
  AxMCPError(String message,int code,Object data) { super(message);this.code=code;this.data=data; }
}
