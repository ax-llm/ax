// Included inside the runtime namespace after the transport and Core helpers.
struct AxRunControl::State {
  std::atomic<bool> aborted{false};
  std::mutex mutex;
  std::vector<Value> updates;
  std::vector<std::function<void(Value)>> listeners;
  std::string id;
  std::shared_ptr<State> parent;
  std::function<void(Value)> relay;
  bool is_aborted() const { return aborted.load() || (parent && parent->is_aborted()); }
  State* source() { return parent ? parent->source() : this; }
  void emit(Value event) {
    if(relay){relay(parse_json(stringify(event)));return;}
    std::vector<std::function<void(Value)>> copy;
    {std::lock_guard<std::mutex> lock(mutex);copy=listeners;}
    for(auto& listener:copy) listener(parse_json(stringify(event)));
  }
};
static std::mutex control_registry_mutex;
static std::map<std::string,std::weak_ptr<AxRunControl::State>> control_registry;
static std::atomic<unsigned long> control_sequence{0};
AxRunControl::AxRunControl():state_(std::make_shared<State>()) {
  state_->id="control-"+std::to_string(++control_sequence);
  std::lock_guard<std::mutex> lock(control_registry_mutex);
  for(auto it=control_registry.begin();it!=control_registry.end();) if(it->second.expired())it=control_registry.erase(it);else ++it;
  control_registry[state_->id]=state_;
}
AxRunControl run_control(){return AxRunControl();}
Value AxRunControl::value() const{return object({{"__run_control_id",state_->id}});}
void AxRunControl::enqueue(Value update) const {
  if(state_->aborted.load())throw AxError("runtime","Run controller is aborted");
  std::string id;
  {std::lock_guard<std::mutex> lock(state_->mutex);id=std::to_string(state_->updates.size()+1);Core::set(update,"id",id);state_->updates.push_back(update);}
  state_->emit(object({{"type","queued"},{"path",Core::get(update,"target")},{"update_id",id}}));
}
void AxRunControl::steer(std::string text,std::string target) const {
  if(display(Core::string_trim(text)).empty())throw AxError("validation","Steering text must not be empty");
  enqueue(object({{"type","steer"},{"text",text},{"target",target}}));
}
void AxRunControl::set_thinking_token_budget(std::string level,std::string target) const {
  const std::set<std::string> allowed{"none","minimal","low","medium","high","highest"};
  if(!allowed.count(level))throw AxError("validation","Invalid thinking token budget");
  enqueue(object({{"type","thinking"},{"level",level},{"target",target}}));
}
void AxRunControl::abort() const {if(!state_->aborted.exchange(true))state_->emit(object({{"type","aborted"},{"path","root"}}));}
void AxRunControl::on_event(std::function<void(Value)> listener) const {std::lock_guard<std::mutex> lock(state_->mutex);state_->listeners.push_back(std::move(listener));}
static std::shared_ptr<AxRunControl::State> resolve_control(Value options) {
  Value marker=Core::get(options,"control");if(marker.is_null())return {};
  std::lock_guard<std::mutex> lock(control_registry_mutex);auto it=control_registry.find(display(Core::get(marker,"__run_control_id")));
  if(it==control_registry.end() || it->second.expired())throw AxError("validation","Run control handle has expired");return it->second.lock();
}
static std::function<bool()> agent_cancellation_check(Value options){
  auto control=resolve_control(options);
  auto token=current_cancellation_token();
  std::optional<AxCancellationToken> owned=token?std::optional<AxCancellationToken>(*token):std::nullopt;
  return [control,owned]{return (control&&control->is_aborted())||(owned&&owned->is_cancelled());};
}
Value Core::run_control_aborted(Value control) {
  if(!Core::get(control,"__run_control_id").is_null()) {auto resolved=resolve_control(object({{"control",control}}));return Value(resolved && resolved->is_aborted());}
  return Value(Core::truthy(Core::get(control,"aborted",false)));
}
struct SessionQueue {
  std::mutex mutex;std::condition_variable ready;std::deque<Value> items;std::atomic<bool> cancelled{false};
  void push(Value value){std::lock_guard<std::mutex> lock(mutex);if(cancelled.load())return;items.push_back(std::move(value));ready.notify_one();}
  Value pop(std::chrono::milliseconds timeout){std::unique_lock<std::mutex> lock(mutex);ready.wait_for(lock,timeout,[&]{return cancelled.load()||!items.empty();});if(items.empty())return {};Value item=std::move(items.front());items.pop_front();return item;}
  void close(){cancelled.store(true);ready.notify_all();}
};
struct SessionTransportCursor {std::mutex mutex;Value state=Value::object();};
class ResponsesChatSession final:public AxChatSession {
  std::shared_ptr<Transport> transport_;
  std::shared_ptr<SessionQueue> queue_=std::make_shared<SessionQueue>();
  Value call_,base_,options_,wire_=Value::object(),updates_=Value::array();
  std::deque<Value> notifications_;
  std::string model_,previous_;
  bool last_was_update_=false;
  std::shared_ptr<SessionTransportCursor> transport_cursor_=std::make_shared<SessionTransportCursor>();
  std::shared_ptr<RealtimeTransport> socket_;
  void send(Value payload) {
    Core::openai_responses_validate_session_request(payload);
    const auto& input=array_ref(Core::get(payload,"input",Value::array()));
    if(last_was_update_&&!input.empty()&&display(Core::get(input.front(),"type"))=="configuration_update")throw AxError("validation","Adjacent configuration_update items are not supported");
    last_was_update_=!input.empty()&&display(Core::get(input.back(),"type"))=="configuration_update";
    if(queue_->cancelled.load())throw AxError("runtime","Session closed");
    if(socket_){Core::map_delete(payload,"stream");Core::set(payload,"type","response.create");socket_->send(payload);return;}
    Value call=parse_json(stringify(call_));Core::set(call,"json",std::move(payload));auto queue=queue_;auto transport=transport_;auto error_options=options_;
    std::thread([queue,transport,call,error_options]()mutable{
      try {
        bool completed=false;
        IncrementalSSEDecoder decoder([&](Value event){
          auto type=display(Core::get(event,"type"));
          if(type=="response.completed"||(type=="response.incomplete"&&display(Core::get(Core::get(Core::get(event,"response"),"incomplete_details"),"reason"))=="steered"))completed=true;
          queue->push(std::move(event));return !completed && !queue->cancelled.load();
        });
        transport->stream_cancellable(call,[&](Value chunk){
          if(queue->cancelled.load())return false;
          if(Core::get(chunk,"status").is_number()){int status=static_cast<int>(num(Core::get(chunk,"status")));Value body=Core::get(chunk,"json",Core::get(chunk,"body",Core::get(chunk,"data")));if(status>=400)throw Core::as_error(Core::openai_normalize_error(status,body,call,error_options));chunk=body;}
          if(chunk.is_array()){for(const auto& event:array_ref(chunk))if(!decoder.feed("data: "+stringify(event)+"\n\n"))return false;return true;}
          return decoder.feed(chunk.is_object()?"data: "+stringify(chunk)+"\n\n":display(chunk));
        },std::shared_ptr<std::atomic<bool>>(queue,&queue->cancelled));
        if(!queue->cancelled.load()) {decoder.finish();if(!completed)throw AxError("runtime","Responses stream disconnected before completion; work was not replayed");}
      }catch(const std::exception& error){queue->push(object({{"__session_error",error.what()}}));}
    }).detach();
  }
 public:
  ResponsesChatSession(OpenAICompatibleClient& client,Value request,Value options):transport_(client.owned_transport_) {
    model_=display(Core::coalesce(Core::get(request,"model"),client.model_));
    options_=merge_usage_options(client.options_,options);
    Value config=Core::merge_model_config(client.model_config_,Core::get(request,"model_config"),options_);Core::set(config,"stream",true);
    Core::set(request,"model",model_);Core::set(request,"model_config",config);Core::set(request,"session_enabled",true);
    base_=Core::provider_build_chat_request(client.profile_,request,options_);
    call_=client.build_request(client.operation_path("stream_chat",model_),base_,true,"json",false,client.operation_method("stream_chat"));
    if(client.session_socket_factory_){std::string target=display(Core::get(call_,"url"));if(target.rfind("https:",0)==0)target.replace(0,6,"wss:");else if(target.rfind("http:",0)==0)target.replace(0,5,"ws:");socket_=client.session_socket_factory_(target,Core::get(call_,"headers",Value::object()));if(!socket_)throw AxError("runtime","Session WebSocket factory returned no transport");
      auto queue=queue_;auto socket=socket_;auto cursor=transport_cursor_;std::thread([queue,socket,cursor]{try{while(!queue->cancelled.load()){Value event;if(!socket->recv(event))throw AxError("runtime","Responses socket disconnected; work was not replayed");{std::lock_guard<std::mutex> lock(cursor->mutex);Core::openai_responses_transport_cursor(cursor->state,event);}queue->push(event);}}catch(const std::exception& error){queue->push(object({{"__session_error",error.what()}}));}catch(...){queue->push(object({{"__session_error","Session socket failed; work was not replayed"}}));}}).detach();
    }
    send(parse_json(stringify(base_)));
  }
  ~ResponsesChatSession() override{close();}
  Value next(std::chrono::milliseconds timeout) override {
    while(!queue_->cancelled.load()){
      if(!notifications_.empty()){Value event=std::move(notifications_.front());notifications_.pop_front();if(display(Core::get(event,"type"))=="response.completed"){previous_=display(Core::get(event,"response_id"));emit_usage_event("chat",Core::get(event,"response"),options_,true);}return event;}
      Value raw=queue_->pop(timeout);if(raw.is_null())return {};Value error=Core::get(raw,"__session_error");if(!error.is_null())throw AxError("runtime",display(error));
      if(display(Core::get(raw,"type"))=="response.created"){previous_=display(Core::get(Core::get(raw,"response"),"id"));}
      for(const auto& event:array_ref(Core::openai_responses_session_event(raw,wire_,model_)))notifications_.push_back(event);
    }
    throw AxError("runtime","Session closed");
  }
  void submit(Value results) override {
    Value input=parse_json(stringify(updates_));for(const auto& result:array_ref(results))Core::append(input,object({{"type","function_call_output"},{"call_id",Core::get(result,"function_id")},{"output",Core::get(result,"result","")}}));
    Value payload=parse_json(stringify(base_));Core::set(payload,"previous_response_id",previous_);Core::set(payload,"input",input);send(payload);updates_=Value::array();
  }
  std::string update(Value update) override {
    {std::lock_guard<std::mutex> lock(transport_cursor_->mutex);Value active_id=Core::get(transport_cursor_->state,"active_id");
    if(display(Core::get(update,"type"))=="steer" && socket_ && !active_id.is_null()) {socket_->send(object({{"type","response.steer"},{"previous_response_id",active_id},{"input",Value(Array{object({{"role","user"},{"content",Value(Array{object({{"type","input_text"},{"text",Core::get(update,"text")}})})}})})}}));return "native";}
    }
    if(display(Core::get(update,"type"))=="steer")Core::append(updates_,object({{"role","user"},{"content",Value(Array{object({{"type","input_text"},{"text",Core::get(update,"text")}})})}}));
    else{if(!array_ref(updates_).empty()&&display(Core::get(array_ref(updates_).back(),"type"))=="configuration_update")throw AxError("validation","Adjacent configuration_update items are not supported");Core::append(updates_,object({{"type","configuration_update"},{"reasoning",object({{"effort",Core::openai_reasoning_effort(model_,Core::get(update,"level"))}})}}));}
    return "next-response";
  }
  void close() override{if(queue_->cancelled.exchange(true))return;queue_->close();if(socket_)socket_->close();}
};
OpenAICompatibleClient& OpenAICompatibleClient::session_web_socket_factory(SessionWebSocketFactory factory){session_socket_factory_=std::move(factory);Core::set(options_,"session_web_socket_available",static_cast<bool>(session_socket_factory_));return *this;}
OpenAICompatibleClient& OpenAICompatibleClient::shared_transport(std::shared_ptr<Transport> transport){if(!transport)throw AxError("validation","Transport must not be null");owned_transport_=std::move(transport);transport_=owned_transport_.get();return *this;}
std::shared_ptr<AxChatSession> OpenAICompatibleClient::open_chat_session(Value request,Value options){
  Value resolved=resolve_model_key_request(std::move(request),std::move(options),false);
  request=Core::get(resolved,"request");options=Core::get(resolved,"options");
  std::string model=display(Core::coalesce(Core::get(request,"model"),model_));
  if((profile_!="openai"&&profile_!="openai-responses")||model.rfind("gpt-6-astra",0)!=0||(!owned_transport_&&!session_socket_factory_))return {};
  return std::make_shared<ResponsesChatSession>(*this,std::move(request),std::move(options));
}
// Runs one AxGen run through its pinned client. As in TS (axRunChatSession),
// each model request on a session-capable client opens its own native chat
// session with the request's whole prompt and closes it once that request's
// response completes: a correction or a later step opens a fresh session, and
// every session applies the run's updates again. A client without sessions
// takes the run's updates at each request boundary.
class SessionRun final:public AIClient {
  Value gen_,options_,state_,last_,request_;
  AIClient* client_;
  std::shared_ptr<AIClient> selected_client_;
  bool selected_=false;
  // The request's open native session.
  std::shared_ptr<AxChatSession> session_;
  // Whether this run's requests open native sessions, which then apply the
  // run's control updates themselves.
  bool native_opened_=false;
  // Numbers the opened sessions, so a stream closes only its own.
  std::uint64_t session_number_=0;
  std::shared_ptr<AxRunControl::State> control_;
  // The open session's tool results: a worker delivers to the session that
  // started it, and closing that session cancels its workers.
  std::shared_ptr<SessionQueue> results_=std::make_shared<SessionQueue>();
  // Items the open session has produced and not handed out (see next_item).
  std::deque<Value> items_;
  // Held while the run exists; a stream handle that outlives it does nothing.
  std::shared_ptr<char> alive_=std::make_shared<char>(0);
  std::string path_;
  // The fallback's cursor into the run's updates, and the open session's,
  // which starts over with each session.
  std::size_t after_=0,session_after_=0;
  std::vector<std::string> applied_;
  std::vector<Value> waiting_;
  bool blocking_=false;
  Value level_;
  bool started_=false;
  bool fallback_started_=false;
  bool finished_=false;
  void emit(std::string kind,Value event=Value::object()){if(control_){Core::set(event,"type",kind);Core::set(event,"path",path_);control_->emit(event);}}
  // As in TS, the run has started before its first request goes out.
  void emit_started(){if(started_)return;started_=true;emit("started");}
  void start(Value call){
    call=Core::chat_session_normalize_call(call);
    std::string id=display(Core::get(call,"id")),name=display(Core::get(Core::get(call,"function"),"name"));
    if(name=="__axOutput"){Core::chat_session_defer_final_call(state_,call);return;}
    if(has_key(Core::get(state_,"pending"),id))return;
    if(blocking_){if(std::none_of(waiting_.begin(),waiting_.end(),[&](const Value& item){return display(Core::get(item,"id"))==id;}))waiting_.push_back(call);return;}
    Value tool,params=Core::get(Core::get(call,"function"),"params",Value::object());
    for(const auto& candidate:array_ref(Core::get(gen_,"functions",Value::array())))if(display(Core::get(candidate,"name"))==name){tool=candidate;break;}
    std::string execution=display(Core::get(tool,"execution","blocking"));
    try{if(tool.is_null())throw AxError("validation","Function '"+name+"' not found");if(params.is_string())params=parse_json(display(params));}
    catch(const std::exception& error){Core::chat_session_register_call(state_,call,"blocking");Core::chat_session_record_result(gen_,state_,call,Core::get(Core::_tool_error_message_impl(call,object({{"message",error.what()}})),"result",error.what()),false);return;}
    // As TS's session does, a call whose arguments fail the tool's schema does
    // not run: its result is TS's fixing instructions.
    {Value fixing=Core::chat_session_tool_argument_error(name,Core::get(tool,"parameters",Value::object()),params);if(!fixing.is_null()){Core::chat_session_register_call(state_,call,"blocking");Core::chat_session_record_result(gen_,state_,call,fixing,false);return;}}
    Core::chat_session_register_call(state_,call,execution);blocking_=execution!="background";emit("tool.started",object({{"call_id",id}}));
    auto callbacks=registered_tool(display(Core::get(tool,"__tool_id")));auto handler=callbacks.first;auto contextual=callbacks.second;
    auto inherited=runtime_hook_frames;auto results=results_;params=parse_json(stringify(params));call=parse_json(stringify(call));Value returns=parse_json(stringify(Core::get(tool,"returns",Value::array())));
    std::thread([handler,contextual,inherited,results,params,call,returns,name,id]{
      runtime_hook_frames=inherited;
      try{
        AxToolContext context{std::shared_ptr<std::atomic<bool>>(results,&results->cancelled),id};
        Value result=invoke_runtime_tool(name,[&]{return contextual?contextual(params,context):handler(params);});
        if(Core::truthy(returns)&&result.is_object())Core::validate_fields(returns,result,"tool."+name+".return");
        results->push(object({{"call",call},{"result",result},{"ok",true}}));
      }catch(const std::exception& error){results->push(object({{"call",call},{"error",error.what()},{"ok",false}}));}
      catch(...){results->push(object({{"call",call},{"error","Tool failed with an unknown exception"},{"ok",false}}));}
      runtime_hook_frames.clear();
    }).detach();
  }
  void submit(Value results){
    if(num(Core::get(state_,"steps",0))>=num(Core::get(state_,"max_steps",25)))throw Core::as_error(Core::chat_session_step_limit_error(state_));
    session_->submit(results);Value ids=Value::array();for(const auto& result:array_ref(results))Core::append(ids,Core::get(result,"function_id"));Core::chat_session_mark_submitted(state_,ids);
    for(const auto& id:applied_){Core::chat_session_transition(state_,object({{"type","update.applied"},{"id",id}}));emit("applied",object({{"update_id",id},{"timing","next-response"}}));}applied_.clear();
  }
 public:
  SessionRun(Value gen,AIClient& client,Value options):gen_(gen),options_(options),client_(&client),control_(resolve_control(options)),path_(display(Core::get(options,"execution_path",Core::get(options,"executionPath","root")))){}
  ~SessionRun() override{alive_.reset();close_session();std::lock_guard<std::mutex> lock(client_registry_mutex());client_registry().erase(pointer_id(this));}
  Value complete(Value request) override{return Core::chat_response_to_completion(chat(request,options_));}
  Value features_for_run(Value model) override{if(auto* service=dynamic_cast<AxAIService*>(client_))return service->get_features(model);return client_->features_for_run(model);}
  // The audio output renderer's speech goes to the wrapped client.
  Value speak(Value request,Value options) override{return client_->speak(std::move(request),std::move(options));}
  // One model request: in its own native session, returning the session's
  // final response, or through the fallback's request boundary.
  Value chat(Value request,Value options) override {
    select_client(request);
    if(control_&&control_->is_aborted())throw AxError("runtime","Run aborted before opening a session");
    if(!wants_native_session(request)||!open_session(request,options))return client_->chat(boundary_request(std::move(request)),options);
    while(true){
      Value item=next_item();
      if(item.is_null())throw AxError("runtime","Chat session ended without a response");
      if(display(Core::get(item,"kind"))=="final")return Core::get(item,"response");
    }
  }
 private:
  void select_client(const Value& request){
    if(selected_)return;
    emit_started();
    if(control_&&control_->is_aborted())throw AxError("runtime","Run aborted before selecting a provider");
    std::set<AIClient*> visited;
    while(true){if(!visited.insert(client_).second)throw AxError("runtime","Cyclic run routing");auto selected=client_->pin_chat_run(request,options_);if(!selected)break;selected_client_=std::move(selected);client_=selected_client_.get();}
    selected_=true;
  }
  bool native_session_for(const Value& model){return Core::truthy(Core::chat_session_mode_enabled(options_))&&Core::truthy(Core::get(features_for_run(model),"asyncTools",false));}
  bool wants_native_session(const Value& request){return native_session_for(Core::get(request,"model"));}
  // As TS's controlsUseSession: a native chat session applies control updates
  // itself. Until the first model call opens one or not, the run options and
  // the model's features predict it, as that call decides.
  bool controls_use_session(){return native_opened_||(!fallback_started_&&native_session_for(Core::get(options_,"model")));}
  // A model call without a native session: the path's pending control updates
  // go into the request at this response boundary.
  Value boundary_request(Value request){
    emit_started();fallback_started_=true;Value updates=Value::array();
    if(control_){if(control_->is_aborted())throw AxError("runtime","Run aborted before the next model request");std::lock_guard<std::mutex> lock(control_->source()->mutex);for(;after_<control_->source()->updates.size();++after_){Value update=control_->source()->updates[after_];if(Core::truthy(Core::chat_session_target_matches(Core::get(update,"target"),path_)))Core::append(updates,update);}}
    Value applied=Core::chat_session_apply_boundary_updates(request,updates,level_);level_=Core::get(applied,"level");for(const auto& id:array_ref(Core::get(applied,"applied",Value::array())))emit("applied",object({{"update_id",id},{"timing","next-response"}}));return Core::get(applied,"request");
  }
  // Opens a fresh native session for one model request (TS's
  // axRunChatSession) with the request's whole prompt. Its state, tool
  // results, cursor into the run's updates (every session applies all of them
  // again), pending updates, waiting calls and last response start over.
  // False when the client opens none.
  bool open_session(const Value& request,const Value& options){
    auto session=client_->open_chat_session(request,options);
    if(!session)return false;
    results_=std::make_shared<SessionQueue>();items_.clear();session_after_=0;applied_.clear();waiting_.clear();blocking_=false;last_=Value();
    session_=std::move(session);native_opened_=true;++session_number_;request_=request;
    // As TS's maxResponses: the run's maxSteps (25 by default) less the request's step.
    state_=Core::chat_session_create_state(Core::get(request,"model",""),path_,Value(num(Core::get(options_,"maxSteps",Core::get(options_,"max_steps",25)))-num(Core::get(request,"_ax_step_index",0))));
    return true;
  }
  // Closes the open session. Its tool workers are cancelled, and what they
  // still deliver goes nowhere.
  void close_session(){
    items_.clear();results_->close();
    if(auto session=std::move(session_)){session_.reset();session->close();}
  }
  // Runs the open session until its next item (TS's axRunChatSession loop):
  // {kind: partial} for a partial response event, {kind: completed} for a
  // response it continues from, and {kind: final, response} for its final
  // response, after which the session closes; null once it has. An error
  // closes the session and names its unresolved calls.
  Value next_item(){
    if(items_.empty()&&!session_)return {};
    try{while(items_.empty())step();}
    catch(const AxError& error){
      std::string message=error.what();Value unresolved=Core::chat_session_unresolved(state_);close_session();
      if(message.find("unresolved calls:")!=std::string::npos)throw;
      throw AxError(error.category,message+"; unresolved calls: "+stringify(unresolved),error.type,error.status,error.code,error.retryable,error.response_body);
    }
    catch(...){close_session();throw;}
    Value item=items_.front();items_.pop_front();
    if(display(Core::get(item,"kind"))=="final")close_session();
    return item;
  }
  // One pass of the session loop: the run's new updates, a tool result, a
  // session event, then the boundary decision.
  void step(){
    if(control_){if(control_->is_aborted())throw AxError("runtime","Run aborted; unresolved calls: "+stringify(Core::chat_session_unresolved(state_)));std::vector<Value> updates;{std::lock_guard<std::mutex> lock(control_->source()->mutex);for(;session_after_<control_->source()->updates.size();++session_after_){const auto& update=control_->source()->updates[session_after_];if(Core::truthy(Core::chat_session_target_matches(Core::get(update,"target"),path_)))updates.push_back(update);}}
      for(const auto& update:updates){Core::chat_session_queue_update(state_,update);if(session_->update(update)=="native")Core::chat_session_native_update(state_,Core::get(update,"id"));else applied_.push_back(display(Core::get(update,"id")));}}
    Value result=results_->pop(std::chrono::milliseconds(0));
    if(!result.is_null()){Value call=Core::get(result,"call"),output=Core::get(result,"result");std::string id=display(Core::get(call,"id"));bool ok=Core::truthy(Core::get(result,"ok"));if(!ok)output=Core::get(Core::_tool_error_message_impl(call,object({{"message",Core::get(result,"error")}})),"result");
      if(!Core::truthy(Core::chat_session_record_result(gen_,state_,call,output,ok)))return;emit("tool.completed",object({{"call_id",id}}));
      if(display(Core::get(Core::get(Core::get(state_,"pending"),id),"execution"))!="background"){blocking_=false;auto waiting=std::move(waiting_);waiting_.clear();for(const auto& call:waiting)start(call);}}
    Value event=session_->next(std::chrono::milliseconds(10));
    if(!event.is_null()){std::string type=display(Core::get(event,"type"));
      if(type=="response"){emit("model.output",Core::chat_session_observe_output(gen_,state_,event));
        // A streamed request's partial event (see stream_source): whether the
        // session has started a tool, its unresolved calls and its turns.
        Value info=object({{"type","partial"},{"response_id",Core::get(event,"response_id")},{"calls_started",!Core::iter(Core::get(state_,"pending",Value::object())).empty()},{"pending_calls",Core::chat_session_unresolved(state_)},{"turns",Core::get(state_,"turns",Value::array())}});
        items_.push_back(object({{"kind","partial"},{"chunk",object({{"session",info},{"results",Core::get(Core::get(event,"response"),"results",Value::array())}})}}));}
      if(type=="steering"){Value applied=Core::chat_session_native_event(state_,event);Value id=Core::get(applied,"applied_id");if(!id.is_null())emit("applied",object({{"update_id",id},{"timing","native"}}));}
      if(type=="tool.call")start(Core::get(event,"call"));
      if(type=="response.completed"&&Core::truthy(Core::chat_session_complete_response(state_,Core::get(event,"response_id")))){last_=Core::get(event,"response");Value completion=Core::chat_session_completion(last_,Core::get(event,"response_id"));for(const auto& call:array_ref(Core::_response_function_calls_impl(completion)))start(call);
        // A response the session continues from goes into memory, the chat
        // log and the session's turns.
        if(Core::truthy(Core::chat_session_has_continuation_work(state_)))Core::chat_session_record_response(gen_,state_,request_,completion);
        Value info=object({{"type","completed"},{"response_id",Core::get(event,"response_id")},{"turns",Core::get(state_,"turns",Value::array())}});
        items_.push_back(object({{"kind","completed"},{"chunk",object({{"session",info}})}}));}}
    Value action=Core::chat_session_boundary_action(state_);std::string type=display(Core::get(action,"type"));if(type=="submit")submit(Core::get(action,"results",Value::array()));else if(type=="continue")submit(Value::array());
    else if(type=="validate"&&!last_.is_null()){
      // The final response carries the session's turns for the request's
      // prompt; streamed, it goes out without the __session keys.
      Value response=Core::chat_session_final_result(state_,last_),chunk=Value::object();
      for(const auto& key:Core::iter(response)){std::string name=display(key);if(name.rfind("__session",0)!=0)Core::set(chunk,name,Core::get(response,name));}
      Core::set(chunk,"session",object({{"type","final"},{"response_id",Core::get(state_,"response_id")},{"turns",Core::get(state_,"turns",Value::array())}}));
      items_.push_back(object({{"kind","final"},{"response",response},{"chunk",chunk}}));
    }
  }
 public:
  // The path's pending control updates, which the forward applies when a step
  // starts, as TS does: the cursor moves past them, so the next request
  // boundary skips them, and each one is applied now. None under a native
  // chat session, which applies them itself.
  Value take_control_updates(){
    Value updates=Value::array();
    if(!control_||controls_use_session())return updates;
    emit_started();fallback_started_=true;
    {std::lock_guard<std::mutex> lock(control_->source()->mutex);for(;after_<control_->source()->updates.size();++after_){const Value& update=control_->source()->updates[after_];if(Core::truthy(Core::chat_session_target_matches(Core::get(update,"target"),path_)))Core::append(updates,clone_usage_value(update));}}
    for(const auto& update:array_ref(updates)){if(display(Core::get(update,"type"))!="steer")level_=Core::get(update,"level");emit("applied",object({{"update_id",Core::get(update,"id")},{"timing","next-response"}}));}
    return updates;
  }
  // How many of the path's updates are pending, with no side effects.
  std::size_t pending_control_count(){
    if(!control_||controls_use_session())return 0;
    std::lock_guard<std::mutex> lock(control_->source()->mutex);std::size_t count=0;
    for(std::size_t index=after_;index<control_->source()->updates.size();++index)if(Core::truthy(Core::chat_session_target_matches(Core::get(control_->source()->updates[index],"target"),path_)))++count;
    return count;
  }
  // How a streamed model call goes out (see ai_stream_open). In its own native
  // session it yields the session's items as they happen, shaped for the
  // streaming forward: each partial response event with its results, each
  // response the session continues from, and the final response; closing the
  // stream closes the session. Otherwise it streams from the selected service
  // with request rewritten as chat() would send it, or, when no service can
  // or no session opened, chat() answers it as one chunk.
  SessionStreamSource stream_source(Value& request,const Value& options){
    select_client(request);
    if(control_&&control_->is_aborted())throw AxError("runtime","Run aborted before opening a session");
    bool native=wants_native_session(request);
    if(native&&open_session(request,options)){
      std::weak_ptr<char> alive=alive_;std::uint64_t number=session_number_;
      auto pull=[this,alive,number]()->Value{
        if(!alive.lock()||number!=session_number_)return {};
        Value item=next_item();
        return item.is_null()?item:Core::get(item,"chunk");
      };
      auto close=[this,alive,number]{if(alive.lock()&&number==session_number_)close_session();};
      return {nullptr,pull,close};
    }
    auto* service=dynamic_cast<AxAIService*>(client_);
    if(!native&&service!=nullptr){request=boundary_request(std::move(request));return {service,{},{}};}
    auto answer=std::make_shared<Value>(client_->chat(boundary_request(std::move(request)),options));
    return {nullptr,[answer]{Value chunk=*answer;*answer=Value();return chunk;},{}};
  }
  // Ends the run: closes a session still open, records the unresolved calls
  // of the last session's state, and reports the run. A run its streaming
  // consumer stopped early ends with an aborted event rather than failed; any
  // other run as failed or completed.
  void finish(std::optional<std::string> error=std::nullopt,bool consumer_stopped=false){if(finished_)return;finished_=true;close_session();Value pending=Value::array();if(!state_.is_null()){Core::chat_session_record_unresolved(gen_,state_);pending=Core::chat_session_close_state(state_);}if(consumer_stopped)emit("aborted");else if(!error)emit("completed");else emit("failed",object({{"error",*error},{"pending_call_ids",pending}}));}
};

