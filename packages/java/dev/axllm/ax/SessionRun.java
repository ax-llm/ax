package dev.axllm.ax;

import java.util.*;
import java.util.concurrent.*;

/** One dispatcher owns the pending registry, history, and continuation order. */
final class SessionRun implements AiClient,AutoCloseable {
  private record Delivery(String type,Object value,Object result,Throwable error) {}
  // What a native session produces for its request: each partial response
  // event, each response it continues from (by id), then its final response.
  private record Item(String kind,Map<String,Object> value,Object responseId) {}
  AiClient client;
  private boolean selected;
  private final AxGen gen;
  private AxChatSession.Provider provider;
  private final Map<String,Object> options;
  private final AxRunControl control;
  private final String path;
  private final ExecutorService workers=Executors.newCachedThreadPool(r->{Thread t=new Thread(r,"ax-session-worker");t.setDaemon(true);return t;});
  // The updates the request boundary has applied (a client without sessions).
  private final Set<String> seen=new HashSet<>();
  private Object level;
  private boolean started;
  private volatile boolean closed;
  // The request's open native session, and the last session's state, whose
  // unresolved calls the run's close records.
  private volatile Live live;
  private Map<String,Object> state;
  SessionRun(AxGen gen,AiClient client,AxChatSession.Provider provider,Map<String,Object> options) {
    this.gen=gen;this.client=client;this.provider=provider;this.options=options;
    control=options.get("control") instanceof AxRunControl value?value:null;
    // The run's control path: execution_path, else TypeScript's executionPath,
    // from the constructor options merged with the call's (the call wins).
    Object executionPath=options.get("execution_path");
    if(executionPath==null)executionPath=options.get("executionPath");
    path=executionPath==null?"root":String.valueOf(executionPath);
  }
  private void emit(String kind,Map<String,Object> extra) { if(control!=null) {var event=new LinkedHashMap<>(extra);event.put("type",kind);event.put("path",path);control.emit(event);} }
  // As in TypeScript, the run has started before its first request goes out.
  private void emitStarted() { if(!started){started=true;emit("started",Map.of());} }
  // The first request pins a routed client and picks an async chat session
  // when the pinned provider supports one.
  private void select(Map<String,Object> request) throws Exception {
    if(selected) return;
    emitStarted();
    if(control!=null&&control.isAborted())throw new CancellationException("Run aborted before selecting a provider");
    var visited=Collections.newSetFromMap(new IdentityHashMap<AiClient,Boolean>());
    while(client instanceof ChatRunSelector selector){if(!visited.add(client))throw new IllegalStateException("Cyclic run routing");client=selector.pinChatRun(request,options);}
    selected=true;
    provider=Core.truthy(Core.chat_session_mode_enabled(options))&&client instanceof AxChatSession.Provider capability&&Core.truthy(Core.get(Core.aiClientFeatures(client,request.get("model")),"asyncTools",false))?capability:null;
  }
  // Without a session, controls apply to ordinary requests at the next
  // response boundary: an abort stops the run and pending updates join the request.
  private Map<String,Object> boundary(Map<String,Object> request) {
    emitStarted();
    if(control!=null && control.isAborted())throw new CancellationException("Run aborted before the next model request");
    var updates=control==null?List.<Map<String,Object>>of():control.pending(path,seen);
    for(var update:updates)seen.add(String.valueOf(update.get("id")));
    var applied=Core.asMap(Core.chat_session_apply_boundary_updates(request,updates,level));level=applied.get("level");
    for(Object id:Core.asList(applied.get("applied")))emit("applied",Map.of("update_id",id,"timing","next-response"));
    return Core.asMap(applied.get("request"));
  }
  // As in TypeScript, the forward applies the updates pending for this run
  // when a step starts (intrinsic.ai.control_take_pending): each is applied
  // now, so the next request boundary skips it, and the run reports started
  // before the first one. A native chat session applies its controls itself,
  // so it hands over none.
  List<Map<String,Object>> takeControlUpdates() {
    if(control==null||provider!=null) return new ArrayList<>();
    var updates=control.pending(path,seen);
    if(updates.isEmpty()) return new ArrayList<>();
    emitStarted();
    for(var update:updates){seen.add(String.valueOf(update.get("id")));emit("applied",Map.of("update_id",update.get("id"),"timing","next-response"));}
    return new ArrayList<>(updates);
  }
  // The updates still pending for this run (intrinsic.ai.control_pending_count);
  // a step that ends with some takes another step.
  int pendingControlCount() {
    return control==null||provider!=null?0:control.pending(path,seen).size();
  }
  // A streamed forward pulls the client's chunks through the same boundary, as
  // they arrive and with the call's options and cancellation. A native chat
  // session streams its items as they happen: each partial response event,
  // each response it continues from, then its final response. Closing the
  // stream closes the session.
  @Override public AxChatStream openStream(Map<String,Object> request,Map<String,Object> callOptions,AxCancellationToken cancellation) throws Exception {
    select(request);
    if(provider==null) return client.openStream(boundary(request),callOptions==null?options:callOptions,cancellation);
    Live session=open(request,callOptions);
    return new AxChatStream(()->{Item item=session.next();return item==null?null:session.streamItem(item);},session);
  }
  @Override public Iterable<Map<String,Object>> stream(Map<String,Object> request) { return AxChatStream.lazy(()->openStream(request,options,null)); }
  // The audio output renderer's speech goes to the wrapped client.
  @Override public Map<String,Object> speak(Map<String,Object> request,Map<String,Object> callOptions) throws Exception { return client.speak(request,callOptions); }
  // A request in a native session returns the session's final response,
  // carrying the turns before it for the request's prompt.
  public Map<String,Object> complete(Map<String,Object> request) throws Exception {
    select(request);
    if(provider==null) return Core.asMap(Core.aiCompleteOnce(client,boundary(request),options));
    try(Live session=open(request,null)) {
      for(Item item=session.next();item!=null;item=session.next()) if("final".equals(item.kind())) return Core.asMap(Core.chat_response_to_completion(item.value()));
    }
    throw new IllegalStateException("Chat session ended without a response");
  }
  // As in TypeScript (axRunChatSession), each model request opens its own
  // native session with the request's whole prompt, and the session closes
  // once that request's response completes: a correction or a later step
  // opens a fresh one.
  private Live open(Map<String,Object> request,Map<String,Object> callOptions) throws Exception {
    if(control!=null && control.isAborted())throw new CancellationException("Run aborted before opening a session");
    Map<String,Object> sessionOptions=new LinkedHashMap<>(options);
    if(callOptions!=null)sessionOptions.putAll(callOptions);
    AxChatSession opened=provider.openChatSession(request,sessionOptions);
    try {Live session=new Live(request,opened);live=session;state=session.state;return session;}
    catch(RuntimeException|Error error){opened.close();throw error;}
  }
  // One request's native session: its events and its tool workers' results,
  // its tool loop state, and the run updates it has applied. Each session
  // applies all of the run's updates for its path again, from the start.
  private final class Live implements AutoCloseable {
    final Map<String,Object> request;
    final AxChatSession session;
    final Map<String,Object> state;
    final BlockingQueue<Delivery> queue=new LinkedBlockingQueue<>();
    final Set<String> seen=new HashSet<>();
    final List<String> applied=new ArrayList<>();
    final List<Map<String,Object>> waiting=new ArrayList<>();
    volatile boolean cancelled;
    boolean blocking,resume,done;
    Map<String,Object> last;
    Live(Map<String,Object> request,AxChatSession session) {
      this.request=request;this.session=session;
      state=Core.asMap(Core.chat_session_create_state(String.valueOf(request.get("model")),path,options.getOrDefault("maxSteps",options.getOrDefault("max_steps",10))));
      workers.execute(()->{try{while(!cancelled){Map<String,Object> event=session.next();if(cancelled)return;if(event==null){queue.offer(new Delivery("failure",null,null,new IllegalStateException("Session disconnected; work was not replayed")));return;}queue.put(new Delivery("provider",event,null,null));}}catch(Throwable error){if(!cancelled)queue.offer(new Delivery("failure",null,null,error));}});
    }
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
      } catch(RuntimeException error) {
        Core.chat_session_register_call(state,call,"blocking");
        Core.chat_session_record_result(gen,state,call,Core.get(Core._tool_error_message_impl(call,error),"result",error.getMessage()),false);return;
      }
      // As TS's session does, a call whose arguments fail the tool's schema
      // does not run: its result is TS's fixing instructions.
      Object fixing=Core.chat_session_tool_argument_error(name,tool.schema(),args);
      if(fixing!=null){Core.chat_session_register_call(state,call,"blocking");Core.chat_session_record_result(gen,state,call,fixing,false);return;}
      Core.chat_session_register_call(state,call,execution);blocking=!"background".equals(execution);
      emit("tool.started",Map.of("call_id",id));
      final Map<String,Object> values=new LinkedHashMap<>(Core.asMap(args));
      final Tool selected=tool;
      // A worker owns only the invocation and its result, which goes to the
      // session that started it, never to a later one.
      workers.execute(AxGlobals.inherit(()->{Object result=null;Throwable failure=null;
        try {result=Core.toolInvoke(selected,values,()->cancelled || Thread.currentThread().isInterrupted());}catch(Throwable error){failure=error;}
        if(!cancelled) queue.offer(new Delivery("tool",call,result,failure));
      }));
    }
    // The run's updates for this path that this session has not applied yet.
    private void updates() throws Exception {
      if(control==null) return;
      for(var update:control.pending(path,seen)) {
        String id=String.valueOf(update.get("id"));seen.add(id);
        if(!Core.truthy(Core.chat_session_queue_update(state,update)))continue;
        if("native".equals(session.update(update)))Core.chat_session_native_update(state,id);else applied.add(id);
      }
    }
    // The session's next item, or null after its final response. An item
    // returns before the boundary action that follows it, which runs on the
    // next call.
    Item next() throws Exception {
      while(!done) {
        if(resume) {resume=false;Item result=boundaryAction();if(result!=null)return result;continue;}
        if(closed || cancelled) throw new CancellationException("Session closed");
        if(Thread.currentThread().isInterrupted() || (control!=null && control.isAborted())) throw new CancellationException("Run aborted; unresolved calls: "+Core.chat_session_unresolved(state));
        updates();
        Delivery delivery=queue.poll(10,TimeUnit.MILLISECONDS);
        Item item=delivery==null?null:handle(delivery);
        if(item!=null) {resume=true;return item;}
        Item result=boundaryAction();if(result!=null)return result;
      }
      return null;
    }
    private Item handle(Delivery delivery) throws Exception {
      if("failure".equals(delivery.type())) throw new IllegalStateException("Session failed; unresolved calls: "+Core.chat_session_unresolved(state),delivery.error());
      if("tool".equals(delivery.type())) {
        var call=Core.asMap(delivery.value());String id=String.valueOf(call.get("id"));Object result=delivery.result();
        if(delivery.error()!=null) result=Core.get(Core._tool_error_message_impl(call,delivery.error()),"result",delivery.error().toString());
        if(!Core.truthy(Core.chat_session_record_result(gen,state,call,result,delivery.error()==null)))return null;emit("tool.completed",Map.of("call_id",id));
        if(!"background".equals(Core.get(Core.asMap(state.get("pending")).get(id),"execution","blocking"))) {blocking=false;var queued=new ArrayList<>(waiting);waiting.clear();for(var item:queued)start(item);}
        return null;
      }
      var event=Core.asMap(delivery.value());
      if("tool.call".equals(event.get("type"))) start(Core.asMap(event.get("call")));
      if("response".equals(event.get("type"))) {emit("model.output",Core.asMap(Core.chat_session_observe_output(gen,state,event)));return new Item("partial",event,event.get("response_id"));}
      if("steering".equals(event.get("type"))) {var result=Core.asMap(Core.chat_session_native_event(state,event));if(result.get("applied_id")!=null)emit("applied",Map.of("update_id",result.get("applied_id"),"timing","native"));}
      if("response.completed".equals(event.get("type")) && Core.truthy(Core.chat_session_complete_response(state,event.get("response_id")))) {
        last=Core.asMap(event.get("response"));Object completion=Core.chat_session_completion(last,event.get("response_id"));
        for(Object call:Core.asList(Core._response_function_calls_impl(completion)))start(Core.asMap(call));
        // A response the session continues from goes into memory, the chat
        // log and the session's turns.
        if(Core.truthy(Core.chat_session_has_continuation_work(state)))Core.chat_session_record_response(gen,state,request,completion);
        return new Item("completed",null,event.get("response_id"));
      }
      return null;
    }
    private Item boundaryAction() throws Exception {
      var action=Core.asMap(Core.chat_session_boundary_action(state));
      switch(String.valueOf(action.get("type"))) {
        case "submit" -> submit(Core.asList(action.get("results")));
        case "continue" -> submit(List.of());
        case "validate" -> {if(last!=null){done=true;return new Item("final",Core.asMap(Core.chat_session_final_result(state,last)),state.get("response_id"));}}
        default -> {}
      }
      return null;
    }
    private void submit(List<Object> results) throws Exception {
      if(Core.asInt(state.get("steps"))>=Core.asInt(state.get("max_steps"))) throw new IllegalStateException("Maximum model steps exhausted before final completion");
      session.submit(results);List<Object> ids=new ArrayList<>();for(Object result:results)ids.add(Core.get(result,"function_id",""));Core.chat_session_mark_submitted(state,ids);
      for(String id:applied){Core.chat_session_transition(state,Map.of("type","update.applied","id",id));emit("applied",Map.of("update_id",id,"timing","next-response"));}applied.clear();
    }
    // A streamed request's items, as the IR reads them: the session's turns
    // so far, and for a partial event whether a tool call has started.
    Map<String,Object> streamItem(Item item) {
      Map<String,Object> info=new LinkedHashMap<>();
      info.put("type",item.kind());
      info.put("turns",new ArrayList<>(Core.asList(state.get("turns"))));
      info.put("response_id",item.responseId());
      Map<String,Object> out=new LinkedHashMap<>();
      if("partial".equals(item.kind())) {
        info.put("calls_started",!Core.asMap(state.get("pending")).isEmpty());
        info.put("pending_calls",Core.chat_session_unresolved(state));
        out.put("results",Core.get(Core.get(item.value(),"response",null),"results",List.of()));
      } else if("final".equals(item.kind())) {
        for(var entry:item.value().entrySet()) if(!entry.getKey().startsWith("__session")) out.put(entry.getKey(),entry.getValue());
      }
      out.put("session",info);
      return out;
    }
    @Override public void close() {
      synchronized(this){if(cancelled)return;cancelled=true;}
      try{session.close();}finally{if(live==this)live=null;}
    }
  }
  void finish(Throwable failure) { finish(failure,false); }
  // A run its streaming consumer stopped early ends with an aborted event
  // rather than failed; any other run as failed or completed. The close also
  // shuts a session still open after an error.
  void finish(Throwable failure,boolean consumerStopped) {
    Live open=live;if(open!=null)open.close();
    if(state!=null)Core.chat_session_record_unresolved(gen,state);
    Object pending=state==null?List.of():Core.chat_session_close_state(state);close();
    if(consumerStopped)emit("aborted",Map.of());
    else if(failure==null)emit("completed",Map.of());else emit("failed",Map.of("error",failure.toString(),"pending_call_ids",pending));
  }
  public void close() {if(closed)return;closed=true;Live open=live;if(open!=null)open.close();workers.shutdownNow();}
}
