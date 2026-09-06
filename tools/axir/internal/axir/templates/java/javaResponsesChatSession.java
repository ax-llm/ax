package dev.axllm.ax;

import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;

/** HTTP ownership adapter; provider mapping and event folding remain in Core. */
final class ResponsesChatSession implements AxChatSession {
  private record Delivery(Object event,Throwable error) {}
  private final OpenAICompatibleClient client;
  private final Map<String,Object> options;
  private final Map<String,Object> base;
  private final String model;
  private final AtomicBoolean closed=new AtomicBoolean();
  private final BlockingQueue<Delivery> queue=new LinkedBlockingQueue<>();
  private final Set<OpenAICompatibleClient.RawSseStream> readers=ConcurrentHashMap.newKeySet();
  private final Map<String,Object> wire=new LinkedHashMap<>();
  private final Deque<Map<String,Object>> notifications=new ArrayDeque<>();
  private final List<Object> updates=new ArrayList<>();
  private final ExecutorService executor=Executors.newSingleThreadExecutor(r->{Thread t=new Thread(r,"ax-responses-reader");t.setDaemon(true);return t;});
  private volatile String previous;
  private final Map<String,Object> transportCursor=new LinkedHashMap<>();
  private final OpenAICompatibleClient.RealtimeTransport socket;
  private boolean lastWasUpdate;
  ResponsesChatSession(OpenAICompatibleClient client,Map<String,Object> request,Map<String,Object> options) throws Exception {
    this.client=client; this.options=client.mergedOptions(options);
    this.model=String.valueOf(request.get("model")==null?client.model:request.get("model"));
    if(!Set.of("openai","openai-responses").contains(client.profile) || !model.startsWith("gpt-6-astra")) throw new IllegalArgumentException("Model does not support chat sessions");
    Map<String,Object> req=new LinkedHashMap<>(request);
    var config=Core.asMap(Core.merge_model_config(client.modelConfig,request.get("model_config"),this.options));
    config.put("stream",true);req.put("model_config",config);req.put("model",model);req.put("session_enabled",true);
    base=Core.asMap(Core.provider_build_chat_request(client.profile,req,this.options));
    Object configured=this.options.getOrDefault("webSocketTransport",this.options.get("web_socket_transport"));
    Object factory=this.options.getOrDefault("webSocketFactory",this.options.get("web_socket_factory"));
    socket=factory instanceof OpenAICompatibleClient.SessionWebSocketFactory hook?client.openSessionSocket(hook,model):configured instanceof OpenAICompatibleClient.RealtimeTransport transport?transport:null;
    if(socket!=null) executor.execute(()->{try{while(!closed.get()){var event=socket.recv();if(event==null)throw new IllegalStateException("Responses socket disconnected; work was not replayed");synchronized(transportCursor){Core.openai_responses_transport_cursor(transportCursor,event);}queue.put(new Delivery(event,null));}}catch(Throwable error){if(!closed.get())queue.offer(new Delivery(null,error));}});
    send(new LinkedHashMap<>(base));
  }
  private void send(Map<String,Object> payload) {
    Core.openai_responses_validate_session_request(payload);
    List<Object> input=Core.asList(payload.get("input"));
    if(lastWasUpdate && !input.isEmpty() && "configuration_update".equals(Core.get(input.get(0),"type",null))) throw new IllegalArgumentException("Adjacent configuration_update items are not supported");
    lastWasUpdate=!input.isEmpty() && "configuration_update".equals(Core.get(input.get(input.size()-1),"type",null));
    if(closed.get()) throw new IllegalStateException("Session closed");
    if(socket!=null){var event=new LinkedHashMap<>(payload);event.remove("stream");event.put("type","response.create");socket.send(event);return;}
    executor.execute(()->{
      OpenAICompatibleClient.RawSseStream reader=null;
      try {
        reader=client.requestSse(client.operationPath("stream_chat",model),payload,model);
        readers.add(reader);
        if(closed.get()) return;
        boolean complete=false;
        while(!closed.get()) {
          Object event=reader.nextEvent(); if(event==null) break;
          String type=String.valueOf(Core.get(event,"type",""));
          if("response.completed".equals(type) || ("response.incomplete".equals(type) && "steered".equals(Core.get(Core.get(Core.get(event,"response",Map.of()),"incomplete_details",Map.of()),"reason","")))) complete=true;
          queue.put(new Delivery(event,null));
          if(complete) break;
        }
        if(!complete && !closed.get()) throw new IllegalStateException("Responses stream disconnected before completion; work was not replayed");
      } catch(Throwable error) { if(!closed.get()) queue.offer(new Delivery(null,error)); }
      finally { if(reader!=null) {readers.remove(reader);try{reader.close();}catch(Exception ignored){}} }
    });
  }
  public Map<String,Object> next() throws Exception {
    while(!closed.get()) {
      if(!notifications.isEmpty()) {
        var event=notifications.removeFirst();
        if("response.completed".equals(event.get("type"))) { previous=String.valueOf(event.get("response_id")); var response=Core.asMap(event.get("response")); client.lastModelUsage=Core.asMap(response.get("model_usage")); AxGlobals.emitUsage("chat",response,options,true); }
        return event;
      }
      Delivery delivery=queue.take(); if(delivery.error()!=null) {if(delivery.error() instanceof Exception error)throw error;throw new IllegalStateException("Session reader failed",delivery.error());}
      if(delivery.event()==null) break;
      if("response.created".equals(Core.get(delivery.event(),"type",""))){previous=String.valueOf(Core.get(Core.get(delivery.event(),"response",Map.of()),"id",""));}
      for(Object event:Core.asList(Core.openai_responses_session_event(delivery.event(),wire,model))) notifications.add(Core.asMap(event));
    }
    throw new CancellationException("Session closed");
  }
  public void submit(List<Object> results) {
    List<Object> input=new ArrayList<>(updates);
    for(Object result:results) input.add(Map.of("type","function_call_output","call_id",Core.get(result,"function_id",""),"output",Core.get(result,"result","")));
    var payload=new LinkedHashMap<>(base);payload.put("previous_response_id",previous);payload.put("input",input);
    send(payload);updates.clear();
  }
  public String update(Map<String,Object> update) {
    synchronized(transportCursor) {
    Object activeId=transportCursor.get("active_id");
    if("steer".equals(update.get("type")) && socket!=null && activeId!=null) {socket.send(Map.of("type","response.steer","previous_response_id",activeId,"input",List.of(Map.of("role","user","content",List.of(Map.of("type","input_text","text",update.get("text")))))));return "native";}
    }
    if("steer".equals(update.get("type"))) updates.add(Map.of("role","user","content",List.of(Map.of("type","input_text","text",update.get("text")))));
    else { if(!updates.isEmpty() && "configuration_update".equals(Core.get(updates.get(updates.size()-1),"type",null))) throw new IllegalArgumentException("Adjacent configuration_update items are not supported"); updates.add(Map.of("type","configuration_update","reasoning",Map.of("effort",Core.openai_reasoning_effort(model,update.get("level"))))); }
    return "next-response";
  }
  public void close() {
    if(!closed.compareAndSet(false,true)) return;
    queue.offer(new Delivery(null,null));executor.shutdownNow();if(socket!=null)socket.close();
    for(var reader:readers) try{reader.close();}catch(Exception ignored){}
  }
}