// A streamed model call in a run session goes out as the session decides (see
// SessionRun::stream_source); any other client streams on its own.
static SessionStreamSource session_stream_source(AIClient* client, Value& request, const Value& options) {
  auto* session = dynamic_cast<SessionRun*>(client);
  return session == nullptr ? SessionStreamSource{} : session->stream_source(request, options);
}

// A run control's pending updates reach the forward through the run's request
// boundary (SessionRun): the forward applies them when a step starts and
// takes another step while any are pending. Any other client has none.
Value Core::ai_control_take_pending(Value client) {
  auto* run = dynamic_cast<SessionRun*>(registered_client(display(get(client, "__client_id"))));
  return run == nullptr ? Value::array() : run->take_control_updates();
}
Value Core::ai_control_pending_count(Value client) {
  auto* run = dynamic_cast<SessionRun*>(registered_client(display(get(client, "__client_id"))));
  return Value(static_cast<double>(run == nullptr ? 0 : run->pending_control_count()));
}

Value Core::flow_dispatch_group(Value flow,Value client,Value plans,Value state,Value options) {
  auto* source=registered_client(display(get(client,"__client_id")));if(!source)return {};
  std::shared_ptr<OwnedFlowPrograms> ownership;
  {std::lock_guard<std::mutex> lock(owned_flows_mutex);auto it=owned_flows.find(display(get(flow,"__owned_flow_id")));if(it!=owned_flows.end())ownership=it->second.lock();}
  if(!ownership)return {};
  struct Task{int index;std::shared_ptr<AIClient> client;std::shared_ptr<AxProgram> program;Value flow,step,plan,state,options;std::shared_ptr<AxCancellationToken> token;std::shared_ptr<AxRunControl::State> control;};
  auto parent=resolve_control(options);const auto* parent_token=current_cancellation_token();auto queue=std::make_shared<SessionQueue>();
  std::vector<Task> tasks;auto steps=get(flow,"steps");
  for(const auto& plan:array_ref(plans)){
    int index=static_cast<int>(num(get(plan,"stepIndex")));auto step=get(steps,index);
    if(display(get(step,"kind","execute"))!="execute")return {};
    auto* program=registered_stage(display(get(get(step,"program"),"__agent_stage_id")));if(!program)return {};
    auto program_factory=program->owned_worker_factory();auto client_factory=source->owned_worker_factory();if(!program_factory||!client_factory)return {};
    auto owned_program=program_factory();auto owned_client=client_factory();if(!owned_program||!owned_client)return {};
    auto owned_flow=parse_json(stringify(flow));auto owned_step=parse_json(stringify(step));set(owned_step,"program",agent_stage_ref(*owned_program));
    auto control=std::make_shared<AxRunControl::State>();control->id="control-"+std::to_string(++control_sequence);control->parent=parent;control->relay=[queue](Value event){queue->push(object({{"event",std::move(event)}}));};
    {std::lock_guard<std::mutex> lock(control_registry_mutex);control_registry[control->id]=control;}
    auto owned_options=parse_json(stringify(options));set(owned_options,"control",object({{"__run_control_id",control->id}}));
    tasks.push_back({index,std::move(owned_client),std::move(owned_program),owned_flow,owned_step,parse_json(stringify(plan)),parse_json(stringify(state)),owned_options,std::make_shared<AxCancellationToken>(),control});
  }
  for(std::size_t position=0;position<tasks.size();++position){auto task=tasks[position];std::thread([task,position,queue]()mutable{
    Value report;
    try{AxCancellationScope scope(task.token.get());report=Core::flow_execute_owned_worker(task.flow,task.step,task.plan,Core::client_ref(*task.client),task.state,task.options);}
    catch(const std::exception& error){report=object({{"error",error.what()}});}catch(...){report=object({{"error","Flow worker failed"}});}
    // Serialize delivery: Value containers are never shared with the owner while a worker can mutate them.
    queue->push(object({{"position",static_cast<int>(position)},{"report",parse_json(stringify(report))}}));
  }).detach();}
  std::vector<Value> reports(tasks.size());std::set<std::string> pending;std::size_t remaining=tasks.size();
  std::optional<std::chrono::steady_clock::time_point> deadline;
  auto cancel=[&]{if(!deadline){deadline=std::chrono::steady_clock::now()+std::chrono::milliseconds(100);for(auto& task:tasks)task.token->cancel("Flow group cancelled");}};
  try {
    while(remaining){
      if((parent&&parent->is_aborted())||(parent_token&&parent_token->is_cancelled()))cancel();
      auto delivery=queue->pop(std::chrono::milliseconds(20));auto event=get(delivery,"event");
      if(!event.is_null()){
        auto key=display(get(event,"path"))+":"+display(get(event,"call_id"));auto type=display(get(event,"type"));
        if(type=="tool.started")pending.insert(key);if(type=="tool.completed"||type=="tool.failed")pending.erase(key);
        if(parent)parent->emit(event);
      } else if(!delivery.is_null()){
        auto position=static_cast<std::size_t>(num(get(delivery,"position")));if(position>=reports.size())throw AxError("runtime","Invalid flow worker delivery");
        if(reports[position].is_null()){
          reports[position]=get(delivery,"report");--remaining;
          if(!get(reports[position],"error").is_null())cancel();
          else{ownership->push_back(tasks[position].program);auto step=get(steps,tasks[position].index);set(step,"program",agent_stage_ref(*tasks[position].program));}
        }
      }
      if(deadline&&std::chrono::steady_clock::now()>=*deadline){
        for(std::size_t i=0;i<reports.size();++i)if(reports[i].is_null()){std::string unresolved;for(const auto& id:pending)unresolved+=id+" ";reports[i]=object({{"error","Flow cancelled; unresolved node: "+display(get(tasks[i].step,"name"))+"; unresolved calls: "+unresolved}});--remaining;}
      }
    }
  }catch(...){cancel();queue->close();throw;}
  for(auto& task:tasks)task.token->cancel("Flow dispatcher closed");queue->close();return Value(Array(reports.begin(),reports.end()));
}
