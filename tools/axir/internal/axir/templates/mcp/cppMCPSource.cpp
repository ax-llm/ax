#include "mcp.hpp"

#include <algorithm>
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

AxMCPClient::AxMCPClient(std::shared_ptr<AxMCPTransport> transport, Value options)
    : transport_(std::move(transport)), options_(std::move(options)) { transport_->set_message_handler([this](Value message){emit_notification(std::move(message));});transport_->set_lifecycle_handler([this](std::string state){emit_lifecycle(state);}); }

void AxMCPClient::init() {
  if(initialized_)return;
  transport_->connect();
  Value capabilities = Core::get(options_, "capabilities", Value::object());
  if (!Core::get(options_, "roots", Value()).is_null() && Core::get(capabilities, "roots", Value()).is_null()) {
    Core::set(capabilities, "roots", object({{"listChanged", true}}));
  }
  Value result = request("initialize", object({
      {"protocolVersion", display(Core::get(options_, "protocolVersion", AX_MCP_PROTOCOL_VERSION))},
      {"capabilities", capabilities},
      {"clientInfo", object({{"name", "AxMCPClient"}, {"title", "Ax MCP Client"}, {"version", "1.0.0"}})},
  }));
  negotiated_protocol_version_ = display(Core::get(result, "protocolVersion", ""));
  bool supported = negotiated_protocol_version_ == "2025-11-25" || negotiated_protocol_version_ == "2025-06-18" ||
                   negotiated_protocol_version_ == "2025-03-26" || negotiated_protocol_version_ == "2024-11-05";
  if (!supported) throw AxError("mcp", "Unsupported MCP protocol version " + negotiated_protocol_version_);
  transport_->set_protocol_version(negotiated_protocol_version_);
  server_capabilities_ = Core::get(result, "capabilities", Value::object());
  notify("notifications/initialized");
  refresh();
  initialized_=true;
  transport_->start_listening();
}

void AxMCPClient::close(){initialized_=false;transport_->close();}

void AxMCPClient::refresh() {
  tools_.clear();
  prompts_.clear();
  resources_.clear();
  resource_templates_.clear();
  if (capability("tools")) tools_ = as_array_local(Core::get(list_tools(), "tools", Value::array()));
  if (capability("prompts")) prompts_ = as_array_local(Core::get(list_prompts(), "prompts", Value::array()));
  if (capability("resources")) {
    resources_ = as_array_local(Core::get(list_resources(), "resources", Value::array()));
    resource_templates_ = as_array_local(Core::get(list_resource_templates(), "resourceTemplates", Value::array()));
  }
}

std::string AxMCPClient::protocol_version() const { return negotiated_protocol_version_; }
Value AxMCPClient::ping() { return request("ping"); }
Value AxMCPClient::list_tools(const std::string& cursor) { return request("tools/list", cursor_params(cursor)); }
Value AxMCPClient::call_tool(const std::string& name, Value arguments) { return request("tools/call", object({{"name", name}, {"arguments", arguments}})); }
Value AxMCPClient::list_prompts(const std::string& cursor) { return request("prompts/list", cursor_params(cursor)); }
Value AxMCPClient::get_prompt(const std::string& name, Value arguments) { return request("prompts/get", object({{"name", name}, {"arguments", arguments}})); }
Value AxMCPClient::list_resources(const std::string& cursor) { return request("resources/list", cursor_params(cursor)); }
Value AxMCPClient::read_resource(const std::string& uri) { return request("resources/read", object({{"uri", uri}})); }
Value AxMCPClient::subscribe_resource(const std::string& uri) { return request("resources/subscribe", object({{"uri", uri}})); }
Value AxMCPClient::unsubscribe_resource(const std::string& uri) { return request("resources/unsubscribe", object({{"uri", uri}})); }
Value AxMCPClient::get_task(const std::string& task_id) { return request("tasks/get", object({{"taskId", task_id}})); }
Value AxMCPClient::cancel_task(const std::string& task_id) { return request("tasks/cancel", object({{"taskId", task_id}})); }
Value AxMCPClient::list_resource_templates(const std::string& cursor) { return request("resources/templates/list", cursor_params(cursor)); }

