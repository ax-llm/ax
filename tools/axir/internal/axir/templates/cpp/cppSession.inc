// Included inside the runtime namespace after the transport and Core helpers.
struct AxRunControl::State {
  std::atomic<bool> aborted{false};
  std::mutex mutex;
  std::vector<Value> updates;
  std::vector<std::function<void(Value)>> listeners;
  std::string id;
  void emit(Value event) {
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
Value Core::run_control_aborted(Value control) {
  if(!Core::get(control,"__run_control_id").is_null()) {auto resolved=resolve_control(object({{"control",control}}));return Value(resolved && resolved->aborted.load());}
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
    Value call=parse_json(stringify(call_));Core::set(call,"json",std::move(payload));auto queue=queue_;auto transport=transport_;
    std::thread([queue,transport,call]()mutable{
      try {
        bool completed=false;
        IncrementalSSEDecoder decoder([&](Value event){
          auto type=display(Core::get(event,"type"));
          if(type=="response.completed"||(type=="response.incomplete"&&display(Core::get(Core::get(Core::get(event,"response"),"incomplete_details"),"reason"))=="steered"))completed=true;
          queue->push(std::move(event));return !completed && !queue->cancelled.load();
        });
        transport->stream_cancellable(call,[&](Value chunk){
          if(queue->cancelled.load())return false;
          if(Core::get(chunk,"status").is_number()){int status=static_cast<int>(num(Core::get(chunk,"status")));Value body=Core::get(chunk,"json",Core::get(chunk,"body",Core::get(chunk,"data")));if(status>=400)throw Core::as_error(Core::openai_normalize_error(status,body,call));chunk=body;}
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
  std::string model=display(Core::coalesce(Core::get(request,"model"),model_));
  if((profile_!="openai"&&profile_!="openai-responses")||model.rfind("gpt-6-astra",0)!=0||(!owned_transport_&&!session_socket_factory_))return {};
  return std::make_shared<ResponsesChatSession>(*this,std::move(request),std::move(options));
}
class SessionRun final:public AIClient {
  Value gen_,options_,state_,last_;
  AIClient* client_;
  std::shared_ptr<AIClient> selected_client_;
  bool selected_=false;
  std::shared_ptr<AxChatSession> session_;
  std::shared_ptr<AxRunControl::State> control_;
  std::shared_ptr<SessionQueue> results_=std::make_shared<SessionQueue>();
  std::string path_;
  std::size_t after_=0;
  std::vector<std::string> applied_;
  std::vector<Value> waiting_;
  bool blocking_=false;
  Value level_;
  bool fallback_started_=false;
  void emit(std::string kind,Value event=Value::object()){if(control_){Core::set(event,"type",kind);Core::set(event,"path",path_);control_->emit(event);}}
  void start(Value call){
    call=Core::chat_session_normalize_call(call);
    std::string id=display(Core::get(call,"id")),name=display(Core::get(Core::get(call,"function"),"name"));
    if(name=="__axOutput"){Core::chat_session_defer_final_call(state_,call);return;}
    if(has_key(Core::get(state_,"pending"),id))return;
    if(blocking_){if(std::none_of(waiting_.begin(),waiting_.end(),[&](const Value& item){return display(Core::get(item,"id"))==id;}))waiting_.push_back(call);return;}
    Value tool,params=Core::get(Core::get(call,"function"),"params",Value::object());
    for(const auto& candidate:array_ref(Core::get(gen_,"functions",Value::array())))if(display(Core::get(candidate,"name"))==name){tool=candidate;break;}
    std::string execution=display(Core::get(tool,"execution","blocking"));
    try{if(tool.is_null())throw AxError("validation","Function '"+name+"' not found");if(params.is_string())params=parse_json(display(params));Core::validate_fields(Core::get(tool,"args",Value::array()),params,"tool."+name+".args");Core::chat_session_validate_required_arguments(Core::get(tool,"parameters",Value::object()),params,"tool."+name+".args");}
    catch(const std::exception& error){Core::chat_session_register_call(state_,call,"blocking");Core::chat_session_record_result(gen_,state_,call,Core::get(Core::_tool_error_message_impl(call,object({{"message",error.what()}})),"result",error.what()),false);return;}
    Core::chat_session_register_call(state_,call,execution);blocking_=execution!="background";emit("tool.started",object({{"call_id",id}}));
    auto found=tool_registry().find(display(Core::get(tool,"__tool_id")));if(found==tool_registry().end())throw AxError("runtime","Unknown tool handler");
    auto handler=found->second;auto contextual=std::function<Value(Value,const AxToolContext&)>{};
    auto contextual_it=contextual_tool_registry().find(display(Core::get(tool,"__tool_id")));if(contextual_it!=contextual_tool_registry().end())contextual=contextual_it->second;
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
    if(num(Core::get(state_,"steps",0))>=num(Core::get(state_,"max_steps",10)))throw AxError("runtime","Maximum model steps exhausted before final completion");
    session_->submit(results);Value ids=Value::array();for(const auto& result:array_ref(results))Core::append(ids,Core::get(result,"function_id"));Core::chat_session_mark_submitted(state_,ids);
    for(const auto& id:applied_){Core::chat_session_transition(state_,object({{"type","update.applied"},{"id",id}}));emit("applied",object({{"update_id",id},{"timing","next-response"}}));}applied_.clear();
  }
 public:
  SessionRun(Value gen,AIClient& client,Value options):gen_(gen),options_(options),client_(&client),control_(resolve_control(options)),path_(display(Core::get(options,"execution_path",Core::get(options,"executionPath","root")))){}
  ~SessionRun() override{results_->close();if(session_)session_->close();std::lock_guard<std::mutex> lock(client_registry_mutex());client_registry().erase(pointer_id(this));}
  Value complete(Value request) override{Value response=chat(request,options_);return session_?Core::chat_session_completion(response,Core::get(state_,"response_id")):Core::chat_response_to_completion(response);}
  Value features_for_run(Value model) override{if(auto* service=dynamic_cast<AxAIService*>(client_))return service->get_features(model);return client_->features_for_run(model);}
  Value chat(Value request,Value options) override {
    try{return chat_impl(std::move(request),std::move(options));}
    catch(const AxError& error){
      if(!session_||std::string(error.what()).find("unresolved calls:")!=std::string::npos)throw;
      throw AxError(error.category,std::string(error.what())+"; unresolved calls: "+stringify(Core::chat_session_unresolved(state_)),error.type,error.status,error.code,error.retryable,error.response_body);
    }
  }
  Value chat_impl(Value request,Value options) {
    if(!selected_) {
      if(control_&&control_->aborted.load())throw AxError("runtime","Run aborted before selecting a provider");
      std::set<AIClient*> visited;
      while(true){if(!visited.insert(client_).second)throw AxError("runtime","Cyclic run routing");auto selected=client_->pin_chat_run(request,options_);if(!selected)break;selected_client_=std::move(selected);client_=selected_client_.get();}
      selected_=true;
    }
    if(!session_){if(control_&&control_->aborted.load())throw AxError("runtime","Run aborted before opening a session");if(Core::truthy(Core::chat_session_mode_enabled(options_))&&Core::truthy(Core::get(features_for_run(Core::get(request,"model")),"asyncTools",false)))session_=client_->open_chat_session(request,options);if(!session_){
        if(!fallback_started_){emit("started");fallback_started_=true;}Value updates=Value::array();
        if(control_){if(control_->aborted.load())throw AxError("runtime","Run aborted before the next model request");std::lock_guard<std::mutex> lock(control_->mutex);for(;after_<control_->updates.size();++after_){Value update=control_->updates[after_];if(Core::truthy(Core::chat_session_target_matches(Core::get(update,"target"),path_)))Core::append(updates,update);}}
        Value applied=Core::chat_session_apply_boundary_updates(request,updates,level_);level_=Core::get(applied,"level");for(const auto& id:array_ref(Core::get(applied,"applied",Value::array())))emit("applied",object({{"update_id",id},{"timing","next-response"}}));return client_->chat(Core::get(applied,"request"),options);
      }state_=Core::chat_session_create_state(Core::get(request,"model",""),path_,Core::get(options_,"maxSteps",Core::get(options_,"max_steps",10)));emit("started");}
    else{const auto& messages=array_ref(Core::get(request,"chat_prompt",Value::array()));if(!messages.empty())session_->update(object({{"type","steer"},{"text",Core::get(messages.back(),"content","")}}));submit(Value::array());}
    while(true){
      if(control_){if(control_->aborted.load())throw AxError("runtime","Run aborted; unresolved calls: "+stringify(Core::chat_session_unresolved(state_)));std::vector<Value> updates;{std::lock_guard<std::mutex> lock(control_->mutex);for(;after_<control_->updates.size();++after_){const auto& update=control_->updates[after_];if(Core::truthy(Core::chat_session_target_matches(Core::get(update,"target"),path_)))updates.push_back(update);}}
        for(const auto& update:updates){Core::chat_session_queue_update(state_,update);if(session_->update(update)=="native")Core::chat_session_native_update(state_,Core::get(update,"id"));else applied_.push_back(display(Core::get(update,"id")));}}
      Value result=results_->pop(std::chrono::milliseconds(0));
      if(!result.is_null()){Value call=Core::get(result,"call"),output=Core::get(result,"result");std::string id=display(Core::get(call,"id"));bool ok=Core::truthy(Core::get(result,"ok"));if(!ok)output=Core::get(Core::_tool_error_message_impl(call,object({{"message",Core::get(result,"error")}})),"result");
        if(!Core::truthy(Core::chat_session_record_result(gen_,state_,call,output,ok)))continue;emit("tool.completed",object({{"call_id",id}}));
        if(display(Core::get(Core::get(Core::get(state_,"pending"),id),"execution"))!="background"){blocking_=false;auto waiting=std::move(waiting_);waiting_.clear();for(const auto& call:waiting)start(call);}}
      Value event=session_->next(std::chrono::milliseconds(10));
      if(!event.is_null()){std::string type=display(Core::get(event,"type"));if(type=="response")emit("model.output",Core::chat_session_observe_output(gen_,state_,event));if(type=="steering"){Value applied=Core::chat_session_native_event(state_,event);Value id=Core::get(applied,"applied_id");if(!id.is_null())emit("applied",object({{"update_id",id},{"timing","native"}}));}if(type=="tool.call")start(Core::get(event,"call"));
        if(type=="response.completed"&&Core::truthy(Core::chat_session_complete_response(state_,Core::get(event,"response_id")))){last_=Core::get(event,"response");Value completion=Core::chat_session_completion(last_,Core::get(event,"response_id"));for(const auto& call:array_ref(Core::_response_function_calls_impl(completion)))start(call);if(Core::truthy(Core::chat_session_has_continuation_work(state_))){Core::axgen_memory_add_response(gen_,request,completion);Core::axgen_record_chat_log(gen_,request,completion);}}}
      Value action=Core::chat_session_boundary_action(state_);std::string type=display(Core::get(action,"type"));if(type=="submit")submit(Core::get(action,"results",Value::array()));else if(type=="continue")submit(Value::array());else if(type=="validate"&&!last_.is_null())return Core::chat_session_result(last_,Core::get(state_,"response_id"));
    }
  }
  void finish(std::string error=""){results_->close();if(session_){Value pending=Core::chat_session_close_state(state_);session_->close();if(error.empty())emit("completed");else emit("failed",object({{"error",error},{"pending_call_ids",pending}}));}}
};
