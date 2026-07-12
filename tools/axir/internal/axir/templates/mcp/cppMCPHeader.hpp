#pragma once

#include "axllm.hpp"

#include <memory>
#include <mutex>
#include <set>
#include <string>
#include <vector>

namespace axllm {

inline const char* AX_MCP_PROTOCOL_VERSION = "2025-11-25";

struct AxMCPTokenSet {
  std::string accessToken;
  std::string refreshToken;
  long expiresAt = 0;
  std::string issuer;
};

struct AxMCPOAuthOptions {
  std::string clientId;
  std::string clientSecret;
  std::string redirectUri;
  std::vector<std::string> scopes;
  std::function<Value(const std::string&)> onAuthCode;
  std::function<Value(const std::string&)> getToken;
  std::function<void(const std::string&, Value)> setToken;
  Value ssrfProtection = Value::object();
};

class AxMCPTransport {
 public:
  virtual ~AxMCPTransport() = default;
  virtual Value send(Value message) = 0;
  virtual void send_notification(Value message) = 0;
  virtual void send_response(Value message) { send_notification(std::move(message)); }
  virtual void set_protocol_version(const std::string&) {}
  virtual void connect() {}
};

class AxMCPClient {
 public:
  AxMCPClient(std::shared_ptr<AxMCPTransport> transport, Value options = Value::object());
  void init();
  void refresh();
  std::string protocol_version() const;
  Value ping();
  Value list_tools(const std::string& cursor = "");
  Value call_tool(const std::string& name, Value arguments = Value::object());
  Value list_prompts(const std::string& cursor = "");
  Value get_prompt(const std::string& name, Value arguments = Value::object());
  Value list_resources(const std::string& cursor = "");
  Value read_resource(const std::string& uri);
  Value list_resource_templates(const std::string& cursor = "");
  void notify(const std::string& method, Value params = Value());
  void cancel_request(Value request_id, const std::string& reason = "");
  std::vector<Tool> to_function();
  std::vector<Tool> native_tools();
  std::string namespace_name() const;
  Value request(const std::string& method, Value params = Value::object());

 private:
  std::shared_ptr<AxMCPTransport> transport_;
  Value options_;
  Value server_capabilities_ = Value::object();
  std::string negotiated_protocol_version_;
  std::vector<Value> tools_;
  std::vector<Value> prompts_;
  std::vector<Value> resources_;
  std::vector<Value> resource_templates_;
  int next_id_ = 1;

  bool capability(const std::string& name) const;
  Tool tool_to_function(Value spec);
  Tool prompt_to_function(Value spec);
  Tool resource_to_function(Value spec);
  Tool resource_template_to_function(Value spec);
};

class AxUCPBinding {
 public:
  virtual ~AxUCPBinding() = default;
  virtual Value call(const std::string& operation, Value payload, Value options) = 0;
};

class AxUCPClient {
 public:
  AxUCPClient(Value profile, std::shared_ptr<AxUCPBinding> binding, Value options = Value::object());
  std::string namespace_name() const;
  std::string version() const;
  Value profile() const;
  Value call(const std::string& operation, Value payload = Value::object(), const std::string& idempotency_key = "");
  std::vector<Tool> native_tools();
  Value catalog_search(Value payload = Value::object());
  Value catalog_lookup(Value payload = Value::object());
  Value catalog_product(Value payload = Value::object());
  Value cart_create(Value payload = Value::object());
  Value cart_get(Value payload = Value::object());
  Value cart_update(Value payload = Value::object());
  Value cart_cancel(Value payload = Value::object());
  Value checkout_create(Value payload = Value::object());
  Value checkout_get(Value payload = Value::object());
  Value checkout_update(Value payload = Value::object());
  Value checkout_complete(Value payload = Value::object());
  Value checkout_cancel(Value payload = Value::object());
  Value order_get(Value payload = Value::object());
  Value identity_link(Value payload = Value::object());

