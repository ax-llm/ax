package dev.axllm.ax;

import java.util.*;
import java.util.concurrent.*;

/** One dispatcher owns the pending registry, history, and continuation order. */
final class SessionRun implements AiClient,AutoCloseable {
  private record Delivery(String type,Object value,Object result,Throwable error) {}
  AiClient client;
  private boolean selected;
  private final AxGen gen;
  private AxChatSession.Provider provider;
  private final Map<String,Object> options;
  private final AxRunControl control;
  private final String path;
  private final BlockingQueue<Delivery> queue=new LinkedBlockingQueue<>();
  private final ExecutorService workers=Executors.newCachedThreadPool(r->{Thread t=new Thread(r,"ax-session-worker");t.setDaemon(true);return t;});
  private final Set<String> seen=new HashSet<>();
  private final List<String> applied=new ArrayList<>();
  private final List<Map<String,Object>> waiting=new ArrayList<>();
  private AxChatSession session;
  private Map<String,Object> state,last;
  private boolean blocking;
  private Object level;
  private boolean fallbackStarted;
  private volatile boolean closed;
  SessionRun(AxGen gen,AiClient client,AxChatSession.Provider provider,Map<String,Object> options) {
    this.gen=gen;this.client=client;this.provider=provider;this.options=options;
    control=options.get("control") instanceof AxRunControl value?value:null;
    path=String.valueOf(options.getOrDefault("execution_path","root"));
  }
  private void emit(String kind,Map<String,Object> extra) { if(control!=null) {var event=new LinkedHashMap<>(extra);event.put("type",kind);event.put("path",path);control.emit(event);} }
  private void start(Map<String,Object> originalCall) {
    Map<String,Object> call=Core.asMap(Core.chat_session_normalize_call(originalCall));
    var function=Core.asMap(call.get("function"));String name=String.valueOf(function.get("name")),id=String.valueOf(call.get("id"));
    if("__axOutput".equals(name)) {Core.chat_session_defer_final_call(state,call);return;}
    if(Core.asMap(state.get("pending")).containsKey(id)) return;
    if(blocking) {if(waiting.stream().noneMatch(value->id.equals(value.get("id"))))waiting.add(call);return;}
    Tool tool=gen.functions.stream().filter(value->value.name.equals(name)).findFirst().orElse(null);
    Object args=function.getOrDefault("params",Map.of());
    String execution=tool==null?"blocking":tool.execution;
    try {
      if(args instanceof String text) args=Json.parse(text);
      if(tool==null) throw new IllegalArgumentException("Function '"+name+"' not found");
      Core.validate_fields(tool.args,args,"tool."+name+".args");
      Core.chat_session_validate_required_arguments(tool.schema(),args,"tool."+name+".args");
    } catch(RuntimeException error) {
      Core.chat_session_register_call(state,call,"blocking");
      Core.chat_session_record_result(gen,state,call,Core.get(Core._tool_error_message_impl(call,error),"result",error.getMessage()),false);return;
    }
    Core.chat_session_register_call(state,call,execution);blocking=!"background".equals(execution);
    emit("tool.started",Map.of("call_id",id));
    final Map<String,Object> values=new LinkedHashMap<>(Core.asMap(args));
    final Tool selected=tool;
    workers.execute(AxGlobals.inherit(()->{Object result=null;Throwable failure=null;
      try {result=Core.toolInvoke(selected,values,()->closed || Thread.currentThread().isInterrupted());}catch(Throwable error){failure=error;}
      if(!closed) queue.offer(new Delivery("tool",call,result,failure));
    }));
  }
  public Map<String,Object> complete(Map<String,Object> request) throws Exception {
    if(!selected) {
      if(control!=null&&control.isAborted())throw new CancellationException("Run aborted before selecting a provider");
      var visited=Collections.newSetFromMap(new IdentityHashMap<AiClient,Boolean>());
      while(client instanceof ChatRunSelector selector){if(!visited.add(client))throw new IllegalStateException("Cyclic run routing");client=selector.pinChatRun(request,options);}
      selected=true;
      provider=Core.truthy(Core.chat_session_mode_enabled(options))&&client instanceof AxChatSession.Provider capability&&Core.truthy(Core.get(Core.aiClientFeatures(client,request.get("model")),"asyncTools",false))?capability:null;
    }
    if(provider==null) {
      if(!fallbackStarted){emit("started",Map.of());fallbackStarted=true;}
      if(control!=null && control.isAborted())throw new CancellationException("Run aborted before the next model request");
      var updates=control==null?List.<Map<String,Object>>of():control.pending(path,seen);
      for(var update:updates)seen.add(String.valueOf(update.get("id")));
      var applied=Core.asMap(Core.chat_session_apply_boundary_updates(request,updates,level));level=applied.get("level");
      for(Object id:Core.asList(applied.get("applied")))emit("applied",Map.of("update_id",id,"timing","next-response"));
      return Core.asMap(Core.aiCompleteOnce(client,applied.get("request"),options));
    }
    if(session==null) {
      if(control!=null && control.isAborted())throw new CancellationException("Run aborted before opening a session");
      session=provider.openChatSession(request,options);
      state=Core.asMap(Core.chat_session_create_state(String.valueOf(request.get("model")),path,options.getOrDefault("maxSteps",options.getOrDefault("max_steps",10))));
      emit("started",Map.of());
      workers.execute(()->{try{while(!closed)queue.put(new Delivery("provider",session.next(),null,null));}catch(Throwable error){if(!closed)queue.offer(new Delivery("failure",null,null,error));}});
    } else {
      var messages=Core.asList(request.get("chat_prompt"));
      if(!messages.isEmpty()) session.update(Map.of("type","steer","text",Core.get(messages.get(messages.size()-1),"content","")));
      submit(List.of());
    }
    while(!closed) {
      if(Thread.currentThread().isInterrupted() || (control!=null && control.isAborted())) throw new CancellationException("Run aborted; unresolved calls: "+Core.chat_session_unresolved(state));
      if(control!=null) for(var update:control.pending(path,seen)) {String id=String.valueOf(update.get("id"));seen.add(id);Core.chat_session_queue_update(state,update);if("native".equals(session.update(update)))Core.chat_session_native_update(state,id);else applied.add(id);}
      Delivery delivery=queue.poll(10,TimeUnit.MILLISECONDS);
      if(delivery!=null) {
        if("failure".equals(delivery.type())) throw new IllegalStateException("Session failed; unresolved calls: "+Core.chat_session_unresolved(state),delivery.error());
        if("tool".equals(delivery.type())) {
          var call=Core.asMap(delivery.value());String id=String.valueOf(call.get("id"));Object result=delivery.result();
          if(delivery.error()!=null) result=Core.get(Core._tool_error_message_impl(call,delivery.error()),"result",delivery.error().toString());
          if(!Core.truthy(Core.chat_session_record_result(gen,state,call,result,delivery.error()==null)))continue;emit("tool.completed",Map.of("call_id",id));
          if(!"background".equals(Core.get(Core.asMap(state.get("pending")).get(id),"execution","blocking"))) {blocking=false;var queued=new ArrayList<>(waiting);waiting.clear();for(var item:queued)start(item);}
        } else if("provider".equals(delivery.type())) {
          var event=Core.asMap(delivery.value());
          if("response".equals(event.get("type")))emit("model.output",Core.asMap(Core.chat_session_observe_output(gen,state,event)));
          if("steering".equals(event.get("type"))) {var result=Core.asMap(Core.chat_session_native_event(state,event));if(result.get("applied_id")!=null)emit("applied",Map.of("update_id",result.get("applied_id"),"timing","native"));}
          if("tool.call".equals(event.get("type"))) start(Core.asMap(event.get("call")));
          if("response.completed".equals(event.get("type")) && Core.truthy(Core.chat_session_complete_response(state,event.get("response_id")))) {
            last=Core.asMap(event.get("response"));Object completion=Core.chat_session_completion(last,event.get("response_id"));
            for(Object call:Core.asList(Core._response_function_calls_impl(completion)))start(Core.asMap(call));
            if(Core.truthy(Core.chat_session_has_continuation_work(state))) {Core.axgenMemoryAddResponse(gen,request,completion);Core.axgenRecordChatLog(gen,request,completion);}
          }
        }
      }
      var action=Core.asMap(Core.chat_session_boundary_action(state));
      switch(String.valueOf(action.get("type"))) {
        case "submit" -> submit(Core.asList(action.get("results")));
        case "continue" -> submit(List.of());
        case "validate" -> {if(last!=null)return Core.asMap(Core.chat_session_completion(last,state.get("response_id")));}
      }
    }
    throw new CancellationException("Session closed");
  }
  private void submit(List<Object> results) throws Exception {
    if(Core.asInt(state.get("steps"))>=Core.asInt(state.get("max_steps"))) throw new IllegalStateException("Maximum model steps exhausted before final completion");
    session.submit(results);List<Object> ids=new ArrayList<>();for(Object result:results)ids.add(Core.get(result,"function_id",""));Core.chat_session_mark_submitted(state,ids);
    for(String id:applied){Core.chat_session_transition(state,Map.of("type","update.applied","id",id));emit("applied",Map.of("update_id",id,"timing","next-response"));}applied.clear();
  }
  void finish(Throwable failure) {
    if(state!=null)Core.chat_session_record_unresolved(gen,state);
    Object pending=state==null?List.of():Core.chat_session_close_state(state);close();
    if(failure==null)emit("completed",Map.of());else emit("failed",Map.of("error",failure.toString(),"pending_call_ids",pending));
  }
  public void close() {if(closed)return;closed=true;if(session!=null)session.close();workers.shutdownNow();}
}