void AxMCPClient::notify(const std::string& method, Value params) {
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
  Value message = object({{"jsonrpc", "2.0"}, {"id", std::to_string(next_id_++)}, {"method", method}});
  if (!params.is_null()) Core::set(message, "params", params);
  Value response = transport_->send(message);
  Value error = Core::get(response, "error", Value());
  if (!error.is_null()) throw AxError("mcp", display(Core::get(error, "message", "MCP JSON-RPC error")));
  return Core::get(response, "result", Value::object());
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
  return configured.empty() ? "mcp" : configured;
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
  for (auto& client : mcp_) { Array functions; for (auto& tool : client->native_tools()) functions.push_back(tool.name); out.push_back(object({{"name", "mcp." + client->namespace_name()}, {"functions", Value(functions)}})); }
  for (auto& client : ucp_) { Array functions; for (auto& tool : client->native_tools()) functions.push_back(tool.name); out.push_back(object({{"name", "ucp." + client->namespace_name()}, {"functions", Value(functions)}})); }
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
void AxExecutionContext::attach(AxAgent& agent) { initialize(); for (auto& client : mcp_) agent.add_tool_module("mcp." + client->namespace_name(), client->native_tools()); for (auto& client : ucp_) agent.add_tool_module("ucp." + client->namespace_name(), client->native_tools()); }

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

AxMCPStreamableHTTPTransport::AxMCPStreamableHTTPTransport(std::string endpoint, Value options)
    : endpoint_(ax_mcp_validate_endpoint(endpoint, Core::get(options, "ssrfProtection", Value::object()))), options_(std::move(options)) {}

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
  Value headers = build_headers(object({{"Content-Type", "application/json"}, {"Accept", "application/json, text/event-stream"}}),
                                display(Core::get(message, "method", "")) != "initialize");
  // Request the raw body (stream:true) so we can branch on the response
  // Content-Type: a spec-compliant MCP server may answer a JSON-RPC POST with an
  // SSE stream (text/event-stream) carrying the response — and any interleaved
  // notifications — in `data:` frames, which must be SSE-parsed rather than
  // JSON-decoded. Otherwise keep the JSON path. (The optional standalone GET
  // stream for unsolicited server->client messages is out of scope here.)
  Value response = http_.call(object({{"url", endpoint_}, {"method", "POST"}, {"headers", headers}, {"json", message}, {"stream", true}}));
  auto response_headers=Core::get(response,"headers",Value::object());
  auto session=display(Core::get(response_headers,"MCP-Session-Id",Core::get(response_headers,"mcp-session-id","")));
  if(!session.empty())session_id_=session;
  Value request_id = Core::get(message, "id", Value());
  std::string body = display(Core::get(response, "body", ""));
  if (body.empty()) return object({{"jsonrpc", "2.0"}, {"id", request_id}, {"result", Value::object()}});
  std::string content_type = display(Core::get(response, "contentType", ""));
  std::transform(content_type.begin(), content_type.end(), content_type.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
  if (content_type.find("text/event-stream") != std::string::npos) {
    return ax_mcp_select_sse_response(ax_mcp_parse_sse(body), request_id, message_handler_);
  }
  return Core::json_parse(body);
}

void AxMCPStreamableHTTPTransport::send_notification(Value message) { (void)send(std::move(message)); }
void AxMCPStreamableHTTPTransport::set_protocol_version(const std::string& protocol_version) { protocol_version_ = protocol_version; }
void AxMCPStreamableHTTPTransport::set_session_id(std::string session_id) { session_id_ = std::move(session_id); }

void AxMCPStreamableHTTPTransport::start_listening(){
  std::lock_guard<std::mutex> lock(listen_mutex_);
  if(listen_thread_.joinable())return;
  listen_stop_=false;
  listen_thread_=std::thread([this]{listen_loop();});
}

void AxMCPStreamableHTTPTransport::close(){
  listen_stop_=true;
  std::thread thread;
  {std::lock_guard<std::mutex> lock(listen_mutex_);if(listen_thread_.joinable())thread=std::move(listen_thread_);}
  if(thread.joinable())thread.join();
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
    if(!payload.empty()&&message_handler_){try{message_handler_(Core::json_parse(payload));}catch(...){}}
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
    curl_easy_setopt(curl,CURLOPT_HEADERFUNCTION,+[](char* ptr,size_t size,size_t nmemb,void* raw)->size_t{auto* self=static_cast<AxMCPStreamableHTTPTransport*>(raw);std::string line(ptr,size*nmemb);auto colon=line.find(':');if(colon!=std::string::npos){auto name=line.substr(0,colon);std::transform(name.begin(),name.end(),name.begin(),[](unsigned char c){return static_cast<char>(std::tolower(c));});if(name=="mcp-session-id"){auto value=line.substr(colon+1);auto begin=value.find_first_not_of(" \t");auto end=value.find_last_not_of(" \t\r\n");if(begin!=std::string::npos)self->session_id_=value.substr(begin,end-begin+1);}}return size*nmemb;});
    curl_easy_setopt(curl,CURLOPT_HEADERDATA,this);curl_easy_setopt(curl,CURLOPT_NOPROGRESS,0L);
    curl_easy_setopt(curl,CURLOPT_XFERINFOFUNCTION,+[](void* raw,curl_off_t,curl_off_t,curl_off_t,curl_off_t)->int{return static_cast<AxMCPStreamableHTTPTransport*>(raw)->listen_stop_?1:0;});curl_easy_setopt(curl,CURLOPT_XFERINFODATA,this);
    auto result=curl_easy_perform(curl);curl_slist_free_all(headers);curl_easy_cleanup(curl);
    if(!listen_stop_&&connected_once&&lifecycle_handler_)lifecycle_handler_("disconnected");
    if(listen_stop_)break;
    if(result!=CURLE_OK||context.announced)std::this_thread::sleep_for(std::chrono::milliseconds(std::max(1L,delay)));
  }
#endif
}