 private:
  Value profile_;
  std::shared_ptr<AxUCPBinding> binding_;
  Value options_;
  std::string version_;
};

struct AxMCPContinuationState {
  std::vector<std::string> namespaces;
  Value tasks = Value::array();
  Value subscriptions = Value::array();
  std::string catalog_fingerprint;
};

struct AxEventEnvelope {
  std::string specversion = "1.0";
  std::string id;
  std::string source;
  std::string type;
  std::string subject;
  Value data;
  Value value() const {
    Value out=Value::object(); Core::set(out,"specversion",specversion);Core::set(out,"id",id);Core::set(out,"source",source);Core::set(out,"type",type);
    if(!subject.empty())Core::set(out,"subject",subject);if(!data.is_null())Core::set(out,"data",data);return out;
  }
};
struct AxEventRoute {
  std::string id;std::string action;Value match=Value::object();std::string targetId;bool requireAuthenticated=false;std::string ordering="strict";long debounceMs=0;
  Value value() const {Value out=Value::object();Core::set(out,"id",id);Core::set(out,"action",action);Core::set(out,"match",match);Core::set(out,"targetId",targetId);Core::set(out,"requireAuthenticated",requireAuthenticated);Core::set(out,"ordering",ordering);Core::set(out,"debounceMs",debounceMs);return out;}
};
struct AxEventCommand {std::string routeId;std::string action;std::string targetId;std::string instanceKey;std::string idempotencyKey;};
class AxEventSource {public:virtual ~AxEventSource()=default;virtual void start(std::function<void(AxEventEnvelope)> publish)=0;};
class AxEventSink {public:virtual ~AxEventSink()=default;virtual void write(Value output,Value context)=0;};
class AxEventClock {public:virtual ~AxEventClock()=default;virtual long now() const=0;};
class AxEventStore {public:virtual ~AxEventStore()=default;virtual void enqueue(AxEventEnvelope event,Value commands)=0;};
class AxEventRuntime {
 public:
  explicit AxEventRuntime(std::vector<AxEventRoute> routes,Value options=Value::object()):routes_(std::move(routes)),options_(std::move(options)){
    Value values=Value::array();for(const auto& route:routes_)Core::append(values,route.value());descriptor_=Core::event_runtime_descriptor(values,options_);
  }
  Value publish(const AxEventEnvelope& event,const std::string& identity_scope="anonymous",const std::string& trust="untrusted") const {Value values=Value::array();for(const auto& route:routes_)Core::append(values,route.value());return Core::event_route_commands(event.value(),values,identity_scope,trust);}
  static Value normalize_mcp(const std::string& namespace_name,const std::string& method,Value params){return Core::event_normalize_mcp(namespace_name,method,std::move(params));}
  Value descriptor()const{return descriptor_;}
 private:std::vector<AxEventRoute> routes_;Value options_;Value descriptor_;
};

class AxExecutionContext {
 public:
  AxExecutionContext(std::vector<std::shared_ptr<AxMCPClient>> mcp = {}, std::vector<std::shared_ptr<AxUCPClient>> ucp = {});
  void initialize();
  std::vector<Tool> native_tools();
  Value runtime_modules();
  std::vector<std::string> namespaces() const;
  AxExecutionContext derive(Value inheritance) const;
  AxMCPContinuationState continuation_state() const;
  void attach(AxGen& gen);
  void attach(AxAgent& agent);

 private:
  std::vector<std::shared_ptr<AxMCPClient>> mcp_;
  std::vector<std::shared_ptr<AxUCPClient>> ucp_;
  std::set<AxMCPClient*> initialized_;
  mutable std::mutex mutex_;
};

class AxMCPStreamableHTTPTransport : public AxMCPTransport {
 public:
  explicit AxMCPStreamableHTTPTransport(std::string endpoint, Value options = Value::object());
  Value send(Value message) override;
  void send_notification(Value message) override;
  void set_protocol_version(const std::string& protocol_version) override;
  void set_session_id(std::string session_id);
  Value build_headers(Value base = Value::object(), bool include_protocol = true) const;
  bool apply_oauth();
  AxMCPOAuthOptions oauth;

 private:
  std::string endpoint_;
  Value options_;
  Value headers_ = Value::object();
  std::string session_id_;
  std::string protocol_version_;
  HttpTransport http_;
};

class AxMCPStdioTransport : public AxMCPTransport {
 public:
  AxMCPStdioTransport(std::string command, std::vector<std::string> args = {});
  Value send(Value message) override;
  void send_notification(Value message) override;
};

class AxMCPScriptedTransport : public AxMCPTransport {
 public:
  explicit AxMCPScriptedTransport(Value responses = Value::array());
  Value send(Value message) override;
  void send_notification(Value message) override;
  void send_response(Value message) override;
  void set_protocol_version(const std::string& protocol_version) override;
  std::vector<Value> requests;
  std::vector<Value> notifications;
  std::vector<Value> sent_responses;

 private:
  std::vector<Value> responses_;
  std::string protocol_version_;
};

std::string ax_mcp_stdio_encode(Value message);
Value ax_mcp_stdio_decode(const std::string& line);
std::string ax_mcp_pkce_verifier();
std::string ax_mcp_pkce_challenge(const std::string& verifier);
std::string ax_mcp_validate_endpoint(const std::string& endpoint, Value options = Value::object());
void run_mcp_conformance_fixture(Value fixture);

}  // namespace axllm
