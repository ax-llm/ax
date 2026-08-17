#include "mcp.hpp"

#include <algorithm>
#include <array>
#include <chrono>
#include <cstring>

#if defined(AXLLM_ENABLE_CURL)
#include <curl/curl.h>
#endif

namespace axllm {

static Object as_object_local(Value value) {
  if (auto p = std::get_if<std::shared_ptr<Object>>(&value.data)) return **p;
  return {};
}

static Array as_array_local(Value value) {
  if (auto p = std::get_if<std::shared_ptr<Array>>(&value.data)) return **p;
  return {};
}

static bool value_has(Value object_value, const std::string& key) {
  auto obj = as_object_local(object_value);
  return obj.find(key) != obj.end();
}

static void value_erase(Value& object_value,const std::string& key){if(auto p=std::get_if<std::shared_ptr<Object>>(&object_value.data))(**p).erase(key);}

static long mcp_now_ms(){return static_cast<long>(std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count());}

static Value cursor_params(const std::string& cursor) {
  if (cursor.empty()) return Value::object();
  return object({{"cursor", cursor}});
}

static std::string safe_name(const std::string& value) {
  std::string out;
  bool last_sep = false;
  for (char ch : value) {
    if (std::isalnum(static_cast<unsigned char>(ch))) {
      out.push_back(ch);
      last_sep = false;
    } else if (!last_sep) {
      out.push_back('_');
      last_sep = true;
    }
  }
  while (!out.empty() && out.front() == '_') out.erase(out.begin());
  while (!out.empty() && out.back() == '_') out.pop_back();
  return out.empty() ? "item" : out;
}

static std::string content_text(Value content) {
  std::vector<std::string> parts;
  for (const auto& item : as_array_local(content)) {
    if (display(Core::get(item, "type", "")) == "text") parts.push_back(display(Core::get(item, "text", "")));
  }
  std::ostringstream out;
  for (size_t i = 0; i < parts.size(); ++i) {
    if (i > 0) out << "\n";
    out << parts[i];
  }
  return out.str();
}

static void expect_subset_local(Value actual, Value expected, const std::string& label) {
  if (expected.is_null()) return;
  if (expected.is_object()) {
    auto a = as_object_local(actual);
    for (const auto& kv : as_object_local(expected)) {
      if (kv.first == "__order") continue;
      if (!a.count(kv.first)) throw AxError("fixture", label + " missing key " + kv.first);
      expect_subset_local(a[kv.first], kv.second, label + "." + kv.first);
    }
    return;
  }
  if (expected.is_array()) {
    auto a = as_array_local(actual);
    auto e = as_array_local(expected);
    if (a.size() < e.size()) throw AxError("fixture", label + " list length mismatch");
    for (size_t i = 0; i < e.size(); ++i) expect_subset_local(a[i], e[i], label);
    return;
  }
  if (!equal(actual, expected)) throw AxError("fixture", label + " mismatch");
}

static std::map<std::string,std::string>& ax_mcp_client_era_cache(){static std::map<std::string,std::string> cache;return cache;}

AxMCPClient::AxMCPClient(std::shared_ptr<AxMCPTransport> transport, Value options)
    : transport_(std::move(transport)), options_(std::move(options)) { transport_->set_message_handler([this](Value message){if(era_=="modern"){std::string active;{std::lock_guard<std::mutex> lock(subscription_mutex_);active=active_subscription_id_;}auto filtered=Core::mcp_notification_subscription_filter(message,active);if(!Core::truthy(Core::get(filtered,"deliver",false)))return;message=Core::get(filtered,"message",Value::object());if(Core::truthy(Core::get(filtered,"acknowledged",false))){{std::lock_guard<std::mutex> lock(subscription_mutex_);subscription_ready_=true;}subscription_condition_.notify_all();}}auto method=display(Core::get(message,"method",""));if(method=="notifications/tools/list_changed"||method=="notifications/prompts/list_changed"||method=="notifications/resources/list_changed")refresh();if(method=="notifications/resources/updated"){auto uri=display(Core::get(Core::get(message,"params",Value::object()),"uri",""));if(!uri.empty())value_erase(resource_read_cache_,uri);}emit_notification(std::move(message));});transport_->set_request_handler([this](Value request){return handle_server_request(std::move(request));});transport_->set_lifecycle_handler([this](std::string state){emit_lifecycle(state);}); }

void AxMCPClient::init() {
  if(initialized_)return;
  auto sampling=Core::get(options_,"sampling",Value());if(!sampling.is_null()&&Core::truthy(sampling))throw AxError("mcp","MCP sampling is not supported by the generated C++ client");
  transport_->connect();
  auto& era_cache=ax_mcp_client_era_cache();auto configured=display(Core::get(options_,"era","auto"));auto key=transport_->era_cache_key();auto cached=era_cache[key];auto stored=Core::get(Core::get(options_,"eraStore",Value::object()),key,"");auto resolution=Core::mcp_resolve_known_era(configured,transport_->era_hint(),cached,stored);auto resolved=display(Core::get(resolution,"era","modern"));
  if(!Core::truthy(Core::get(resolution,"probe",false))){if(resolved=="legacy")initialize_legacy();else{apply_era("modern");apply_discovery(request_discovery());refresh();}remember_era(resolved);initialized_=true;if(resolved=="legacy")transport_->start_listening();return;}
  apply_era("modern");try{apply_discovery(request_discovery());}catch(const AxError& error){if(error.code=="-32022")throw;initialize_legacy();remember_era("legacy");initialized_=true;transport_->start_listening();return;}remember_era("modern");refresh();initialized_=true;
}

void AxMCPClient::initialize_legacy(){
  apply_era("legacy");
  Value result = request("initialize", object({
      {"protocolVersion", display(Core::get(options_, "protocolVersion", AX_MCP_PROTOCOL_VERSION))},
      {"capabilities", client_capabilities()},
      {"clientInfo", object({{"name", "AxMCPClient"}, {"title", "Ax MCP Client"}, {"version", "1.0.0"}})},
  }));
  negotiated_protocol_version_ = display(Core::get(result, "protocolVersion", ""));
  bool supported = negotiated_protocol_version_ == "2026-07-28" || negotiated_protocol_version_ == "2025-11-25" || negotiated_protocol_version_ == "2025-06-18" ||
                   negotiated_protocol_version_ == "2025-03-26" || negotiated_protocol_version_ == "2024-11-05";
  if (!supported) throw AxError("mcp", "Unsupported MCP protocol version " + negotiated_protocol_version_);
  transport_->set_protocol_version(negotiated_protocol_version_);
  server_capabilities_ = Core::get(result, "capabilities", Value::object());
  server_info_ = Core::get(result, "serverInfo", Value::object());
  negotiate_extensions();
  notify("notifications/initialized");
  refresh();
}

void AxMCPClient::apply_era(const std::string& era){era_=era;transport_->set_era(era);if(era=="modern"){negotiated_protocol_version_="2026-07-28";transport_->set_protocol_version(negotiated_protocol_version_);}else negotiated_protocol_version_.clear();}
void AxMCPClient::remember_era(const std::string& era){auto key=transport_->era_cache_key();if(!key.empty())ax_mcp_client_era_cache()[key]=era;}
Value AxMCPClient::request_discovery(){return request("server/discover",Value::object());}
void AxMCPClient::apply_discovery(Value result){auto classified=Core::mcp_classify_discovery_result(result);if(!Core::truthy(Core::get(classified,"valid",false)))throw AxError("mcp","Invalid MCP server/discover result");discover_result_=result;server_capabilities_=Core::get(classified,"capabilities",Value::object());auto info=Core::get(classified,"serverInfo",Value());if(!info.is_null())server_info_=info;negotiate_extensions();}
void AxMCPClient::negotiate_extensions(){negotiated_extensions_=Core::mcp_negotiate_extensions(Core::get(client_capabilities(),"extensions",Value::object()),Core::get(server_capabilities_,"extensions",Value::object()));}
Value AxMCPClient::discover(){init();if(era_!="modern")throw AxError("mcp","server/discover is only available for modern MCP");auto result=request_discovery();apply_discovery(result);return result;}

void AxMCPClient::close(){initialized_=false;{std::lock_guard<std::mutex> lock(subscription_mutex_);active_subscription_id_.clear();}transport_->close_request_stream();subscription_owners_.clear();catalog_cache_=Value::object();resource_read_cache_=Value::object();transport_->close();}

void AxMCPClient::refresh(){refresh(true);}
void AxMCPClient::refresh(bool force) {
  bool changed=false;
  if (capability("tools")&&(force||!catalog_cache_fresh("tools"))) {tools_.clear();for(auto tool:collect_catalog("tools/list","tools")){try{Core::mcp_param_header_bindings(Core::get(tool,"inputSchema",Value::object()));tools_.push_back(tool);}catch(const std::exception&){}}changed=true;}
  if (capability("prompts")&&(force||!catalog_cache_fresh("prompts"))){prompts_=collect_catalog("prompts/list","prompts");changed=true;}
  if (capability("resources")) {
    if(force||!catalog_cache_fresh("resources")){resources_=collect_catalog("resources/list","resources");changed=true;}
    if(force||!catalog_cache_fresh("resourceTemplates")){resource_templates_=collect_catalog("resources/templates/list","resourceTemplates");changed=true;}
  }
  if(changed)++catalog_revision_;
}

std::vector<Value> AxMCPClient::collect_catalog(const std::string& method,const std::string& field){std::vector<Value> out;Value pages=Value::array();std::string cursor;std::set<std::string> seen;auto max_pages=static_cast<int>(Core::number(Core::get(options_,"maxPaginationPages",1000)));for(int page=0;page<max_pages;++page){auto result=request(method,cursor_params(cursor));Core::append(pages,result);for(auto item:as_array_local(Core::get(result,field,Value::array())))out.push_back(item);cursor=display(Core::get(result,"nextCursor",""));if(cursor.empty()){std::map<std::string,std::string> names={{"tools/list","tools"},{"prompts/list","prompts"},{"resources/list","resources"},{"resources/templates/list","resourceTemplates"}};auto found=names.find(method);if(found!=names.end())Core::set(catalog_cache_,found->second,Core::mcp_fold_cache_info(pages,mcp_now_ms()));return out;}if(!seen.insert(cursor).second)throw AxError("mcp","MCP "+method+" repeated pagination cursor "+cursor);}throw AxError("mcp","MCP "+method+" exceeded pagination limit");}
bool AxMCPClient::catalog_cache_fresh(const std::string& name)const{return Core::truthy(Core::mcp_cache_freshness(Core::get(catalog_cache_,name,Value()),mcp_now_ms()));}

AxMCPCatalogSnapshot AxMCPClient::inspect_catalog(bool refresh_catalog){init();if(refresh_catalog)refresh();AxMCPCatalogSnapshot out;out.namespace_name=namespace_name();out.protocol_version=negotiated_protocol_version_;out.revision=catalog_revision_;out.server_info=server_info_;out.server_capabilities=server_capabilities_;out.tools=Value(Array(tools_.begin(),tools_.end()));out.prompts=Value(Array(prompts_.begin(),prompts_.end()));out.resources=Value(Array(resources_.begin(),resources_.end()));out.resource_templates=Value(Array(resource_templates_.begin(),resource_templates_.end()));for(const auto& item:subscription_owners_)out.subscriptions.push_back(item.first);return out;}

std::string AxMCPClient::protocol_version() const { return negotiated_protocol_version_; }
Value AxMCPClient::ping() { return request("ping"); }
Value AxMCPClient::list_tools(const std::string& cursor) { return request("tools/list", cursor_params(cursor)); }
Value AxMCPClient::call_tool(const std::string& name, Value arguments) {auto params=object({{"name",name},{"arguments",arguments}});Value result;try{result=request_with_input_rounds("tools/call",params,tool_headers(name,arguments));}catch(const AxError& error){if(era_!="modern"||error.code!="-32020")throw;tools_.clear();for(auto tool:collect_catalog("tools/list","tools")){try{Core::mcp_param_header_bindings(Core::get(tool,"inputSchema",Value::object()));tools_.push_back(tool);}catch(const std::exception&){}}result=request_with_input_rounds("tools/call",params,tool_headers(name,arguments));}if(display(Core::get(result,"resultType",""))!="task")return result;if(!has_tasks_capability())throw AxError("mcp","MCP protocol violation: server returned a task without negotiating io.modelcontextprotocol/tasks");if(!Core::truthy(Core::mcp_validate_modern_task(result)))throw AxError("mcp","MCP protocol violation: invalid CreateTaskResult");return await_modern_task(display(Core::get(result,"taskId","")));}
Value AxMCPClient::await_modern_task(const std::string& task_id){auto max=static_cast<int>(Core::number(Core::get(options_,"maxTaskPolls",1000)));for(int poll=0;poll<max;++poll){auto outcome=Core::mcp_task_terminal_outcome(get_task(task_id));auto kind=display(Core::get(outcome,"kind",""));if(kind=="result")return Core::json_parse(Core::json_stringify(Core::get(outcome,"result",Value::object())));if(kind=="protocol_error")throw AxError("mcp",display(Core::get(outcome,"message","MCP task failed")),"",0,display(Core::get(outcome,"code",0)),false);if(kind=="violation"||kind=="failure"||kind=="cancelled")throw AxError("mcp",display(Core::get(outcome,"message","MCP task failed")));if(kind=="input_required"){auto fulfillment=Core::mcp_mrtr_plan_fulfillment(Core::get(outcome,"inputRequests",Value::object()),Core::get(options_,"roots",Value()),static_cast<bool>(elicitation_handler_),false);if(!Core::truthy(Core::get(fulfillment,"ok",false)))throw AxError("mcp",display(Core::get(fulfillment,"message","MCP protocol violation")));auto responses=Core::get(fulfillment,"responses",Value::object());for(auto entry:as_object_local(Core::get(fulfillment,"pending",Value::object()))){if(entry.first=="__order")continue;auto method=display(Core::get(entry.second,"method",""));if(!elicitation_handler_||method!="elicitation/create")throw AxError("mcp","MCP protocol violation: unsupported pending task input request method "+method);Core::set(responses,entry.first,elicitation_handler_(Core::get(entry.second,"params",Value::object()),object({{"client","AxMCPClient"},{"namespace",namespace_name()}})));}provide_task_input(task_id,responses);}}throw AxError("mcp","MCP task "+task_id+" exceeded "+std::to_string(max)+" polls");}
Value AxMCPClient::tool_headers(const std::string& name,Value arguments)const{if(era_!="modern")return Value::object();for(auto tool:tools_)if(display(Core::get(tool,"name",""))==name){auto bindings=Core::mcp_param_header_bindings(Core::get(tool,"inputSchema",Value::object()));return Core::mcp_param_header_values(bindings,arguments);}return Value::object();}
Value AxMCPClient::list_prompts(const std::string& cursor) { return request("prompts/list", cursor_params(cursor)); }
Value AxMCPClient::get_prompt(const std::string& name, Value arguments) { return request_with_input_rounds("prompts/get", object({{"name", name}, {"arguments", arguments}}),Value::object()); }
Value AxMCPClient::list_resources(const std::string& cursor) { return request("resources/list", cursor_params(cursor)); }
Value AxMCPClient::read_resource(const std::string& uri) {bool enabled=era_=="modern"&&Core::truthy(Core::get(options_,"readCache",false));if(enabled){auto cached=Core::get(resource_read_cache_,uri,Value());if(!cached.is_null()&&Core::truthy(Core::mcp_cache_freshness(Core::get(cached,"cache",Value()),mcp_now_ms())))return Core::json_parse(Core::json_stringify(Core::get(cached,"result",Value::object())));value_erase(resource_read_cache_,uri);}auto result=request_with_input_rounds("resources/read",object({{"uri",uri}}),Value::object());if(enabled){auto cache=Core::mcp_fold_cache_info(array({result}),mcp_now_ms());if(Core::truthy(Core::mcp_cache_freshness(cache,mcp_now_ms())))Core::set(resource_read_cache_,uri,object({{"result",Core::json_parse(Core::json_stringify(result))},{"cache",cache}}));}return result;}
Value AxMCPClient::acquire_resource_subscription(const std::string& uri,const std::string& owner){if(!Core::truthy(Core::get(Core::get(server_capabilities_,"resources",Value::object()),"subscribe",false)))throw AxError("mcp","Resource subscriptions are not supported");Value current=Value::array();for(const auto& value:subscription_owners_[uri])Core::append(current,value);auto transition=Core::mcp_resource_subscription_ownership(current,owner,"acquire");std::set<std::string> owners;for(const auto& value:Core::iter(Core::get(transition,"owners",Value::array())))owners.insert(display(value));subscription_owners_[uri]=std::move(owners);if(era_=="modern"){if(Core::truthy(Core::get(transition,"changed",false))&&!active_subscription_id_.empty())start_listening();return Value::object();}return display(Core::get(transition,"wireAction","none"))=="subscribe"?request("resources/subscribe",object({{"uri",uri}})):Value::object();}
Value AxMCPClient::release_resource_subscription(const std::string& uri,const std::string& owner){if(!Core::truthy(Core::get(Core::get(server_capabilities_,"resources",Value::object()),"subscribe",false)))throw AxError("mcp","Resource subscriptions are not supported");Value current=Value::array();auto found=subscription_owners_.find(uri);if(found!=subscription_owners_.end())for(const auto& value:found->second)Core::append(current,value);auto transition=Core::mcp_resource_subscription_ownership(current,owner,"release");std::set<std::string> owners;for(const auto& value:Core::iter(Core::get(transition,"owners",Value::array())))owners.insert(display(value));if(owners.empty())subscription_owners_.erase(uri);else subscription_owners_[uri]=std::move(owners);if(era_=="modern"){if(Core::truthy(Core::get(transition,"changed",false))&&!active_subscription_id_.empty())start_listening();return Value::object();}return display(Core::get(transition,"wireAction","none"))=="unsubscribe"?request("resources/unsubscribe",object({{"uri",uri}})):Value::object();}
void AxMCPClient::restore_resource_subscriptions(){if(era_=="modern"){if(!active_subscription_id_.empty())start_listening();return;}for(const auto& item:subscription_owners_)request("resources/subscribe",object({{"uri",item.first}}));}
void AxMCPClient::start_listening(){init();if(era_!="modern"){transport_->start_listening();return;}transport_->close_request_stream();auto id="listen-"+std::to_string(next_id_++);Value uris=Value::array();for(const auto& item:subscription_owners_)Core::append(uris,item.first);auto notifications=Core::mcp_listen_interests(uris,Core::get(options_,"subscriptionFilters",Value::object()));auto meta=Core::mcp_build_request_meta(Value::object(),negotiated_protocol_version_,client_capabilities(),object({{"name","AxMCPClient"},{"title","Ax MCP Client"},{"version","1.0.0"}}),Core::get(options_,"logLevel",Value()),Value(),Value());{std::lock_guard<std::mutex> lock(subscription_mutex_);active_subscription_id_=id;subscription_ready_=false;}transport_->open_request_stream(object({{"jsonrpc","2.0"},{"id",id},{"method","subscriptions/listen"},{"params",object({{"notifications",notifications},{"_meta",meta}})}}));std::unique_lock<std::mutex> lock(subscription_mutex_);auto timeout=static_cast<long>(Core::number(Core::get(options_,"listenAckTimeoutMs",2000)));if(!subscription_condition_.wait_for(lock,std::chrono::milliseconds(timeout),[this]{return subscription_ready_;}))throw AxError("mcp","subscriptions/listen acknowledgement timed out");}
Value AxMCPClient::subscribe_resource(const std::string& uri) { return acquire_resource_subscription(uri,"manual"); }
Value AxMCPClient::unsubscribe_resource(const std::string& uri) { return release_resource_subscription(uri,"manual"); }
bool AxMCPClient::has_tasks_capability()const{return era_=="modern"?value_has(negotiated_extensions_,"io.modelcontextprotocol/tasks"):capability("tasks");}
Value AxMCPClient::get_task(const std::string& task_id) {if(!has_tasks_capability())throw AxError("mcp","Tasks are not supported");auto result=request("tasks/get",object({{"taskId",task_id}}));if(era_=="modern"&&!Core::truthy(Core::mcp_validate_modern_task(result)))throw AxError("mcp","MCP protocol violation: invalid tasks/get result");return result;}
Value AxMCPClient::cancel_task(const std::string& task_id) {if(!has_tasks_capability())throw AxError("mcp","Tasks are not supported");auto result=request("tasks/cancel",object({{"taskId",task_id}}));return era_=="modern"?Value::object():result;}
Value AxMCPClient::list_tasks(const std::string& cursor){if(era_=="modern")throw AxError("mcp","tasks/list is only available for legacy MCP tasks");if(!has_tasks_capability())throw AxError("mcp","Tasks are not supported");return request("tasks/list",cursor_params(cursor));}
Value AxMCPClient::get_task_result(const std::string& task_id){if(era_=="modern")throw AxError("mcp","tasks/result is only available for legacy MCP tasks; modern results are embedded in tasks/get");if(!has_tasks_capability())throw AxError("mcp","Tasks are not supported");return request("tasks/result",object({{"taskId",task_id}}));}
void AxMCPClient::provide_task_input(const std::string& task_id,Value input_responses){if(era_!="modern"||!has_tasks_capability())throw AxError("mcp","tasks/update is only available for modern MCP Tasks v2");request("tasks/update",object({{"taskId",task_id},{"inputResponses",input_responses}}));}
Value AxMCPClient::list_resource_templates(const std::string& cursor) { return request("resources/templates/list", cursor_params(cursor)); }

void AxMCPClient::notify(const std::string& method, Value params) {
  if(era_=="modern"&&(method=="notifications/initialized"||method=="notifications/roots/list_changed"||method=="notifications/cancelled"))return;
  Value message = object({{"jsonrpc", "2.0"}, {"method", method}});
  if (!params.is_null()) Core::set(message, "params", params);
  transport_->send_notification(message);
}

void AxMCPClient::cancel_request(Value request_id, const std::string& reason) {
  Value params = object({{"requestId", request_id}});
  if (!reason.empty()) Core::set(params, "reason", reason);
  notify("notifications/cancelled", params);
}

Value AxMCPClient::request(const std::string& method, Value params) {
  return request_with_headers(method,params,Value::object(),true);
}

void AxMCPClient::set_elicitation_handler(std::function<Value(Value,Value)> handler){elicitation_handler_=std::move(handler);}

Value AxMCPClient::request_with_input_rounds(const std::string& method,Value base_params,Value headers){auto params=Core::json_parse(Core::json_stringify(base_params));auto max_rounds=Core::get(options_,"maxInputRounds",Value());for(int round=0;;++round){auto result=request_with_headers(method,params,headers,true);auto plan=Core::mcp_mrtr_plan_round(result,era_.empty()?"legacy":era_,method,round,max_rounds);auto action=display(Core::get(plan,"action",""));if(action=="complete")return result;if(action=="violation")throw AxError("mcp",display(Core::get(plan,"message","MCP protocol violation")));Value input_responses;auto requests=Core::get(plan,"inputRequests",Value());if(Core::truthy(Core::get(plan,"hasInputRequests",false))&&requests.is_object()){auto fulfillment=Core::mcp_mrtr_plan_fulfillment(requests,Core::get(options_,"roots",Value()),static_cast<bool>(elicitation_handler_),false);if(!Core::truthy(Core::get(fulfillment,"ok",false)))throw AxError("mcp",display(Core::get(fulfillment,"message","MCP protocol violation")));auto responses=Core::get(fulfillment,"responses",Value::object());for(auto entry:as_object_local(Core::get(fulfillment,"pending",Value::object()))){if(entry.first=="__order")continue;auto pending_method=display(Core::get(entry.second,"method",""));if(pending_method!="elicitation/create")throw AxError("mcp","MCP protocol violation: unsupported pending MRTR input request method "+pending_method);Core::set(responses,entry.first,elicitation_handler_(Core::get(entry.second,"params",Value::object()),object({{"namespace",namespace_name()}})));}input_responses=responses;}Value request_state;if(Core::truthy(Core::get(plan,"hasRequestState",false)))request_state=Core::get(plan,"requestState",Value());params=Core::mcp_mrtr_next_params(base_params,input_responses,request_state);}}

Value AxMCPClient::request_with_headers(const std::string& method,Value params,Value headers,bool allow_version_retry){
  Value message = object({{"jsonrpc", "2.0"}, {"id", std::to_string(next_id_++)}, {"method", method}});
  Value request_params=parse_json(stringify(params));if(era_=="modern"){if(!request_params.is_object())request_params=Value::object();auto meta=Core::mcp_build_request_meta(Core::get(request_params,"_meta",Value::object()),negotiated_protocol_version_,client_capabilities(),object({{"name","AxMCPClient"},{"title","Ax MCP Client"},{"version","1.0.0"}}),Core::get(options_,"logLevel",Value()),Value(),Value());Core::set(request_params,"_meta",meta);}
  if (!params.is_null()) Core::set(message, "params", request_params);
  Value response = transport_->send_with_headers(message,headers);
  Value error = Core::get(response, "error", Value());
  if (!error.is_null()){auto code=display(Core::get(error,"code",0));if(era_=="modern"&&allow_version_retry&&code=="-32022"){auto supported=array({"2026-07-28","2025-11-25","2025-06-18","2025-03-26","2024-11-05"});auto version=display(Core::mcp_select_mutual_version(Core::get(error,"data",Value()),supported));if(!version.empty()){negotiated_protocol_version_=version;transport_->set_protocol_version(version);return request_with_headers(method,params,headers,false);}}throw AxError("mcp",display(Core::get(error,"message","MCP JSON-RPC error")),"",0,code,false);}
  auto result=Core::get(response,"result",Value::object());if(era_=="modern"){auto info=Core::get(Core::get(result,"_meta",Value::object()),"io.modelcontextprotocol/serverInfo",Value());if(!info.is_null()&&!display(Core::get(info,"name","")).empty()&&!display(Core::get(info,"version","")).empty())server_info_=info;}return result;
}

Value AxMCPClient::client_capabilities()const{Value out=Core::get(options_,"capabilities",Value::object());auto tasks=Core::get(options_,"tasksExtension",Value());auto enabled=tasks.is_null()||Core::truthy(tasks);auto has_elicitation=static_cast<bool>(elicitation_handler_);auto derived=Core::mcp_client_capabilities(!Core::get(options_,"roots",Value()).is_null(),false,has_elicitation,era_.empty()?"legacy":era_,enabled);for(auto entry:as_object_local(derived))if(!value_has(out,entry.first))Core::set(out,entry.first,entry.second);value_erase(out,"sampling");if(!has_elicitation)value_erase(out,"elicitation");return out;}

Value AxMCPClient::handle_server_request(Value request) {
  auto plan = Core::mcp_server_request_plan(
      request, Core::get(options_, "roots", Value()),
      static_cast<bool>(elicitation_handler_));
  if (display(Core::get(plan, "action", "")) == "respond") {
    return Core::get(plan, "response", Value::object());
  }
  try {
    auto result = elicitation_handler_(
        Core::get(plan, "params", Value::object()),
        object({{"client", "AxMCPClient"}, {"namespace", namespace_name()}}));
    return object({{"jsonrpc", "2.0"},
                   {"id", Core::get(plan, "id", Value())},
                   {"result", result}});
  } catch (const std::exception& error) {
    return object(
        {{"jsonrpc", "2.0"},
         {"id", Core::get(plan, "id", Value())},
         {"error", object({{"code", -32603}, {"message", error.what()}})}});
  }
}

bool AxMCPClient::capability(const std::string& name) const {
  Value value = Core::get(server_capabilities_, name, Value());
  return !value.is_null() && !equal(value, false);
}

std::vector<Tool> AxMCPClient::to_function() {
  std::vector<Tool> out;
  for (auto item : tools_) out.push_back(tool_to_function(item));
  for (auto item : prompts_) out.push_back(prompt_to_function(item));
  for (auto item : resources_) out.push_back(resource_to_function(item));
  for (auto item : resource_templates_) out.push_back(resource_template_to_function(item));
  return out;
}

std::vector<Tool> AxMCPClient::native_tools() {
  std::vector<Tool> out;
  for (auto spec : tools_) {
    std::string original = display(Core::get(spec, "name", ""));
    auto self = this;
    out.emplace_back(original, display(Core::get(spec, "description", original)), Core::get(spec, "inputSchema", Value::object()), [self, original](Value args) {
      return self->call_tool(original, args);
    });
  }
  return out;
}

Value AxMCPClient::prompts() const { return Value(Array(prompts_.begin(), prompts_.end())); }
Value AxMCPClient::resources() const { return Value(Array(resources_.begin(), resources_.end())); }
Value AxMCPClient::resource_templates() const { return Value(Array(resource_templates_.begin(), resource_templates_.end())); }

std::string AxMCPClient::namespace_name() const {
  std::string configured = display(Core::get(options_, "namespace", ""));
  if(!configured.empty())return configured;auto server=display(Core::get(server_info_,"name",""));return server.empty()?"mcp":server;
}

static const std::vector<std::string>& ax_ucp_operations() {
  static const std::vector<std::string> operations = {
      "catalog.search", "catalog.lookup", "catalog.product", "cart.create", "cart.get", "cart.update", "cart.cancel",
      "checkout.create", "checkout.get", "checkout.update", "checkout.complete", "checkout.cancel", "fulfillment.quote",
      "discounts.apply", "payments.create", "payments.confirm", "orders.get", "identity.link", "attribution.record", "handoff.create"};
  return operations;
}

AxUCPClient::AxUCPClient(Value profile, std::shared_ptr<AxUCPBinding> binding, Value options)
    : profile_(std::move(profile)), binding_(std::move(binding)), options_(std::move(options)) {
  version_ = display(Core::get(profile_, "version", Core::get(options_, "version", "2026-04-08")));
  Value supported = Core::get(options_, "supportedVersions", array({"2026-04-08"}));
  bool found = false;
  for (auto item : as_array_local(supported)) found = found || display(item) == version_;
  if (!found) throw std::runtime_error("Unsupported UCP version " + version_);
}

std::string AxUCPClient::namespace_name() const {
  std::string configured = display(Core::get(options_, "namespace", ""));
  if (!configured.empty()) return configured;
  configured = display(Core::get(profile_, "name", ""));
  return configured.empty() ? "ucp" : configured;
}
std::string AxUCPClient::version() const { return version_; }
Value AxUCPClient::profile() const { return profile_; }

Value AxUCPClient::call(const std::string& operation, Value payload, const std::string& idempotency_key) {
  if (std::find(ax_ucp_operations().begin(), ax_ucp_operations().end(), operation) == ax_ucp_operations().end())
    throw std::runtime_error("Unsupported UCP operation " + operation);
  std::string key = idempotency_key.empty() ? "ax-ucp-" + std::to_string(std::chrono::steady_clock::now().time_since_epoch().count()) : idempotency_key;
  Value value = binding_->call(operation, std::move(payload), object({{"version", version_}, {"idempotencyKey", key}}));
  return object({{"operation", operation}, {"value", value}, {"warnings", Core::get(value, "warnings", Value())},
                 {"partialSuccess", Core::get(value, "partial_success", Core::get(value, "partialSuccess", false))},
                 {"continuationUrl", Core::get(value, "continuation_url", Core::get(value, "continuationUrl", Value()))}, {"idempotencyKey", key}});
}

std::vector<Tool> AxUCPClient::native_tools() {
  std::vector<Tool> out;
  for (const auto& operation : ax_ucp_operations()) {
    std::string name = namespace_name() + "_" + operation;
    std::replace(name.begin(), name.end(), '.', '_');
    out.emplace_back(name, "UCP " + operation + " operation", Value::object(), [this, operation](Value args) { return call(operation, args); });
  }
  return out;
}

std::vector<Tool> AxUCPClient::runtime_tools() {
  std::vector<Tool> out;
  for (const auto& operation : ax_ucp_operations()) {
    out.emplace_back(operation, "UCP " + operation + " operation", Value::object(), [this, operation](Value args) { return call(operation, args); });
  }
  return out;
}

Value AxUCPClient::catalog_search(Value payload) { return call("catalog.search", payload); }
Value AxUCPClient::catalog_lookup(Value payload) { return call("catalog.lookup", payload); }
Value AxUCPClient::catalog_product(Value payload) { return call("catalog.product", payload); }
Value AxUCPClient::cart_create(Value payload) { return call("cart.create", payload); }
Value AxUCPClient::cart_get(Value payload) { return call("cart.get", payload); }
Value AxUCPClient::cart_update(Value payload) { return call("cart.update", payload); }
Value AxUCPClient::cart_cancel(Value payload) { return call("cart.cancel", payload); }
Value AxUCPClient::checkout_create(Value payload) { return call("checkout.create", payload); }
Value AxUCPClient::checkout_get(Value payload) { return call("checkout.get", payload); }
Value AxUCPClient::checkout_update(Value payload) { return call("checkout.update", payload); }
Value AxUCPClient::checkout_complete(Value payload) { return call("checkout.complete", payload); }
Value AxUCPClient::checkout_cancel(Value payload) { return call("checkout.cancel", payload); }
Value AxUCPClient::order_get(Value payload) { return call("orders.get", payload); }
Value AxUCPClient::identity_link(Value payload) { return call("identity.link", payload); }

AxExecutionContext::AxExecutionContext(std::vector<std::shared_ptr<AxMCPClient>> mcp, std::vector<std::shared_ptr<AxUCPClient>> ucp)
    : mcp_(std::move(mcp)), ucp_(std::move(ucp)) {
  auto names = namespaces();
  std::set<std::string> unique(names.begin(), names.end());
  if (unique.size() != names.size()) throw std::runtime_error("MCP/UCP namespace collision");
}

void AxExecutionContext::initialize() {
  std::lock_guard<std::mutex> lock(mutex_);
  for (auto& client : mcp_) if (initialized_.insert(client.get()).second) client->init();
}

std::vector<Tool> AxExecutionContext::native_tools() {
  initialize();
  std::vector<Tool> out;
  for (auto& client : mcp_) { auto tools = client->native_tools(); out.insert(out.end(), tools.begin(), tools.end()); }
  for (auto& client : ucp_) { auto tools = client->native_tools(); out.insert(out.end(), tools.begin(), tools.end()); }
  std::set<std::string> names;
  for (const auto& tool : out) if (!names.insert(tool.name).second) throw std::runtime_error("MCP/UCP tool collision " + tool.name);
  return out;
}

Value AxExecutionContext::runtime_modules() {
  Array out;
  for (auto& client : mcp_) { Array functions; for (auto& tool : client->native_tools()) functions.push_back(tool.name); out.push_back(object({{"name", "mcp." + client->namespace_name() + ".tools"}, {"functions", Value(functions)}})); }
  for (auto& client : ucp_) { Array functions; for (auto& tool : client->runtime_tools()) functions.push_back(tool.name); out.push_back(object({{"name", "ucp." + client->namespace_name()}, {"functions", Value(functions)}})); }
  return Value(out);
}

std::vector<std::string> AxExecutionContext::namespaces() const { std::vector<std::string> out; for (auto& client : mcp_) out.push_back(client->namespace_name()); for (auto& client : ucp_) out.push_back(client->namespace_name()); return out; }

AxExecutionContext AxExecutionContext::derive(Value inheritance) const {
  if (display(inheritance) == "none") return AxExecutionContext();
  auto allowed_values = as_array_local(inheritance);
  if (allowed_values.empty()) return AxExecutionContext(mcp_, ucp_);
  std::set<std::string> allowed; for (auto value : allowed_values) allowed.insert(display(value));
  std::vector<std::shared_ptr<AxMCPClient>> mcp; std::vector<std::shared_ptr<AxUCPClient>> ucp;
  for (auto& client : mcp_) if (allowed.count(client->namespace_name())) mcp.push_back(client);
  for (auto& client : ucp_) if (allowed.count(client->namespace_name())) ucp.push_back(client);
  return AxExecutionContext(std::move(mcp), std::move(ucp));
}

AxMCPContinuationState AxExecutionContext::continuation_state() const { auto names = namespaces(); std::string joined; for (auto& name : names) joined += name + "\n"; return {names, Value::array(), Value::array(), ax_mcp_pkce_challenge(joined)}; }
void AxExecutionContext::attach(AxGen& gen) { for (const auto& tool : native_tools()) gen.add_tool(tool); }
void AxExecutionContext::attach(AxAgent& agent) { initialize(); for (auto& client : mcp_) agent.add_tool_module("mcp." + client->namespace_name() + ".tools", client->native_tools()); for (auto& client : ucp_) agent.add_tool_module("ucp." + client->namespace_name(), client->runtime_tools()); }

Tool AxMCPClient::tool_to_function(Value spec) {
  std::string original = display(Core::get(spec, "name", ""));
  std::string desc = display(Core::get(spec, "description", original));
  auto self = this;
  return Tool(original, desc, Core::get(spec, "inputSchema", Value::object()), [self, original](Value args) {
    Value result = self->call_tool(original, args);
    Value structured = Core::get(result, "structuredContent", Value());
    if (!structured.is_null()) return structured;
    return object({{"content", content_text(Core::get(result, "content", Value::array()))}});
  });
}

Tool AxMCPClient::prompt_to_function(Value spec) {
  std::string original = display(Core::get(spec, "name", ""));
  auto self = this;
  return Tool("prompt_" + original, display(Core::get(spec, "description", original)), Value::object(), [self, original](Value args) {
    return self->get_prompt(original, args);
  });
}

Tool AxMCPClient::resource_to_function(Value spec) {
  std::string uri = display(Core::get(spec, "uri", ""));
  auto self = this;
  return Tool("resource_" + safe_name(display(Core::get(spec, "name", uri))), display(Core::get(spec, "description", uri)), Value::object(),
              [self, uri](Value) { return self->read_resource(uri); });
}

Tool AxMCPClient::resource_template_to_function(Value spec) {
  auto self = this;
  return Tool("resource_template_" + safe_name(display(Core::get(spec, "name", "template"))), display(Core::get(spec, "description", "template")),
              Value::object(), [self](Value args) { return self->read_resource(display(Core::get(args, "uri", ""))); });
}

static std::string ax_mcp_origin(const std::string& endpoint) {
  auto scheme = endpoint.find("://");
  if (scheme == std::string::npos) return endpoint;
  auto end = endpoint.find_first_of("/?#", scheme + 3);
  return endpoint.substr(0, end);
}

static std::string ax_mcp_base64_encode(const std::string& input) {
  static const char table[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  std::string out;
  out.reserve(((input.size() + 2) / 3) * 4);
  for (std::size_t i = 0; i < input.size(); i += 3) {
    const auto a = static_cast<unsigned char>(input[i]);
    const auto b = i + 1 < input.size() ? static_cast<unsigned char>(input[i + 1]) : 0;
    const auto c = i + 2 < input.size() ? static_cast<unsigned char>(input[i + 2]) : 0;
    out.push_back(table[a >> 2]);
    out.push_back(table[((a & 0x03) << 4) | (b >> 4)]);
    out.push_back(i + 1 < input.size() ? table[((b & 0x0f) << 2) | (c >> 6)] : '=');
    out.push_back(i + 2 < input.size() ? table[c & 0x3f] : '=');
  }
  return out;
}

static std::string ax_mcp_encode_header_value(const std::string& value) {
  auto plan = Core::mcp_header_value_plan(value);
  if (display(Core::get(plan, "mode", "plain")) == "plain") return value;
  return "=?base64?" + ax_mcp_base64_encode(value) + "?=";
}

AxMCPStreamableHTTPTransport::AxMCPStreamableHTTPTransport(std::string endpoint, Value options)
    : endpoint_(ax_mcp_validate_endpoint(endpoint, Core::get(options, "ssrfProtection", Value::object()))),
      options_(std::move(options)), era_cache_key_(ax_mcp_origin(endpoint_)) {}

static std::vector<Value> ax_mcp_parse_sse(const std::string& body) {
  // Extract JSON-RPC messages from the `data:` frames of an SSE body.
  std::vector<Value> messages;
  std::size_t pos = 0;
  while (pos <= body.size()) {
    std::size_t eol = body.find('\n', pos);
    std::string line = body.substr(pos, eol == std::string::npos ? std::string::npos : eol - pos);
    std::size_t begin = line.find_first_not_of(" \t\r");
    std::size_t end = line.find_last_not_of(" \t\r");
    line = (begin == std::string::npos) ? std::string() : line.substr(begin, end - begin + 1);
    if (line.rfind("data:", 0) == 0) {
      std::string data = line.substr(5);
      std::size_t data_begin = data.find_first_not_of(" \t");
      data = (data_begin == std::string::npos) ? std::string() : data.substr(data_begin);
      if (!data.empty() && data != "[DONE]") messages.push_back(Core::json_parse(data));
    }
    if (eol == std::string::npos) break;
    pos = eol + 1;
  }
  return messages;
}

static Value ax_mcp_select_sse_response(const std::vector<Value>& messages, const Value& request_id,
                                        const std::function<void(Value)>& handler) {
  // Return the matching response and dispatch interleaved inbound messages.
  Value response;
  for (const auto& message : messages) {
    if (response.is_null()&&value_has(message, "id") && equal(Core::get(message, "id", Value()), request_id)) response=message;
    else if(handler)handler(message);
  }
  if(!response.is_null())return response;
  if (!messages.empty()) return messages.back();
  return object({{"jsonrpc", "2.0"}, {"id", request_id}, {"result", Value::object()}});
}

Value AxMCPStreamableHTTPTransport::send(Value message) {
  return send_with_headers(std::move(message), Value::object());
}

Value AxMCPStreamableHTTPTransport::send_with_headers(Value message, Value extra_headers) {
  auto method = display(Core::get(message, "method", ""));
  Value headers = build_headers(object({{"Content-Type", "application/json"}, {"Accept", "application/json, text/event-stream"}}),
                                method != "initialize", method, Core::get(message, "params", Value::object()), extra_headers);
  // Request the raw body (stream:true) so we can branch on the response
  // Content-Type: a spec-compliant MCP server may answer a JSON-RPC POST with an
  // SSE stream (text/event-stream) carrying the response — and any interleaved
  // notifications — in `data:` frames, which must be SSE-parsed rather than
  // JSON-decoded. Otherwise keep the JSON path. (The optional standalone GET
  // stream for unsolicited server->client messages is out of scope here.)
  Value response = http_.call(object({{"url", endpoint_}, {"method", "POST"}, {"headers", headers}, {"json", message}, {"stream", true}}));
  auto response_headers=Core::get(response,"headers",Value::object());
  auto status=static_cast<long>(Core::number(Core::get(response,"status",0)));
  if(status==401){auto challenge=display(Core::get(response_headers,"WWW-Authenticate",Core::get(response_headers,"www-authenticate","")));if(apply_oauth(challenge))return send_with_headers(std::move(message),std::move(extra_headers));}
  if(status<200||status>=300)throw AxError("mcp","HTTP error "+std::to_string(status));
  auto session=display(Core::get(response_headers,"MCP-Session-Id",Core::get(response_headers,"mcp-session-id","")));
  if(era_ != "modern" && !session.empty())session_id_=session;
  Value request_id = Core::get(message, "id", Value());
  std::string body = display(Core::get(response, "body", ""));
  if (body.empty()) return object({{"jsonrpc", "2.0"}, {"id", request_id}, {"result", Value::object()}});
  std::string content_type = display(Core::get(response, "contentType", ""));
  std::transform(content_type.begin(), content_type.end(), content_type.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
  if (content_type.find("text/event-stream") != std::string::npos) {
    return ax_mcp_select_sse_response(ax_mcp_parse_sse(body), request_id, [this](Value inbound){if(!dispatch_inbound_request(inbound)&&message_handler_)message_handler_(std::move(inbound));});
  }
  return Core::json_parse(body);
}

void AxMCPStreamableHTTPTransport::send_notification(Value message) { (void)send(std::move(message)); }
void AxMCPStreamableHTTPTransport::set_protocol_version(const std::string& protocol_version) { protocol_version_ = protocol_version; }
void AxMCPStreamableHTTPTransport::set_era(const std::string& era) {
  era_ = era;
  if (era_ == "modern") { session_id_.clear(); protocol_version_ = "2026-07-28"; }
  else if (protocol_version_ == "2026-07-28") protocol_version_.clear();
}
void AxMCPStreamableHTTPTransport::set_session_id(std::string session_id) { session_id_ = std::move(session_id); }

void AxMCPStreamableHTTPTransport::start_listening(){
  if (era_ == "modern") throw AxError("mcp", "Modern MCP uses subscriptions/listen via openRequestStream, not HTTP GET");
  std::lock_guard<std::mutex> lock(listen_mutex_);
  if(listen_thread_.joinable())return;
  listen_stop_=false;
  listen_thread_=std::thread([this]{listen_loop();});
}

void AxMCPStreamableHTTPTransport::open_request_stream(Value message){
  if(era_!="modern")throw AxError("mcp","Request streams are only available for modern MCP");
  close_request_stream();std::lock_guard<std::mutex> lock(listen_mutex_);listen_stop_=false;sse_buffer_.clear();listen_thread_=std::thread([this,message=std::move(message)]()mutable{request_stream_loop(std::move(message));});
}

void AxMCPStreamableHTTPTransport::close_request_stream(){
  listen_stop_=true;std::thread thread;{std::lock_guard<std::mutex> lock(listen_mutex_);if(listen_thread_.joinable())thread=std::move(listen_thread_);}if(thread.joinable()&&thread.get_id()!=std::this_thread::get_id())thread.join();
}

void AxMCPStreamableHTTPTransport::close(){
  close_request_stream();
}

void AxMCPStreamableHTTPTransport::consume_sse_chunk(const char* data,std::size_t size){
  for(std::size_t i=0;i<size;++i)if(data[i]!='\r')sse_buffer_.push_back(data[i]);
  while(true){
    auto end=sse_buffer_.find("\n\n");
    if(end==std::string::npos)break;
    auto frame=sse_buffer_.substr(0,end);sse_buffer_.erase(0,end+2);
    std::string event_id;std::string payload;std::size_t pos=0;
    while(pos<=frame.size()){
      auto eol=frame.find('\n',pos);auto line=frame.substr(pos,eol==std::string::npos?std::string::npos:eol-pos);
      if(line.rfind("id:",0)==0){event_id=line.substr(3);auto begin=event_id.find_first_not_of(" \t");event_id=begin==std::string::npos?std::string():event_id.substr(begin);}
      else if(line.rfind("data:",0)==0){auto value=line.substr(5);auto begin=value.find_first_not_of(" \t");value=begin==std::string::npos?std::string():value.substr(begin);if(!payload.empty())payload+='\n';payload+=value;}
      if(eol==std::string::npos)break;pos=eol+1;
    }
    if(!event_id.empty())last_event_id_=event_id;
    if(!payload.empty()){try{auto inbound=Core::json_parse(payload);if(!dispatch_inbound_request(inbound)&&message_handler_)message_handler_(std::move(inbound));}catch(...){}}
  }
}

void AxMCPStreamableHTTPTransport::listen_loop(){
#if !defined(AXLLM_ENABLE_CURL)
  listen_stop_=true;
  return;
#else
  static bool curl_initialized=[](){curl_global_init(CURL_GLOBAL_DEFAULT);return true;}();(void)curl_initialized;
  bool connected_once=false;
  auto delay=static_cast<long>(Core::number(Core::get(options_,"reconnectDelayMs",100)));
  while(!listen_stop_){
    CURL* curl=curl_easy_init();if(!curl)break;
    struct ListenContext{AxMCPStreamableHTTPTransport* self;bool* connected_once;bool announced=false;} context{this,&connected_once,false};
    auto header_values=build_headers(object({{"Accept","text/event-stream"}}),true);
    if(!last_event_id_.empty())Core::set(header_values,"Last-Event-ID",last_event_id_);
    curl_slist* headers=nullptr;for(const auto& entry:as_object_local(header_values)){if(entry.first=="__order")continue;headers=curl_slist_append(headers,(entry.first+": "+display(entry.second)).c_str());}
    curl_easy_setopt(curl,CURLOPT_URL,endpoint_.c_str());curl_easy_setopt(curl,CURLOPT_HTTPGET,1L);curl_easy_setopt(curl,CURLOPT_HTTPHEADER,headers);
    curl_easy_setopt(curl,CURLOPT_WRITEFUNCTION,+[](char* ptr,size_t size,size_t nmemb,void* raw)->size_t{auto* ctx=static_cast<ListenContext*>(raw);if(ctx->self->listen_stop_)return 0;if(!ctx->announced){if(*ctx->connected_once&&ctx->self->lifecycle_handler_)ctx->self->lifecycle_handler_("reconnected");*ctx->connected_once=true;ctx->announced=true;}auto count=size*nmemb;ctx->self->consume_sse_chunk(ptr,count);return count;});
    curl_easy_setopt(curl,CURLOPT_WRITEDATA,&context);
    curl_easy_setopt(curl,CURLOPT_HEADERFUNCTION,+[](char* ptr,size_t size,size_t nmemb,void* raw)->size_t{auto* self=static_cast<AxMCPStreamableHTTPTransport*>(raw);if(self->era_=="modern")return size*nmemb;std::string line(ptr,size*nmemb);auto colon=line.find(':');if(colon!=std::string::npos){auto name=line.substr(0,colon);std::transform(name.begin(),name.end(),name.begin(),[](unsigned char c){return static_cast<char>(std::tolower(c));});if(name=="mcp-session-id"){auto value=line.substr(colon+1);auto begin=value.find_first_not_of(" \t");auto end=value.find_last_not_of(" \t\r\n");if(begin!=std::string::npos)self->session_id_=value.substr(begin,end-begin+1);}}return size*nmemb;});
    curl_easy_setopt(curl,CURLOPT_HEADERDATA,this);curl_easy_setopt(curl,CURLOPT_NOPROGRESS,0L);
    curl_easy_setopt(curl,CURLOPT_XFERINFOFUNCTION,+[](void* raw,curl_off_t,curl_off_t,curl_off_t,curl_off_t)->int{return static_cast<AxMCPStreamableHTTPTransport*>(raw)->listen_stop_?1:0;});curl_easy_setopt(curl,CURLOPT_XFERINFODATA,this);
    auto result=curl_easy_perform(curl);curl_slist_free_all(headers);curl_easy_cleanup(curl);
    if(!listen_stop_&&connected_once&&lifecycle_handler_)lifecycle_handler_("disconnected");
    if(listen_stop_)break;
    if(result!=CURLE_OK||context.announced)std::this_thread::sleep_for(std::chrono::milliseconds(std::max(1L,delay)));
  }
#endif
}

void AxMCPStreamableHTTPTransport::request_stream_loop(Value message){
#if !defined(AXLLM_ENABLE_CURL)
  listen_stop_=true;(void)message;return;
#else
  static bool curl_initialized=[](){curl_global_init(CURL_GLOBAL_DEFAULT);return true;}();(void)curl_initialized;
  CURL* curl=curl_easy_init();if(!curl)return;auto method=display(Core::get(message,"method",""));auto header_values=build_headers(object({{"Content-Type","application/json"},{"Accept","text/event-stream"}}),true,method,Core::get(message,"params",Value::object()));curl_slist* headers=nullptr;for(const auto& entry:as_object_local(header_values)){if(entry.first=="__order")continue;headers=curl_slist_append(headers,(entry.first+": "+display(entry.second)).c_str());}auto body=stringify(message);curl_easy_setopt(curl,CURLOPT_URL,endpoint_.c_str());curl_easy_setopt(curl,CURLOPT_POST,1L);curl_easy_setopt(curl,CURLOPT_POSTFIELDS,body.data());curl_easy_setopt(curl,CURLOPT_POSTFIELDSIZE,static_cast<long>(body.size()));curl_easy_setopt(curl,CURLOPT_HTTPHEADER,headers);curl_easy_setopt(curl,CURLOPT_WRITEFUNCTION,+[](char* ptr,size_t size,size_t nmemb,void* raw)->size_t{auto* self=static_cast<AxMCPStreamableHTTPTransport*>(raw);if(self->listen_stop_)return 0;auto count=size*nmemb;self->consume_sse_chunk(ptr,count);return count;});curl_easy_setopt(curl,CURLOPT_WRITEDATA,this);curl_easy_setopt(curl,CURLOPT_NOPROGRESS,0L);curl_easy_setopt(curl,CURLOPT_XFERINFOFUNCTION,+[](void* raw,curl_off_t,curl_off_t,curl_off_t,curl_off_t)->int{return static_cast<AxMCPStreamableHTTPTransport*>(raw)->listen_stop_?1:0;});curl_easy_setopt(curl,CURLOPT_XFERINFODATA,this);curl_easy_perform(curl);curl_slist_free_all(headers);curl_easy_cleanup(curl);if(!listen_stop_&&lifecycle_handler_)lifecycle_handler_("disconnected");
#endif
}

Value AxMCPStreamableHTTPTransport::build_headers(Value base, bool include_protocol, const std::string& method,
                                                  Value params, Value extra_headers) const {
  Value out = Core::map_merge(Core::map_merge(headers_, base), extra_headers);
  if (era_ == "modern") {
    for (const auto& entry : as_object_local(extra_headers)) {
      std::string lower = entry.first;
      std::transform(lower.begin(), lower.end(), lower.begin(), [](unsigned char ch){return static_cast<char>(std::tolower(ch));});
      if (lower.rfind("mcp-param-", 0) == 0) Core::set(out, entry.first, ax_mcp_encode_header_value(display(entry.second)));
    }
  }
  if (era_ != "modern" && !session_id_.empty()) Core::set(out, "MCP-Session-Id", session_id_);
  if ((era_ == "modern" || include_protocol) && !protocol_version_.empty()) Core::set(out, "MCP-Protocol-Version", protocol_version_);
  if (era_ == "modern" && !method.empty()) {
    Core::set(out, "Mcp-Method", method);
    auto name = display(Core::mcp_request_name(method, params));
    if (!name.empty()) Core::set(out, "Mcp-Name", ax_mcp_encode_header_value(name));
  }
  return out;
}

void AxMCPStreamableHTTPTransport::terminate_session() { if (era_ != "modern") session_id_.clear(); }

static std::string ax_mcp_oauth_encode(const std::string& value){static const char* hex="0123456789ABCDEF";std::string out;for(unsigned char ch:value){if(std::isalnum(ch)||ch=='-'||ch=='.'||ch=='_'||ch=='~')out.push_back(static_cast<char>(ch));else{out.push_back('%');out.push_back(hex[ch>>4]);out.push_back(hex[ch&15]);}}return out;}
static Value ax_mcp_oauth_http(const std::string& url,const std::string& method,const std::string& form=""){
#if !defined(AXLLM_ENABLE_CURL)
  (void)url;(void)method;(void)form;throw AxError("mcp","C++ OAuth HTTP requires libcurl and AXLLM_ENABLE_CURL=ON");
#else
  static bool initialized=[](){curl_global_init(CURL_GLOBAL_DEFAULT);return true;}();(void)initialized;CURL* curl=curl_easy_init();if(!curl)throw AxError("network","curl_easy_init failed");std::string body;Value headers=Value::object();curl_slist* request_headers=nullptr;request_headers=curl_slist_append(request_headers,"Accept: application/json");if(method=="POST")request_headers=curl_slist_append(request_headers,"Content-Type: application/x-www-form-urlencoded");curl_easy_setopt(curl,CURLOPT_URL,url.c_str());curl_easy_setopt(curl,CURLOPT_HTTPHEADER,request_headers);curl_easy_setopt(curl,CURLOPT_WRITEFUNCTION,+[](char* ptr,size_t size,size_t nmemb,void* raw)->size_t{static_cast<std::string*>(raw)->append(ptr,size*nmemb);return size*nmemb;});curl_easy_setopt(curl,CURLOPT_WRITEDATA,&body);curl_easy_setopt(curl,CURLOPT_HEADERFUNCTION,+[](char* ptr,size_t size,size_t nmemb,void* raw)->size_t{auto* out=static_cast<Value*>(raw);std::string line(ptr,size*nmemb);auto colon=line.find(':');if(colon!=std::string::npos){auto name=line.substr(0,colon);auto value=line.substr(colon+1);auto begin=value.find_first_not_of(" \t");auto end=value.find_last_not_of(" \t\r\n");if(begin!=std::string::npos)Core::set(*out,name,value.substr(begin,end-begin+1));}return size*nmemb;});curl_easy_setopt(curl,CURLOPT_HEADERDATA,&headers);if(method=="POST"){curl_easy_setopt(curl,CURLOPT_POST,1L);curl_easy_setopt(curl,CURLOPT_POSTFIELDS,form.data());curl_easy_setopt(curl,CURLOPT_POSTFIELDSIZE,static_cast<long>(form.size()));}else curl_easy_setopt(curl,CURLOPT_HTTPGET,1L);auto rc=curl_easy_perform(curl);long status=0;curl_easy_getinfo(curl,CURLINFO_RESPONSE_CODE,&status);curl_slist_free_all(request_headers);curl_easy_cleanup(curl);if(rc!=CURLE_OK)throw AxError("network",curl_easy_strerror(rc));Value out=object({{"status",static_cast<double>(status)},{"headers",headers}});if(!body.empty())Core::set(out,"json",Core::json_parse(body));return out;
#endif
}
static long ax_mcp_oauth_now_ms(){return std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count();}

bool AxMCPStreamableHTTPTransport::apply_oauth(const std::string& www_authenticate) {
  Value stored=oauth.getToken?oauth.getToken(endpoint_):Value();std::string grant_type=oauth.grantType.empty()?"authorization_code":oauth.grantType;Value plan=Core::mcp_oauth_plan_ensure_token(stored,ax_mcp_oauth_now_ms(),false,grant_type,static_cast<bool>(oauth.onAuthCode));if(!Core::truthy(Core::get(plan,"ok",false)))throw AxError("mcp",display(Core::get(plan,"message","OAuth token planning failed")));std::string action=display(Core::get(plan,"action",""));if(action=="cached"){auto token=Core::get(plan,"token",stored);Core::set(headers_,"Authorization","Bearer "+display(Core::get(token,"accessToken","")));return true;}
  Value parsed=Core::mcp_oauth_parse_www_authenticate(www_authenticate);std::string resource=oauth.resource;Value as_metadata=oauth.authorizationServerMetadata;std::string issuer=display(Core::get(as_metadata,"issuer",""));std::string client_auth=oauth.clientSecret.empty()?"none":"client_secret_post";
  auto get_json=[&](const std::string& raw_url){auto checked=ax_mcp_validate_endpoint(raw_url,oauth.ssrfProtection);auto response=ax_mcp_oauth_http(checked,"GET");auto status=static_cast<long>(Core::number(Core::get(response,"status",0)));if(status<200||status>=300)throw AxError("mcp","OAuth discovery HTTP error "+std::to_string(status));return Core::get(response,"json",Value::object());};
  if(as_metadata.is_null()){Value discovery=Core::mcp_oauth_discovery_endpoints(endpoint_,"",Core::get(parsed,"resourceMetadata",""));Value resource_metadata;std::string last_error;for(auto endpoint:Core::iter(Core::get(discovery,"resourceMetadataEndpoints",Value::array()))){try{resource_metadata=get_json(display(endpoint));break;}catch(const std::exception& error){last_error=error.what();}}if(resource_metadata.is_null())throw AxError("mcp","Failed to resolve protected resource metadata: "+last_error);Value coverage=Core::mcp_oauth_validate_resource_coverage(endpoint_,resource_metadata);if(!Core::truthy(Core::get(coverage,"ok",false)))throw AxError("mcp",display(Core::get(coverage,"message","OAuth resource coverage validation failed")));if(resource.empty())resource=display(Core::get(coverage,"resource",""));auto issuers=as_array_local(Core::get(coverage,"issuers",Value::array()));if(issuers.empty())throw AxError("mcp","No OAuth authorization server discovered");issuer=display(issuers.front());discovery=Core::mcp_oauth_discovery_endpoints(endpoint_,issuer,"");last_error.clear();for(auto endpoint:Core::iter(Core::get(discovery,"authorizationServerMetadataEndpoints",Value::array()))){try{auto candidate=get_json(display(endpoint));auto validation=Core::mcp_oauth_validate_as_metadata(candidate,issuer,grant_type!="client_credentials",client_auth);if(!Core::truthy(Core::get(validation,"ok",false)))throw AxError("mcp",display(Core::get(validation,"message","OAuth AS metadata validation failed")));as_metadata=candidate;break;}catch(const std::exception& error){last_error=error.what();}}if(as_metadata.is_null())throw AxError("mcp","Failed to discover authorization server metadata: "+last_error);}
  if(resource.empty())resource=endpoint_;if(issuer.empty())issuer=display(Core::get(as_metadata,"issuer",""));Value metadata_validation=Core::mcp_oauth_validate_as_metadata(as_metadata,issuer,grant_type!="client_credentials",client_auth);if(!Core::truthy(Core::get(metadata_validation,"ok",false)))throw AxError("mcp",display(Core::get(metadata_validation,"message","OAuth AS metadata validation failed")));oauth.authorizationServerMetadata=as_metadata;oauth.resource=resource;Value scopes=Core::get(parsed,"scopes",Value::array());if(as_array_local(scopes).empty()){Array values;for(const auto& scope:oauth.scopes)values.emplace_back(scope);scopes=Value(values);}if(as_array_local(scopes).empty())scopes=Core::get(as_metadata,"scopes_supported",Value::array());std::string client_id=oauth.clientId.empty()?"ax-mcp-client":oauth.clientId;std::string redirect_uri=oauth.redirectUri.empty()?"http://localhost:8787/callback":oauth.redirectUri;
  auto exchange=[&](const std::string& selected_grant,const std::string& code,const std::string& verifier,const std::string& refresh_token){Value grant=Core::mcp_oauth_grant_body(selected_grant,client_id,oauth.clientSecret,client_auth,resource,scopes,code,redirect_uri,verifier,refresh_token);if(!Core::truthy(Core::get(grant,"ok",false)))throw AxError("mcp",display(Core::get(grant,"message","OAuth grant planning failed")));std::string form;for(const auto& entry:as_object_local(Core::get(grant,"body",Value::object()))){if(entry.first=="__order")continue;if(!form.empty())form+='&';form+=ax_mcp_oauth_encode(entry.first)+"="+ax_mcp_oauth_encode(display(entry.second));}auto checked=ax_mcp_validate_endpoint(display(Core::get(as_metadata,"token_endpoint","")),oauth.ssrfProtection);auto response=ax_mcp_oauth_http(checked,"POST",form);auto status=static_cast<long>(Core::number(Core::get(response,"status",0)));if(status<200||status>=300)throw AxError("mcp","OAuth token HTTP error "+std::to_string(status));Value parsed_token=Core::mcp_oauth_parse_token_response(Core::get(response,"json",Value::object()),ax_mcp_oauth_now_ms(),refresh_token,issuer);if(!Core::truthy(Core::get(parsed_token,"ok",false)))throw AxError("mcp",display(Core::get(parsed_token,"message","OAuth token response validation failed")));return Core::get(parsed_token,"token",Value::object());};
  Value token;if(action=="refresh"){try{token=exchange("refresh_token","","",display(Core::get(plan,"refreshToken","")));}catch(...){if(oauth.clearToken)oauth.clearToken(endpoint_);action=grant_type=="client_credentials"?"client_credentials":"authorize";}}if(action=="client_credentials")token=exchange("client_credentials","","","");else if(action=="authorize"){if(!oauth.onAuthCode)throw AxError("mcp","Authorization required. Provide oauth.onAuthCode to complete the flow");std::string verifier=ax_mcp_pkce_verifier();std::string challenge=ax_mcp_pkce_challenge(verifier);std::string state=ax_mcp_pkce_verifier();Value params=Core::mcp_oauth_authorization_request_params(client_id,redirect_uri,scopes,resource,state,challenge);std::string authorization_endpoint=ax_mcp_validate_endpoint(display(Core::get(as_metadata,"authorization_endpoint","")),oauth.ssrfProtection);std::string auth_url=authorization_endpoint+(authorization_endpoint.find('?')==std::string::npos?"?":"&");bool first=true;for(const auto& entry:as_object_local(params)){if(entry.first=="__order")continue;if(!first)auth_url+='&';first=false;auth_url+=ax_mcp_oauth_encode(entry.first)+"="+ax_mcp_oauth_encode(display(entry.second));}Value auth=oauth.onAuthCode(auth_url);std::string code=display(Core::get(auth,"code",""));if(code.empty())return false;Core::set(auth,"expectedState",state);Value validation=Core::mcp_oauth_validate_issuer(auth,issuer,oauth.requireIss||Core::truthy(Core::get(metadata_validation,"requireIss",false)));if(!Core::truthy(Core::get(validation,"ok",false)))throw AxError("mcp",display(Core::get(validation,"message","OAuth authorization response validation failed")));token=exchange("authorization_code",code,verifier,"");}
  if(token.is_null())throw AxError("mcp","OAuth flow produced no token");if(oauth.setToken)oauth.setToken(endpoint_,token);Core::set(headers_,"Authorization","Bearer "+display(Core::get(token,"accessToken","")));return true;
}

AxMCPStdioTransport::AxMCPStdioTransport(std::string command, std::vector<std::string> args) {
  (void)command;
  (void)args;
#if !defined(AXLLM_ENABLE_BOOST_PROCESS)
  throw AxError("mcp", "C++ MCP stdio process transport requires AXLLM_ENABLE_BOOST_PROCESS=ON; stdio framing helpers are always available.");
#endif
}

Value AxMCPStdioTransport::send(Value message) {
  (void)message;
  throw AxError("mcp", "C++ MCP stdio process transport requires AXLLM_ENABLE_BOOST_PROCESS=ON");
}

void AxMCPStdioTransport::send_notification(Value message) {
  (void)message;
  throw AxError("mcp", "C++ MCP stdio process transport requires AXLLM_ENABLE_BOOST_PROCESS=ON");
}

AxMCPScriptedTransport::AxMCPScriptedTransport(Value responses) : responses_(as_array_local(responses)) {}

Value AxMCPScriptedTransport::send(Value message) {
  requests.push_back(message);
  std::string method = display(Core::get(message, "method", ""));
  size_t index = responses_.size();
  for (size_t i = 0; i < responses_.size(); ++i) {
    if (display(Core::get(responses_[i], "method", method)) == method) {
      index = i;
      break;
    }
  }
  Value raw = index < responses_.size() ? responses_[index] : object({{"result", Value::object()}});
  if (index < responses_.size()) responses_.erase(responses_.begin() + static_cast<long>(index));
  Value out = object({{"jsonrpc", "2.0"}, {"id", Core::get(message, "id", Value())}});
  if (!Core::get(raw, "error", Value()).is_null()) Core::set(out, "error", Core::get(raw, "error"));
  else Core::set(out, "result", Core::get(raw, "result", Value::object()));
  return out;
}

Value AxMCPScriptedTransport::send_with_headers(Value message,Value headers){request_headers.push_back(headers);return send(std::move(message));}

void AxMCPScriptedTransport::send_notification(Value message) { notifications.push_back(message); }
void AxMCPScriptedTransport::send_response(Value message) { sent_responses.push_back(message); }
void AxMCPScriptedTransport::set_protocol_version(const std::string& protocol_version) { protocol_version_ = protocol_version; }
void AxMCPScriptedTransport::open_request_stream(Value message){if(era_!="modern")throw AxError("mcp","Request streams are only available for modern MCP");request_streams.push_back(message);if(handler_)handler_(object({{"jsonrpc","2.0"},{"method","notifications/subscriptions/acknowledged"},{"params",object({{"notifications",Core::get(Core::get(message,"params",Value::object()),"notifications",Value::object())},{"_meta",object({{"io.modelcontextprotocol/subscriptionId",Core::get(message,"id",Value())}})}})}}));}

std::string ax_mcp_stdio_encode(Value message) { return stringify(message) + "\n"; }
Value ax_mcp_stdio_decode(const std::string& line) { return parse_json(line); }

std::string ax_mcp_pkce_verifier() {
  return std::to_string(std::chrono::high_resolution_clock::now().time_since_epoch().count());
}

static std::array<unsigned char, 32> ax_mcp_sha256(const std::string& input) {
  static constexpr std::array<std::uint32_t, 64> constants = {
      0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
      0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
      0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
      0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
      0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
      0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
      0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
      0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2};
  auto rotate = [](std::uint32_t value, unsigned count) { return (value >> count) | (value << (32 - count)); };
  std::vector<unsigned char> bytes(input.begin(), input.end());
  const std::uint64_t bit_length = static_cast<std::uint64_t>(bytes.size()) * 8;
  bytes.push_back(0x80);
  while (bytes.size() % 64 != 56) bytes.push_back(0);
  for (int shift = 56; shift >= 0; shift -= 8) bytes.push_back(static_cast<unsigned char>(bit_length >> shift));
  std::array<std::uint32_t, 8> hash = {0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19};
  for (std::size_t offset = 0; offset < bytes.size(); offset += 64) {
    std::array<std::uint32_t, 64> words{};
    for (std::size_t index = 0; index < 16; ++index) {
      const std::size_t at = offset + index * 4;
      words[index] = (static_cast<std::uint32_t>(bytes[at]) << 24) | (static_cast<std::uint32_t>(bytes[at + 1]) << 16) |
                     (static_cast<std::uint32_t>(bytes[at + 2]) << 8) | bytes[at + 3];
    }
    for (std::size_t index = 16; index < 64; ++index) {
      const auto s0 = rotate(words[index - 15], 7) ^ rotate(words[index - 15], 18) ^ (words[index - 15] >> 3);
      const auto s1 = rotate(words[index - 2], 17) ^ rotate(words[index - 2], 19) ^ (words[index - 2] >> 10);
      words[index] = words[index - 16] + s0 + words[index - 7] + s1;
    }
    auto state = hash;
    for (std::size_t index = 0; index < 64; ++index) {
      const auto sum1 = rotate(state[4], 6) ^ rotate(state[4], 11) ^ rotate(state[4], 25);
      const auto choice = (state[4] & state[5]) ^ (~state[4] & state[6]);
      const auto temporary1 = state[7] + sum1 + choice + constants[index] + words[index];
      const auto sum0 = rotate(state[0], 2) ^ rotate(state[0], 13) ^ rotate(state[0], 22);
      const auto majority = (state[0] & state[1]) ^ (state[0] & state[2]) ^ (state[1] & state[2]);
      const auto temporary2 = sum0 + majority;
      state = {temporary1 + temporary2,state[0],state[1],state[2],state[3] + temporary1,state[4],state[5],state[6]};
    }
    for (std::size_t index = 0; index < hash.size(); ++index) hash[index] += state[index];
  }
  std::array<unsigned char, 32> digest{};
  for (std::size_t index = 0; index < hash.size(); ++index) for (int byte = 0; byte < 4; ++byte) digest[index * 4 + byte] = static_cast<unsigned char>(hash[index] >> (24 - byte * 8));
  return digest;
}

std::string ax_mcp_pkce_challenge(const std::string& verifier) {
  static constexpr char alphabet[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const auto digest = ax_mcp_sha256(verifier);
  std::string encoded;
  for (std::size_t index = 0; index < digest.size(); index += 3) {
    const std::uint32_t value = (static_cast<std::uint32_t>(digest[index]) << 16) |
      (index + 1 < digest.size() ? static_cast<std::uint32_t>(digest[index + 1]) << 8 : 0) |
      (index + 2 < digest.size() ? digest[index + 2] : 0);
    encoded.push_back(alphabet[(value >> 18) & 63]);
    encoded.push_back(alphabet[(value >> 12) & 63]);
    if (index + 1 < digest.size()) encoded.push_back(alphabet[(value >> 6) & 63]);
    if (index + 2 < digest.size()) encoded.push_back(alphabet[value & 63]);
  }
  return encoded;
}

std::string ax_mcp_validate_endpoint(const std::string& endpoint, Value options) {
  std::string lower = endpoint;
  std::transform(lower.begin(), lower.end(), lower.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
  bool require_https = Core::truthy(Core::get(options, "requireHttps", Core::get(options, "require_https", true)));
  if (lower.rfind("http://", 0) != 0 && lower.rfind("https://", 0) != 0) throw AxError("mcp", "MCP endpoint must use http or https");
  if (require_https && lower.rfind("https://", 0) != 0) throw AxError("mcp", "MCP endpoint must use https");
  bool allow_local = Core::truthy(Core::get(options, "allowLocalhost", Core::get(options, "allow_localhost", false)));
  bool allow_private = Core::truthy(Core::get(options, "allowPrivateNetworks", Core::get(options, "allow_private_networks", false)));
  bool is_local = lower.find("localhost") != std::string::npos || lower.find("127.") != std::string::npos;
  bool is_private = lower.find("10.") != std::string::npos || lower.find("192.168.") != std::string::npos;
  if ((is_local && !allow_local) || (is_private && !allow_private)) {
    throw AxError("mcp", "MCP endpoint host is not allowed by SSRF protection");
  }
  return endpoint;
}

class FixtureUCPBinding final : public AxUCPBinding {
 public:
  explicit FixtureUCPBinding(Value response) : response_(std::move(response)) {}
  Value call(const std::string&, Value, Value) override { return response_; }
 private:
  Value response_;
};

void run_mcp_conformance_fixture(Value fixture) {
  std::string op = display(Core::get(fixture, "operation", "initialize"));
  std::string expected_error = display(Core::get(fixture, "expected_error_contains", ""));
  try {
    if (op == "ssrf") {
      ax_mcp_validate_endpoint(display(Core::get(fixture, "endpoint", "https://127.0.0.1/mcp")), Core::get(fixture, "ssrfProtection", Value::object()));
      if (!expected_error.empty()) throw AxError("fixture", "expected SSRF validation to fail");
      return;
    }
    if (op == "stdio_framing") {
      std::string line = ax_mcp_stdio_encode(Core::get(fixture, "message", Value::object()));
      if (!Core::get(fixture, "expected_line", Value()).is_null() && line != display(Core::get(fixture, "expected_line"))) {
        throw AxError("fixture", "stdio line mismatch");
      }
      expect_subset_local(ax_mcp_stdio_decode(line), Core::get(fixture, "message", Value::object()), "stdio decoded");
      return;
    }
    if (op == "oauth_discovery") {
      expect_subset_local(Core::mcp_oauth_parse_www_authenticate(Core::get(fixture, "www_authenticate", "")), Core::get(fixture, "expected_parse", Value::object()), "OAuth WWW-Authenticate parsing");
      expect_subset_local(Core::mcp_oauth_discovery_endpoints(Core::get(fixture, "requested_url", ""), Core::get(fixture, "issuer", ""), Core::get(fixture, "resource_metadata_url", "")), Core::get(fixture, "expected_endpoints", Value::object()), "OAuth discovery endpoints");
      for (auto raw : Core::iter(Core::get(fixture, "coverage_cases", Value::array()))) expect_subset_local(Core::mcp_oauth_validate_resource_coverage(Core::get(raw, "requested_url", ""), Core::get(raw, "metadata", Value::object())), Core::get(raw, "expected", Value::object()), "OAuth resource coverage");
      return;
    }
    if (op == "oauth_as_metadata") {
      for (auto raw : Core::iter(Core::get(fixture, "cases", Value::array()))) expect_subset_local(Core::mcp_oauth_validate_as_metadata(Core::get(raw, "metadata", Value::object()), Core::get(raw, "expected_issuer", ""), Core::get(raw, "require_authorization", false), Core::get(raw, "client_auth_method", "none")), Core::get(raw, "expected", Value::object()), "OAuth AS metadata");
      return;
    }
    if (op == "oauth_token") {
      Value authorization = Core::get(fixture, "authorization", Value::object()); Array args = as_array_local(Core::get(authorization, "args", Value::array()));
      expect_subset_local(Core::mcp_oauth_authorization_request_params(args.at(0), args.at(1), args.at(2), args.at(3), args.at(4), args.at(5)), Core::get(authorization, "expected", Value::object()), "OAuth authorization params");
      for (auto raw : Core::iter(Core::get(fixture, "grant_cases", Value::array()))) { args = as_array_local(Core::get(raw, "args", Value::array())); expect_subset_local(Core::mcp_oauth_grant_body(args.at(0), args.at(1), args.at(2), args.at(3), args.at(4), args.at(5), args.at(6), args.at(7), args.at(8), args.at(9)), Core::get(raw, "expected", Value::object()), "OAuth grant body"); }
      for (auto raw : Core::iter(Core::get(fixture, "token_cases", Value::array()))) expect_subset_local(Core::mcp_oauth_parse_token_response(Core::get(raw, "response", Value::object()), Core::get(raw, "now_ms", 0), Core::get(raw, "previous_refresh_token", ""), Core::get(raw, "issuer", "")), Core::get(raw, "expected", Value::object()), "OAuth token response");
      for (auto raw : Core::iter(Core::get(fixture, "plan_cases", Value::array()))) expect_subset_local(Core::mcp_oauth_plan_ensure_token(Core::get(raw, "token", Value()), Core::get(raw, "now_ms", 0), Core::get(raw, "force_refresh", false), Core::get(raw, "grant_type", "authorization_code"), Core::get(raw, "has_on_auth_code", false)), Core::get(raw, "expected", Value::object()), "OAuth token plan");
      return;
    }
    if (op == "oauth_issuer") {
      for (auto raw : Core::iter(Core::get(fixture, "cases", Value::array()))) {
        Value actual = Core::mcp_oauth_validate_issuer(Core::get(raw, "response", Value::object()), Core::get(raw, "expected_issuer", ""), Core::get(raw, "require_iss", false));
        expect_subset_local(actual, Core::get(raw, "expected", Value::object()), "OAuth issuer validation");
      }
      return;
    }
    if (op == "oauth") {
      std::string challenge = ax_mcp_pkce_challenge(display(Core::get(fixture, "verifier", "test-verifier")));
      if (!Core::get(fixture, "expected_challenge", Value()).is_null() && challenge != display(Core::get(fixture, "expected_challenge"))) {
        throw AxError("fixture", "PKCE challenge mismatch");
      }
      Value stored = Core::get(fixture, "stored_token", Value::object()); AxMCPStreamableHTTPTransport transport(display(Core::get(fixture, "endpoint", "https://example.com/mcp"))); transport.oauth.getToken = [stored](const std::string&){return stored;};
      if (!transport.apply_oauth() || display(Core::get(transport.headers(), "Authorization", "")) != display(Core::get(fixture, "expected_authorization", ""))) throw AxError("fixture", "OAuth cached token did not set Authorization");
      return;
    }
    if (op == "discover") {
      Value constants = Core::mcp_protocol_constants();
      std::string version = display(Core::get(fixture, "protocol_version", "2026-07-28"));
      bool found = false;
      for (auto candidate : as_array_local(Core::get(constants, "supportedProtocolVersions", Value::array()))) if (display(candidate) == version) found = true;
      if (!found) throw AxError("fixture", "missing supported MCP protocol version " + version);
      Value request = Core::mcp_jsonrpc_request(Core::get(fixture, "request_id", "discover-1"), "server/discover", Core::get(fixture, "params", Value::object()));
      expect_subset_local(request, Core::get(fixture, "expected_request", Value::object()), "discover request");
      return;
    }
    if (op == "modern_headers") {
      Value headers = Core::mcp_modern_request_headers(Core::get(fixture, "method", "server/discover"), Core::get(fixture, "resource_name", Value()), Core::get(fixture, "protocol_version", Value()));
      expect_subset_local(headers, Core::get(fixture, "expected_headers", Value::object()), "modern headers");
      for (auto key : as_array_local(Core::get(fixture, "forbidden_headers", Value::array()))) if (!Core::get(headers, display(key), Value()).is_null()) throw AxError("fixture", "modern headers contain forbidden " + display(key));
      return;
    }
    if (op == "era_classification") {
      Value classification = Core::mcp_classify_discovery_result(Core::get(fixture, "discovery_result", Value()));
      expect_subset_local(classification, Core::get(fixture, "expected_classification", Value::object()), "discovery classification");
      for (auto invalid : as_array_local(Core::get(fixture, "invalid_discovery_results", Value::array()))) {
        if (Core::truthy(Core::get(Core::mcp_classify_discovery_result(invalid), "valid", true))) throw AxError("fixture", "invalid discovery result classified as valid");
      }
      for (auto raw : as_array_local(Core::get(fixture, "era_cases", Value::array()))) {
        Value actual = Core::mcp_resolve_known_era(Core::get(raw, "configured", "auto"), Core::get(raw, "hint", Value()), Core::get(raw, "cached", Value()), Core::get(raw, "stored", Value()));
        expect_subset_local(actual, Core::get(raw, "expected", Value::object()), "era resolution");
      }
      Value capability_case = Core::get(fixture, "capability_case", Value::object());
      Value capabilities = Core::mcp_client_capabilities(Core::get(capability_case, "has_roots", false), Core::get(capability_case, "has_sampling", false), Core::get(capability_case, "has_elicitation", false), Core::get(capability_case, "era", "legacy"), Core::get(capability_case, "tasks_extension", false));
      expect_subset_local(capabilities, Core::get(capability_case, "expected", Value::object()), "client capabilities");
      for (auto raw : as_array_local(Core::get(fixture, "request_name_cases", Value::array()))) {
        std::string actual = display(Core::mcp_request_name(Core::get(raw, "method", ""), Core::get(raw, "params", Value::object())));
        if (actual != display(Core::get(raw, "expected", ""))) throw AxError("fixture", "request name mismatch");
      }
      return;
    }
    if (op == "mutual_version") {
      for (auto raw : as_array_local(Core::get(fixture, "cases", Value::array()))) {
        std::string actual = display(Core::mcp_select_mutual_version(Core::get(raw, "error_data", Value()), Core::get(raw, "client_versions", Value::array())));
        if (actual != display(Core::get(raw, "expected_version", ""))) throw AxError("fixture", "mutual version mismatch");
      }
      return;
    }
    if (op == "request_meta") {
      Value actual = Core::mcp_build_request_meta(Core::get(fixture, "existing", Value()), Core::get(fixture, "protocol_version", "2026-07-28"), Core::get(fixture, "client_capabilities", Value::object()), Core::get(fixture, "client_info", Value::object()), Core::get(fixture, "log_level", Value()), Core::get(fixture, "traceparent", Value()), Core::get(fixture, "tracestate", Value()));
      expect_subset_local(actual, Core::get(fixture, "expected_meta", Value::object()), "request meta");
      return;
    }
    if (op == "extension_negotiation") {
      Value actual = Core::mcp_negotiate_extensions(Core::get(fixture, "client_extensions", Value::object()), Core::get(fixture, "server_extensions", Value::object()));
      Value expected = Core::get(fixture, "expected_extensions", Value::object());
      expect_subset_local(actual, expected, "extension negotiation");
      expect_subset_local(expected, actual, "extension negotiation");
      return;
    }
    if (op == "param_headers") {
      Value bindings = Core::mcp_param_header_bindings(Core::get(fixture, "input_schema", Value::object()));
      Value expected_bindings = Core::get(fixture, "expected_bindings", Value::array());
      expect_subset_local(bindings, expected_bindings, "parameter header bindings");
      expect_subset_local(expected_bindings, bindings, "parameter header bindings");
      Value values = Core::mcp_param_header_values(bindings, Core::get(fixture, "arguments", Value::object()));
      Value expected_values = Core::get(fixture, "expected_values", Value::object());
      expect_subset_local(values, expected_values, "parameter header values");
      expect_subset_local(expected_values, values, "parameter header values");
      for (auto raw : as_array_local(Core::get(fixture, "invalid_schemas", Value::array()))) {
        bool rejected = false;
        try {
          Core::mcp_param_header_bindings(Core::get(raw, "schema", Value::object()));
        } catch (const std::exception& error) {
          rejected = true;
          if (std::string(error.what()).find(display(Core::get(raw, "expected_error_contains", ""))) == std::string::npos) throw;
        }
        if (!rejected) throw AxError("fixture", "invalid parameter header schema was accepted");
      }
      for (auto raw : as_array_local(Core::get(fixture, "invalid_values", Value::array()))) {
        bool rejected = false;
        try {
          Core::mcp_param_header_values(bindings, Core::get(raw, "arguments", Value::object()));
        } catch (const std::exception& error) {
          rejected = true;
          if (std::string(error.what()).find(display(Core::get(raw, "expected_error_contains", ""))) == std::string::npos) throw;
        }
        if (!rejected) throw AxError("fixture", "invalid parameter header value was accepted");
      }
      return;
    }
    if (op == "header_value") {
      for (auto raw : as_array_local(Core::get(fixture, "cases", Value::array()))) {
        Value actual = Core::mcp_header_value_plan(Core::get(raw, "value", ""));
        Value expected_plan = Core::get(raw, "expected_plan", Value::object());
        expect_subset_local(actual, expected_plan, "header value plan");
        expect_subset_local(expected_plan, actual, "header value plan");
      }
      return;
    }
    if(op=="cache_fold"){
      for(auto raw:as_array_local(Core::get(fixture,"cases",Value::array()))){auto actual=Core::mcp_fold_cache_info(Core::get(raw,"pages",Value::array()),Core::get(raw,"fetched_at",0));expect_subset_local(actual,Core::get(raw,"expected",Value::object()),"cache info");for(auto field:as_array_local(Core::get(raw,"forbidden_fields",Value::array())))if(value_has(actual,display(field)))throw AxError("fixture","cache info contains forbidden field "+display(field));auto fresh=Core::truthy(Core::mcp_cache_freshness(actual,Core::get(raw,"now",0)));if(fresh!=Core::truthy(Core::get(raw,"expected_fresh",false)))throw AxError("fixture","cache freshness mismatch");}
      return;
    }
    if(op=="tasks_v2_violations"){for(auto raw:as_array_local(Core::get(fixture,"validation_cases",Value::array()))){auto actual=Core::truthy(Core::mcp_validate_modern_task(Core::get(raw,"task",Value::object())));if(actual!=Core::truthy(Core::get(raw,"expected_valid",false)))throw AxError("fixture","modern task validation mismatch");}for(auto raw:as_array_local(Core::get(fixture,"terminal_cases",Value::array())))expect_subset_local(Core::mcp_task_terminal_outcome(Core::get(raw,"task",Value::object())),Core::get(raw,"expected",Value::object()),"task terminal outcome");for(auto scenario:as_array_local(Core::get(fixture,"scenarios",Value::array()))){auto transport=std::make_shared<AxMCPScriptedTransport>(Core::get(scenario,"responses",Value::array()));AxMCPClient client(transport,Core::get(scenario,"client_options",Value::object()));client.init();try{client.call_tool("slow",Value::object());throw AxError("fixture","expected Tasks v2 protocol violation");}catch(const AxError& error){if(std::string(error.what()).find(display(Core::get(scenario,"expected_error","")))==std::string::npos)throw;}}return;}
    if(op=="mrtr_violations"){for(auto raw:as_array_local(Core::get(fixture,"plan_cases",Value::array())))expect_subset_local(Core::mcp_mrtr_plan_round(Core::get(raw,"result",Value::object()),Core::get(raw,"era","legacy"),Core::get(raw,"method","tools/call"),Core::get(raw,"round",0),Core::get(raw,"max_rounds",Value())),Core::get(raw,"expected",Value::object()),"MRTR round plan");for(auto raw:as_array_local(Core::get(fixture,"fulfill_cases",Value::array())))expect_subset_local(Core::mcp_mrtr_plan_fulfillment(Core::get(raw,"input_requests",Value::object()),Core::get(raw,"roots",Value()),Core::get(raw,"has_elicitation",false),Core::get(raw,"has_sampling",false)),Core::get(raw,"expected",Value::object()),"MRTR fulfillment plan");for(auto raw:as_array_local(Core::get(fixture,"next_params_cases",Value::array()))){auto actual=Core::mcp_mrtr_next_params(Core::get(raw,"base_params",Value::object()),Core::get(raw,"input_responses",Value()),Core::get(raw,"request_state",Value()));if(display(Core::json_stringify(actual))!=display(Core::json_stringify(Core::get(raw,"expected",Value::object()))))throw AxError("fixture","MRTR next params mismatch");}return;}
    if (op == "http_session_headers") {
      AxMCPStreamableHTTPTransport transport(display(Core::get(fixture, "endpoint", "https://example.com/mcp")), Core::get(fixture, "transport_options", Value::object()));
      transport.set_session_id(display(Core::get(fixture, "session_id", "session-1")));
      transport.set_protocol_version(display(Core::get(fixture, "protocol_version", AX_MCP_PROTOCOL_VERSION)));
      expect_subset_local(transport.build_headers(object({{"Accept", "application/json"}})), Core::get(fixture, "expected_headers", Value::object()), "headers");
      return;
    }
    if (op == "modern_transport_headers") {
      AxMCPStreamableHTTPTransport transport(display(Core::get(fixture, "endpoint", "https://example.com/mcp")));
      transport.set_session_id(display(Core::get(fixture, "session_id", "legacy-session")));
      transport.set_era(display(Core::get(fixture, "era", "modern")));
      transport.set_protocol_version(display(Core::get(fixture, "protocol_version", "2026-07-28")));
      Value headers=transport.build_headers(object({{"Accept","application/json"}}),true,display(Core::get(fixture,"method","")),Core::get(fixture,"params",Value::object()),Core::get(fixture,"extra_headers",Value::object()));
      expect_subset_local(headers,Core::get(fixture,"expected_headers",Value::object()),"modern headers");
      for(auto name:as_array_local(Core::get(fixture,"forbidden_headers",Value::array())))if(value_has(headers,display(name)))throw AxError("fixture","forbidden modern header present: "+display(name));
      if(transport.era_cache_key()!=display(Core::get(fixture,"expected_era_cache_key","")))throw AxError("fixture","era cache key mismatch");
      try{transport.start_listening();throw AxError("fixture","modern transport allowed legacy HTTP GET listening");}catch(const AxError& error){if(std::string(error.what()).find(display(Core::get(fixture,"expected_listen_error_contains","")))==std::string::npos)throw;}
      return;
    }
    if (op == "execution_context_ucp") {
      auto transport = std::make_shared<AxMCPScriptedTransport>(Core::get(fixture, "responses", Value::array()));
      auto mcp = std::make_shared<AxMCPClient>(transport, Core::get(fixture, "client_options", Value::object()));
      auto ucp = std::make_shared<AxUCPClient>(Core::get(fixture, "ucp_profile", Value::object()), std::make_shared<FixtureUCPBinding>(Core::get(fixture, "ucp_response", Value::object())), Core::get(fixture, "ucp_options", Value::object()));
      AxExecutionContext context({mcp}, {ucp}); context.initialize();
      Array actual_names; for (auto& name : context.namespaces()) actual_names.push_back(name);
      expect_subset_local(Value(actual_names), Core::get(fixture, "expected_namespaces", Value::array()), "context namespaces");
      auto tools = context.native_tools();
      for (auto expected : as_array_local(Core::get(fixture, "expected_native_tools", Value::array()))) {
        bool found = false; for (auto& tool : tools) found = found || tool.name == display(expected);
        if (!found) throw AxError("fixture", "missing native context tool " + display(expected));
      }
      auto runtime_modules = as_array_local(context.runtime_modules());
      for (auto raw_expected_module : as_array_local(Core::get(fixture, "expected_runtime_modules", Value::array()))) {
        auto expected_name = display(Core::get(raw_expected_module, "name", ""));
        Value actual_module;
        for (auto raw_module : runtime_modules) if (display(Core::get(raw_module, "name", "")) == expected_name) { actual_module = raw_module; break; }
        if (actual_module.is_null()) throw AxError("fixture", "missing runtime module " + expected_name);
        std::set<std::string> function_names; for (auto function : as_array_local(Core::get(actual_module, "functions", Value::array()))) function_names.insert(display(function));
        for (auto expected_function : as_array_local(Core::get(raw_expected_module, "functions", Value::array()))) if (!function_names.count(display(expected_function))) throw AxError("fixture", "missing runtime callable " + expected_name + "." + display(expected_function));
      }
      AxAgent protocol_agent(Value("question:string -> answer:string"), Value::object()); context.attach(protocol_agent);
      std::set<std::string> callable_paths; for (auto group : as_array_local(protocol_agent.get_callable_inventory())) for (auto callable : as_array_local(Core::get(group, "callables", Value::array()))) callable_paths.insert(display(Core::get(callable, "qualified_name", "")));
      for (auto expected_path : as_array_local(Core::get(fixture, "expected_agent_callable_paths", Value::array()))) if (!callable_paths.count(display(expected_path))) throw AxError("fixture", "missing agent runtime callable " + display(expected_path));
      Value call = Core::get(fixture, "call_ucp", Value::object());
      Value outcome = ucp->call(display(Core::get(call, "operation", "catalog.search")), Core::get(call, "payload", Value::object()), "fixture-key");
      expect_subset_local(outcome, Core::get(fixture, "expected_ucp_outcome", Value::object()), "UCP outcome");
      if (context.continuation_state().catalog_fingerprint.empty()) throw AxError("fixture", "invalid execution context continuation state");
      return;
    }
    auto transport = std::make_shared<AxMCPScriptedTransport>(Core::get(fixture, "responses", Core::get(fixture, "transport_responses", Value::array())));
    AxMCPClient client(transport, Core::get(fixture, "client_options", Value::object()));
    Value elicitation_params=Value::object();Value elicitation_context=Value::object();int elicitation_calls=0;if(op=="mrtr_elicitation"||op=="tasks_v2_input_required"||op=="server_requests_legacy")client.set_elicitation_handler([&](Value params,Value context){if(Core::truthy(Core::get(params,"fail",false)))throw AxError("mcp","fixture handler failed");++elicitation_calls;elicitation_params=params;elicitation_context=context;return Core::get(fixture,"elicitation_result",Value::object());});
    client.init();
    if (op!="client_discovery" && !Core::get(fixture, "expected_protocol_version", Value()).is_null() &&
        client.protocol_version() != display(Core::get(fixture, "expected_protocol_version"))) {
      throw AxError("fixture", "protocol version mismatch");
    }
    if(op=="client_discovery"){
      auto call=Core::get(fixture,"call_tool",Value());if(!call.is_null())expect_subset_local(client.call_tool(display(Core::get(call,"name","")),Core::get(call,"arguments",Value::object())),Core::get(fixture,"expected_call_result",Value::object()),"tool result");
      if(client.get_era()!=display(Core::get(fixture,"expected_era","")))throw AxError("fixture","era mismatch");if(!Core::get(fixture,"expected_protocol_version",Value()).is_null()&&client.protocol_version()!=display(Core::get(fixture,"expected_protocol_version")))throw AxError("fixture","protocol version mismatch");
      Array names;for(auto tool:as_array_local(client.inspect_catalog(false).tools))names.push_back(display(Core::get(tool,"name","")));expect_subset_local(Value(names),Core::get(fixture,"expected_tool_names",Value::array()),"tool names");expect_subset_local(client.inspect_catalog(false).server_info,Core::get(fixture,"expected_server_info",Value::object()),"server info");
      auto expected=as_array_local(Core::get(fixture,"expected_requests",Value::array()));if(transport->requests.size()<expected.size())throw AxError("fixture","not enough MCP requests");for(size_t index=0;index<expected.size();++index)expect_subset_local(transport->requests[index],expected[index],"request");auto expected_headers=as_array_local(Core::get(fixture,"expected_request_headers",Value::array()));for(size_t index=0;index<expected_headers.size();++index)expect_subset_local(transport->request_headers[index],expected_headers[index],"request headers");
      for(auto forbidden:as_array_local(Core::get(fixture,"forbidden_methods",Value::array()))){auto method=display(forbidden);for(auto item:transport->requests)if(display(Core::get(item,"method",""))==method)throw AxError("fixture","forbidden modern method emitted");for(auto item:transport->notifications)if(display(Core::get(item,"method",""))==method)throw AxError("fixture","forbidden modern method emitted");}auto expected_notifications=Core::get(fixture,"expected_notification_methods",Value());if(!expected_notifications.is_null()){Array methods;for(auto item:transport->notifications)methods.push_back(display(Core::get(item,"method","")));expect_subset_local(Value(methods),expected_notifications,"notification methods");}
    } else if(op=="read_cache"){
      client.refresh(false);int catalogs=0;for(auto request:transport->requests){auto method=display(Core::get(request,"method",""));if(method=="resources/list"||method=="resources/templates/list")++catalogs;}if(catalogs!=static_cast<int>(Core::number(Core::get(fixture,"expected_catalog_requests_after_fresh_refresh",0))))throw AxError("fixture","fresh catalog issued extra requests");auto uri=display(Core::get(fixture,"uri",""));auto first=client.read_resource(uri);auto second=client.read_resource(uri);expect_subset_local(first,Core::get(fixture,"expected_first",Value::object()),"first resource read");expect_subset_local(second,Core::get(fixture,"expected_first",Value::object()),"cached resource read");transport->emit(Core::get(fixture,"notification",Value::object()));auto after=client.read_resource(uri);expect_subset_local(after,Core::get(fixture,"expected_after_update",Value::object()),"resource read after update");int reads=0;for(auto request:transport->requests)if(display(Core::get(request,"method",""))=="resources/read")++reads;if(reads!=static_cast<int>(Core::number(Core::get(fixture,"expected_read_requests",0))))throw AxError("fixture","resource read request count mismatch");
    } else if(op=="tasks_v2_modern"){expect_subset_local(client.call_tool("slow",Value::object()),Core::get(fixture,"expected_call_result",Value::object()),"task call result");client.provide_task_input("task-1",Value::object());client.cancel_task("task-1");try{client.list_tasks();throw AxError("fixture","missing modern tasks/list rejection");}catch(const AxError& error){if(std::string(error.what()).find(display(Core::get(fixture,"expected_list_error","")))==std::string::npos)throw;}try{client.get_task_result("task-1");throw AxError("fixture","missing modern tasks/result rejection");}catch(const AxError& error){if(std::string(error.what()).find(display(Core::get(fixture,"expected_result_error","")))==std::string::npos)throw;}Array methods;for(auto request:transport->requests)methods.push_back(display(Core::get(request,"method","")));expect_subset_local(Value(methods),Core::get(fixture,"expected_methods",Value::array()),"task request methods");if(methods.size()!=as_array_local(Core::get(fixture,"expected_methods",Value::array())).size())throw AxError("fixture","task request method count mismatch");
    } else if(op=="tasks_v2_input_required"){expect_subset_local(client.call_tool("slow",Value::object()),Core::get(fixture,"expected_result",Value::object()),"task input-required result");if(elicitation_calls!=1)throw AxError("fixture","task elicitation handler count mismatch");expect_subset_local(elicitation_params,Core::get(fixture,"expected_elicitation_params",Value::object()),"task elicitation params");expect_subset_local(elicitation_context,Core::get(fixture,"expected_context",Value::object()),"task elicitation context");Value update;Array methods;for(auto request:transport->requests){methods.push_back(display(Core::get(request,"method","")));if(display(Core::get(request,"method",""))=="tasks/update")update=request;}expect_subset_local(Core::get(update,"params",Value::object()),Core::get(fixture,"expected_update_params",Value::object()),"task update params");if(display(Core::json_stringify(Value(methods)))!=display(Core::json_stringify(Core::get(fixture,"expected_methods",Value::array()))))throw AxError("fixture","task input-required methods mismatch");
    } else if(op=="server_requests_legacy"){for(auto request:as_array_local(Core::get(fixture,"server_requests",Value::array())))transport->emit(request);auto expected=as_array_local(Core::get(fixture,"expected_responses",Value::array()));for(size_t index=0;index<expected.size();++index)expect_subset_local(transport->sent_responses[index],expected[index],"server response");if(elicitation_calls!=1)throw AxError("fixture","legacy elicitation handler count mismatch");expect_subset_local(elicitation_params,Core::get(fixture,"expected_elicitation_params",Value::object()),"legacy elicitation params");expect_subset_local(elicitation_context,Core::get(fixture,"expected_context",Value::object()),"legacy elicitation context");Value initialize;for(auto request:transport->requests)if(display(Core::get(request,"method",""))=="initialize")initialize=request;expect_subset_local(Core::get(Core::get(initialize,"params",Value::object()),"capabilities",Value::object()),Core::get(fixture,"expected_legacy_capabilities",Value::object()),"legacy client capabilities");
    } else if(op=="mrtr_elicitation"){expect_subset_local(client.call_tool("work",object({{"value",1}})),Core::get(fixture,"expected_result",Value::object()),"MRTR elicitation result");if(elicitation_calls!=1)throw AxError("fixture","MRTR elicitation handler count mismatch");expect_subset_local(elicitation_params,Core::get(fixture,"expected_elicitation_params",Value::object()),"MRTR elicitation params");expect_subset_local(elicitation_context,Core::get(fixture,"expected_context",Value::object()),"MRTR elicitation context");std::vector<Value> tool_calls;for(auto request:transport->requests)if(display(Core::get(request,"method",""))=="tools/call")tool_calls.push_back(request);auto expected_calls=as_array_local(Core::get(fixture,"expected_call_params",Value::array()));for(size_t index=0;index<expected_calls.size();++index)expect_subset_local(Core::get(tool_calls[index],"params",Value::object()),expected_calls[index],"MRTR elicitation call params");auto capabilities=Core::get(Core::get(Core::get(transport->requests.front(),"params",Value::object()),"_meta",Value::object()),"io.modelcontextprotocol/clientCapabilities",Value::object());if(!value_has(capabilities,"elicitation")||value_has(capabilities,"sampling"))throw AxError("fixture","dishonest MRTR capabilities");auto bad_transport=std::make_shared<AxMCPScriptedTransport>(Value::array());AxMCPClient bad(bad_transport,object({{"era","modern"},{"sampling",true}}));try{bad.init();throw AxError("fixture","truthy sampling option was accepted");}catch(const AxError& error){if(std::string(error.what()).find("sampling is not supported")==std::string::npos)throw;}
    } else if(op=="mrtr_roots"){expect_subset_local(client.call_tool("work",object({{"value",1}})),Core::get(fixture,"expected_call_result",Value::object()),"MRTR tool result");expect_subset_local(client.get_prompt("ask",Value::object()),Core::get(fixture,"expected_prompt_result",Value::object()),"MRTR prompt result");expect_subset_local(client.read_resource("file:///resource"),Core::get(fixture,"expected_resource_result",Value::object()),"MRTR resource result");Array methods;std::vector<Value> tool_calls;std::set<std::string> ids;for(auto request:transport->requests){auto method=display(Core::get(request,"method",""));methods.push_back(method);if(method=="tools/call"){tool_calls.push_back(request);auto id=display(Core::get(request,"id",""));if(!ids.insert(id).second)throw AxError("fixture","MRTR rounds reused a request id");}}if(display(Core::json_stringify(Value(methods)))!=display(Core::json_stringify(Core::get(fixture,"expected_methods",Value::array()))))throw AxError("fixture","MRTR request methods mismatch");auto expected_params=as_array_local(Core::get(fixture,"expected_tool_call_params",Value::array()));for(size_t index=0;index<expected_params.size();++index){auto expected=expected_params[index];auto params=Core::get(tool_calls[index],"params",Value::object());expect_subset_local(params,expected,"MRTR tool params");if(!value_has(expected,"inputResponses")){if(value_has(params,"inputResponses")||value_has(params,"requestState"))throw AxError("fixture","initial MRTR request included round state");}else{auto actual_responses=as_object_local(Core::get(params,"inputResponses",Value::object()));auto wanted_responses=as_object_local(Core::get(expected,"inputResponses",Value::object()));if(actual_responses.size()!=wanted_responses.size())throw AxError("fixture","MRTR request retained stale input responses");for(const auto& item:wanted_responses)if(!value_has(Core::get(params,"inputResponses",Value::object()),item.first))throw AxError("fixture","MRTR request retained stale input responses");}if(!value_has(expected,"requestState")&&value_has(params,"requestState"))throw AxError("fixture","MRTR request retained stale requestState");}
    } else if(op=="subscriptions_listen"){for(auto item:as_array_local(Core::get(fixture,"semantic_cases",Value::array()))){auto actual=Core::mcp_listen_interests(Core::get(item,"subscribed_uris",Value::array()),Core::get(item,"filters",Value::object()));if(!equal(actual,Core::get(item,"expected",Value::object())))throw AxError("fixture","listen interests mismatch");}std::vector<Value> delivered;client.add_notification_listener([&](Value message){delivered.push_back(message);});client.start_listening();if(transport->request_streams.size()!=1)throw AxError("fixture","initial subscriptions/listen stream missing");auto first=transport->request_streams.front();expect_subset_local(Core::get(Core::get(first,"params",Value::object()),"notifications",Value::object()),Core::get(fixture,"expected_first_notifications",Value::object()),"initial listen interests");client.acquire_resource_subscription(display(Core::get(fixture,"uri","")),"fixture");if(transport->request_streams.size()!=static_cast<size_t>(Core::number(Core::get(fixture,"expected_stream_count",0))))throw AxError("fixture","subscription interest change did not restart request stream");auto second=transport->request_streams.back();if(equal(Core::get(first,"id",Value()),Core::get(second,"id",Value())))throw AxError("fixture","subscriptions/listen restart reused its request id");expect_subset_local(Core::get(Core::get(second,"params",Value::object()),"notifications",Value::object()),Core::get(fixture,"expected_second_notifications",Value::object()),"updated listen interests");auto count_updates=[&](){return std::count_if(delivered.begin(),delivered.end(),[](const Value& item){return display(Core::get(item,"method",""))=="notifications/resources/updated";});};auto before=count_updates();auto notification=Core::json_parse(Core::json_stringify(Core::get(fixture,"delivered_notification",Value::object())));auto params=Core::get(notification,"params",Value::object());Core::set(params,"_meta",object({{"io.modelcontextprotocol/subscriptionId","other"}}));Core::set(notification,"params",params);transport->emit(notification);if(count_updates()!=before)throw AxError("fixture","cross-subscription notification was delivered");auto meta=Core::get(params,"_meta",Value::object());Core::set(meta,"io.modelcontextprotocol/subscriptionId",Core::get(second,"id",Value()));Core::set(params,"_meta",meta);Core::set(notification,"params",params);transport->emit(notification);if(count_updates()!=before+1)throw AxError("fixture","active subscription notification was not delivered");if(value_has(Core::get(delivered.back(),"params",Value::object()),"_meta"))throw AxError("fixture","subscription id leaked to notification consumer");for(auto forbidden:as_array_local(Core::get(fixture,"expected_forbidden_methods",Value::array())))for(auto request:transport->requests)if(display(Core::get(request,"method",""))==display(forbidden))throw AxError("fixture","modern subscription emitted legacy method");
    } else if (op == "ping") {
      client.ping();
    } else if (op == "tools") {
      auto functions = client.native_tools();
      if (!Core::get(fixture, "call_function", Value()).is_null()) {
        Value call = Core::get(fixture, "call_function");
        for (auto& fn : functions) {
          if (fn.name == display(Core::get(call, "name", ""))) {
            expect_subset_local(fn.handler(Core::get(call, "arguments", Value::object())), Core::get(fixture, "expected_call_result", Value::object()), "tool result");
          }
        }
      }
    } else if (op == "cancellation") {
      client.cancel_request(Core::get(fixture, "request_id", "1"), display(Core::get(fixture, "reason", "cancelled")));
      if (transport->notifications.empty()) throw AxError("fixture", "expected a cancel notification");
      expect_subset_local(transport->notifications.back(), Core::get(fixture, "expected_notification", Value::object()), "cancel notification");
    } else if (op == "prompts_resources") {
      auto catalog_names = [](Value catalog) {
        Array names;
        for (auto item : as_array_local(catalog)) names.push_back(display(Core::get(item, "name", "")));
        return Value(names);
      };
      expect_subset_local(catalog_names(client.prompts()), Core::get(fixture, "expected_prompt_names", Value::array()), "prompt names");
      expect_subset_local(catalog_names(client.resources()), Core::get(fixture, "expected_resource_names", Value::array()), "resource names");
      expect_subset_local(catalog_names(client.resource_templates()), Core::get(fixture, "expected_resource_template_names", Value::array()), "resource template names");
    } else if (op == "initialize" || op == "protocol_negotiation" || op == "roots_notifications") {
      return;
    } else {
      throw AxError("fixture", "unsupported MCP conformance operation " + op);
    }
  } catch (const std::exception& error) {
    if (!expected_error.empty() && std::string(error.what()).find(expected_error) != std::string::npos) return;
    throw;
  }
}

}  // namespace axllm