Value AxMCPStreamableHTTPTransport::build_headers(Value base, bool include_protocol) const {
  Value out = Core::map_merge(headers_, base);
  if (!session_id_.empty()) Core::set(out, "MCP-Session-Id", session_id_);
  if (include_protocol && !protocol_version_.empty()) Core::set(out, "MCP-Protocol-Version", protocol_version_);
  return out;
}

bool AxMCPStreamableHTTPTransport::apply_oauth() {
  if (!oauth.onAuthCode) return false;
  Value auth = oauth.onAuthCode(endpoint_ + "?response_type=code&code_challenge=" + ax_mcp_pkce_challenge(ax_mcp_pkce_verifier()));
  std::string code = display(Core::get(auth, "code", ""));
  if (code.empty()) return false;
  Core::set(headers_, "Authorization", "Bearer mcp-auth-code-" + code);
  return true;
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

void AxMCPScriptedTransport::send_notification(Value message) { notifications.push_back(message); }
void AxMCPScriptedTransport::send_response(Value message) { sent_responses.push_back(message); }
void AxMCPScriptedTransport::set_protocol_version(const std::string& protocol_version) { protocol_version_ = protocol_version; }

std::string ax_mcp_stdio_encode(Value message) { return stringify(message) + "\n"; }
Value ax_mcp_stdio_decode(const std::string& line) { return parse_json(line); }

std::string ax_mcp_pkce_verifier() {
  return std::to_string(std::chrono::high_resolution_clock::now().time_since_epoch().count());
}

std::string ax_mcp_pkce_challenge(const std::string& verifier) {
  return "sha256-" + verifier;
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
    if (op == "oauth") {
      std::string challenge = ax_mcp_pkce_challenge(display(Core::get(fixture, "verifier", "test-verifier")));
      if (!Core::get(fixture, "expected_challenge", Value()).is_null() && challenge != display(Core::get(fixture, "expected_challenge"))) {
        throw AxError("fixture", "PKCE challenge mismatch");
      }
      return;
    }
    if (op == "http_session_headers") {
      AxMCPStreamableHTTPTransport transport(display(Core::get(fixture, "endpoint", "https://example.com/mcp")), Core::get(fixture, "transport_options", Value::object()));
      transport.set_session_id(display(Core::get(fixture, "session_id", "session-1")));
      transport.set_protocol_version(display(Core::get(fixture, "protocol_version", AX_MCP_PROTOCOL_VERSION)));
      expect_subset_local(transport.build_headers(object({{"Accept", "application/json"}})), Core::get(fixture, "expected_headers", Value::object()), "headers");
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
      Value call = Core::get(fixture, "call_ucp", Value::object());
      Value outcome = ucp->call(display(Core::get(call, "operation", "catalog.search")), Core::get(call, "payload", Value::object()), "fixture-key");
      expect_subset_local(outcome, Core::get(fixture, "expected_ucp_outcome", Value::object()), "UCP outcome");
      if (context.continuation_state().catalog_fingerprint.empty()) throw AxError("fixture", "invalid execution context continuation state");
      return;
    }
    auto transport = std::make_shared<AxMCPScriptedTransport>(Core::get(fixture, "responses", Core::get(fixture, "transport_responses", Value::array())));
    AxMCPClient client(transport, Core::get(fixture, "client_options", Value::object()));
    client.init();
    if (!Core::get(fixture, "expected_protocol_version", Value()).is_null() &&
        client.protocol_version() != display(Core::get(fixture, "expected_protocol_version"))) {
      throw AxError("fixture", "protocol version mismatch");
    }
    if (op == "ping") {
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
