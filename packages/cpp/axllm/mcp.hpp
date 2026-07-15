#pragma once

#include "axllm.hpp"

#include <algorithm>
#include <memory>
#include <mutex>
#include <atomic>
#include <condition_variable>
#include <chrono>
#include <cstdint>
#include <thread>
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
  virtual void set_message_handler(std::function<void(Value)>) {}
  virtual void set_lifecycle_handler(std::function<void(std::string)>) {}
  virtual void set_protocol_version(const std::string&) {}
  virtual void connect() {}
  virtual void start_listening() {}
  virtual void close() {}
};

struct AxMCPCatalogSnapshot {
  std::string namespace_name;
  std::string protocol_version;
  long revision = 0;
  Value server_info = Value::object();
  Value server_capabilities = Value::object();
  Value tools = Value::array();
  Value prompts = Value::array();
  Value resources = Value::array();
  Value resource_templates = Value::array();
  std::vector<std::string> subscriptions;
};

class AxMCPClient {
 public:
  AxMCPClient(std::shared_ptr<AxMCPTransport> transport, Value options = Value::object());
  void init();
  void close();
  void refresh();
  std::string protocol_version() const;
  Value ping();
  Value list_tools(const std::string& cursor = "");
  Value call_tool(const std::string& name, Value arguments = Value::object());
  Value list_prompts(const std::string& cursor = "");
  Value get_prompt(const std::string& name, Value arguments = Value::object());
  Value list_resources(const std::string& cursor = "");
  Value read_resource(const std::string& uri);
  Value subscribe_resource(const std::string& uri);
  Value unsubscribe_resource(const std::string& uri);
  Value acquire_resource_subscription(const std::string& uri,const std::string& owner);
  Value release_resource_subscription(const std::string& uri,const std::string& owner);
  void restore_resource_subscriptions();
  AxMCPCatalogSnapshot inspect_catalog(bool refresh_catalog=false);
  Value get_task(const std::string& task_id);
  Value cancel_task(const std::string& task_id);
  Value list_resource_templates(const std::string& cursor = "");
  void notify(const std::string& method, Value params = Value());
  void cancel_request(Value request_id, const std::string& reason = "");
  std::vector<Tool> to_function();
  std::vector<Tool> native_tools();
  Value prompts() const;
  Value resources() const;
  Value resource_templates() const;
  std::string namespace_name() const;
  Value request(const std::string& method, Value params = Value::object());
  int add_notification_listener(std::function<void(Value)> listener){int id=next_listener_id_++;notification_listeners_[id]=std::move(listener);return id;}
  void remove_notification_listener(int id){notification_listeners_.erase(id);}
  void emit_notification(Value message){auto listeners=notification_listeners_;for(auto& item:listeners)item.second(message);}
  int add_lifecycle_listener(std::function<void(std::string)> listener){int id=next_listener_id_++;lifecycle_listeners_[id]=std::move(listener);return id;}
  void remove_lifecycle_listener(int id){lifecycle_listeners_.erase(id);}
  void emit_lifecycle(const std::string& state){if(state=="reconnected")restore_resource_subscriptions();auto listeners=lifecycle_listeners_;for(auto& item:listeners)item.second(state);}

 private:
  std::shared_ptr<AxMCPTransport> transport_;
  Value options_;
  Value server_capabilities_ = Value::object();
  Value server_info_ = Value::object();
  std::string negotiated_protocol_version_;
  std::vector<Value> tools_;
  std::vector<Value> prompts_;
  std::vector<Value> resources_;
  std::vector<Value> resource_templates_;
  long catalog_revision_=0;
  std::map<std::string,std::set<std::string>> subscription_owners_;
  int next_id_ = 1;
  int next_listener_id_=1;
  std::map<int,std::function<void(Value)>> notification_listeners_;
  std::map<int,std::function<void(std::string)>> lifecycle_listeners_;
  bool initialized_=false;

  bool capability(const std::string& name) const;
  std::vector<Value> collect_catalog(const std::string& method,const std::string& field);
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
  Value extensions=Value::object();
  std::vector<std::pair<std::string,std::string>> correlation;
  Value value() const {
    Value out=Value::object(); Core::set(out,"specversion",specversion);Core::set(out,"id",id);Core::set(out,"source",source);Core::set(out,"type",type);
    if(!subject.empty())Core::set(out,"subject",subject);if(!data.is_null())Core::set(out,"data",data);if(extensions.is_object())Core::set(out,"extensions",extensions);if(!correlation.empty()){Value keys=Value::array();for(const auto& key:correlation)Core::append(keys,object({{"kind",key.first},{"value",key.second}}));Core::set(out,"correlation",keys);}return out;
  }
};
struct AxEventPath {
  Value descriptor=Value::object();
  static AxEventPath make(const std::string& root,Value segments=Value::array(),Value value=Value()){Value out=object({{"root",root},{"segments",segments}});if(root=="constant")Core::set(out,"value",value);return {out};}
  static AxEventPath data(Value segments=Value::array()){return make("data",segments);}static AxEventPath envelope(Value segments=Value::array()){return make("envelope",segments);}static AxEventPath subject(){return envelope(array({"subject"}));}static AxEventPath extension(std::string name){return make("extensions",array({name}));}static AxEventPath identity(Value segments=Value::array()){return make("identity",segments);}static AxEventPath trust(){return make("trust");}static AxEventPath correlation(std::string kind){auto out=make("correlation");Core::set(out.descriptor,"correlationKind",kind);return out;}static AxEventPath continuation(Value segments=Value::array()){return make("continuation",segments);}static AxEventPath constant(Value value){return make("constant",Value::array(),value);}
};
struct AxEventInputPlan {Value value=object({{"fields",Value::array()}});};
class AxEventInputBuilder {public:AxEventInputBuilder& project(AxEventPath path){if(has_project_)throw std::runtime_error("An event input plan may project only one path");Core::set(plan_,"project",path.descriptor);has_project_=true;return *this;}AxEventInputBuilder& field(std::string name,AxEventPath path){if(names_.count(name))throw std::runtime_error("Event input field "+name+" is mapped more than once");names_.insert(name);auto fields=Core::get(plan_,"fields",Value::array());Core::append(fields,object({{"field",name},{"path",path.descriptor}}));Core::set(plan_,"fields",fields);return *this;}AxEventInputPlan build()const{return {plan_};}private:Value plan_=object({{"fields",Value::array()}});std::set<std::string> names_;bool has_project_=false;};
struct AxEventRoute {
  std::string id;std::string action;Value match=Value::object();std::string targetId;bool requireAuthenticated=false;std::string ordering="strict";long debounceMs=0;Value instanceKey;
  Value value() const {Value out=Value::object();Core::set(out,"id",id);Core::set(out,"action",action);Core::set(out,"match",match);Core::set(out,"targetId",targetId);Core::set(out,"requireAuthenticated",requireAuthenticated);Core::set(out,"ordering",ordering);Core::set(out,"debounceMs",debounceMs);if(!instanceKey.is_null())Core::set(out,"instanceKey",instanceKey);return out;}
};
struct AxEventCommand {std::string routeId;std::string action;std::string targetId;std::string instanceKey;std::string idempotencyKey;};
struct AxEventPublishReceipt {std::string eventId;bool accepted=false;bool duplicate=false;std::string durability="volatile";std::vector<std::string> deliveryIds;};
struct AxEventRun {std::string id,deliveryId,routeId,targetId,instanceKey,status="queued",error;int attempt=0;Value output;std::vector<std::string> continuationIds;};
struct AxEventDeadLetter {std::string id,deliveryId,runId,sinkId,reason;};
struct AxEventContinuation {std::string id,targetId,instanceKey,identityScope;std::vector<std::pair<std::string,std::string>> correlation;Value metadata=Value::object();bool completed=false;long expiresAt=0;};
struct AxEventCancellationToken {bool cancelled=false;std::string reason;void cancel(std::string value="cancelled"){cancelled=true;reason=std::move(value);}};
struct AxEventInvocationContext {std::string runId,deliveryId,instanceKey,identityScope,idempotencyKey;AxEventCancellationToken* cancellation=nullptr;const AxEventContinuation* continuation=nullptr;};
class AxEventSource {public:virtual ~AxEventSource()=default;virtual void start(std::function<void(AxEventEnvelope)> publish)=0;virtual void close(){}};
class AxScopedEventSource {public:virtual ~AxScopedEventSource()=default;virtual void start_scoped(std::function<void(AxEventEnvelope,std::string,std::string)> publish)=0;};
class AxEventSink {public:virtual ~AxEventSink()=default;virtual void write(Value output,Value context)=0;};
class AxEventClock {public:virtual ~AxEventClock()=default;virtual long now() const=0;virtual bool sleep(long milliseconds,const AxEventCancellationToken* cancellation=nullptr)=0;};
class AxSystemEventClock final:public AxEventClock {public:long now()const override{return std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count();}bool sleep(long milliseconds,const AxEventCancellationToken* cancellation=nullptr)override{if(cancellation&&cancellation->cancelled)return false;std::this_thread::sleep_for(std::chrono::milliseconds(std::max(0L,milliseconds)));return !cancellation||!cancellation->cancelled;}};
class AxManualEventClock final:public AxEventClock {public:explicit AxManualEventClock(long value=0):current_(value){}long now()const override{std::lock_guard<std::mutex> lock(mutex_);return current_;}void advance(long milliseconds){{std::lock_guard<std::mutex> lock(mutex_);current_+=milliseconds;}condition_.notify_all();}bool sleep(long milliseconds,const AxEventCancellationToken* cancellation=nullptr)override{std::unique_lock<std::mutex> lock(mutex_);auto target=current_+std::max(0L,milliseconds);condition_.wait(lock,[&]{return current_>=target||(cancellation&&cancellation->cancelled);});return !cancellation||!cancellation->cancelled;}private:mutable std::mutex mutex_;std::condition_variable condition_;long current_;};
class AxEventStore {public:virtual ~AxEventStore()=default;virtual void enqueue(AxEventEnvelope event,Value commands)=0;};
struct AxEventTarget {std::string id;std::function<Value(Value,const AxEventInvocationContext&)> invoke;std::function<Value(const AxEventEnvelope&,const AxEventContinuation*)> mapInput;std::vector<std::pair<std::string,std::shared_ptr<AxEventSink>>> sinks;std::string retrySafety="unknown";Value waitFor=Value::array();std::function<Value()> captureState;std::function<void(Value)> restoreState;Value signature,input,wakeInput,resumeInput;};
class AxEventTargetBuilder {public:explicit AxEventTargetBuilder(std::string id){target_.id=std::move(id);}AxEventTargetBuilder& invoke(std::function<Value(Value,const AxEventInvocationContext&)> value){target_.invoke=std::move(value);return *this;}AxEventTargetBuilder& signature(Value value){target_.signature=std::move(value);return *this;}AxEventTargetBuilder& map_input(std::function<Value(const AxEventEnvelope&,const AxEventContinuation*)> value){target_.mapInput=std::move(value);return *this;}AxEventTargetBuilder& input(std::function<void(AxEventInputBuilder&)> mapping){AxEventInputBuilder value;mapping(value);target_.input=value.build().value;return *this;}AxEventTargetBuilder& wake_input(std::function<void(AxEventInputBuilder&)> mapping){AxEventInputBuilder value;mapping(value);target_.wakeInput=value.build().value;return *this;}AxEventTargetBuilder& resume_input(std::function<void(AxEventInputBuilder&)> mapping){AxEventInputBuilder value;mapping(value);target_.resumeInput=value.build().value;return *this;}AxEventTargetBuilder& sink(std::string id,std::shared_ptr<AxEventSink> value){target_.sinks.push_back({std::move(id),std::move(value)});return *this;}AxEventTargetBuilder& retry_safety(std::string value){target_.retrySafety=std::move(value);return *this;}AxEventTargetBuilder& wait_for(std::string kind,AxEventPath path,Value metadata=Value::object()){Core::append(target_.waitFor,object({{"kind",kind},{"value",path.descriptor},{"metadata",metadata}}));return *this;}AxEventTarget build(){if(!target_.invoke)throw std::runtime_error("Event target requires an invoker");if(target_.mapInput&&(!target_.input.is_null()||!target_.wakeInput.is_null()||!target_.resumeInput.is_null()))throw std::runtime_error("Declarative mappings and mapInput are mutually exclusive");if((!target_.input.is_null()||!target_.wakeInput.is_null()||!target_.resumeInput.is_null())&&target_.signature.is_null())throw std::runtime_error("Declarative event mappings require a signature");return std::move(target_);}private:AxEventTarget target_;};
inline AxEventTargetBuilder event_target(std::string id){return AxEventTargetBuilder(std::move(id));}
class AxEventRouteBuilder {public:explicit AxEventRouteBuilder(std::string id){route_.id=std::move(id);}AxEventRouteBuilder& types(Value values){Core::set(route_.match,"types",values);return *this;}AxEventRouteBuilder& sources(Value values){Core::set(route_.match,"sources",values);return *this;}AxEventRouteBuilder& authenticated(){route_.requireAuthenticated=true;return *this;}AxEventRouteBuilder& instance_key(AxEventPath path){route_.instanceKey=path.descriptor;return *this;}AxEventRouteBuilder& wake(const AxEventTarget& target){route_.action="wake";route_.targetId=target.id;return *this;}AxEventRouteBuilder& resume(){route_.action="resume";return *this;}AxEventRouteBuilder& observe(){route_.action="observe";return *this;}AxEventRouteBuilder& invalidate(){route_.action="invalidate";return *this;}AxEventRoute build(){if(route_.action.empty())throw std::runtime_error("Event route requires one action");return route_;}private:AxEventRoute route_;};
inline AxEventRouteBuilder event_route(std::string id){return AxEventRouteBuilder(std::move(id));}
struct AxEventDelivery {AxEventEnvelope event;AxEventCommand command;std::string identityScope="anonymous",trust="untrusted",status="queued",runId;long availableAt=0,sequence=0,size=0;int attempt=0;};
class AxInMemoryEventStore final:public AxEventStore {public:AxInMemoryEventStore():clock(std::make_shared<AxSystemEventClock>()){}void enqueue(AxEventEnvelope event,Value commands)override{enqueue_at(std::move(event),std::move(commands),clock->now());}void enqueue_at(AxEventEnvelope event,Value commands,long available_at){auto size=static_cast<long>(display(event.value()).size());if(size>maxEnvelopeBytes)throw std::runtime_error("event envelope exceeds maximum size");std::vector<Value> fresh;for(auto raw:Core::iter(commands)){auto id=display(Core::get(raw,"routeId"))+":"+event.id;if(deliveries.count(id)==0)fresh.push_back(raw);}auto deadline=clock->now()+publishTimeoutMs;while(!fresh.empty()&&(pending()+static_cast<int>(fresh.size())>maxPending||queuedBytes+size*static_cast<long>(fresh.size())>maxQueuedBytes)){auto remaining=deadline-clock->now();if(remaining<=0)throw std::runtime_error("AxEventBackpressureError: event inbox capacity timed out");clock->sleep(std::min(remaining,50L));}for(auto raw:fresh){auto route=display(Core::get(raw,"routeId"));auto id=route+":"+event.id;deliveries.emplace(id,AxEventDelivery{event,AxEventCommand{route,display(Core::get(raw,"action")),display(Core::get(raw,"targetId")),display(Core::get(raw,"instanceKey")),display(Core::get(raw,"idempotencyKey"))},"anonymous","untrusted","queued","",available_at,++sequence,size,0});queuedBytes+=size;}}void release(AxEventDelivery& value){queuedBytes=std::max(0L,queuedBytes-value.size);value.size=0;condition.notify_all();}void requeue(AxEventDelivery& value,long available_at){value.status="queued";value.availableAt=available_at;value.size=static_cast<long>(display(value.event.value()).size());queuedBytes+=value.size;condition.notify_all();}int pending()const{int out=0;for(const auto& item:deliveries)if(item.second.status=="queued")++out;return out;}std::shared_ptr<AxEventClock> clock;int maxPending=10000;long maxQueuedBytes=64L*1024*1024,maxEnvelopeBytes=1024L*1024,publishTimeoutMs=5000,queuedBytes=0,sequence=0;std::condition_variable condition;std::map<std::string,AxEventDelivery> deliveries;std::map<std::string,AxEventRun> runs;std::map<std::string,AxEventDeadLetter> deadLetters;std::map<std::string,AxEventContinuation> continuations;std::map<std::string,Value> programState;};
class AxPushEventSource final:public AxEventSource,public AxScopedEventSource {public:explicit AxPushEventSource(std::string id="push",std::string identity_scope="anonymous",std::string trust="untrusted"):id(std::move(id)),identityScope(std::move(identity_scope)),trust(std::move(trust)){}void start(std::function<void(AxEventEnvelope)> value)override{publish_=std::move(value);}void start_scoped(std::function<void(AxEventEnvelope,std::string,std::string)> value)override{publish_scoped_=std::move(value);}void publish(AxEventEnvelope event){if(publish_scoped_){publish_scoped_(std::move(event),identityScope,trust);return;}if(!publish_)throw std::runtime_error("AxPushEventSource is not started");publish_(std::move(event));}void close()override{publish_={};publish_scoped_={};}std::string id,identityScope,trust;private:std::function<void(AxEventEnvelope)> publish_;std::function<void(AxEventEnvelope,std::string,std::string)> publish_scoped_;};
struct AxMCPResourceSubscriptionPolicy {enum class Mode{none,all,explicit_uris,selector};Mode mode=Mode::none;std::vector<std::string> uris;std::function<bool(const Value&,const AxMCPCatalogSnapshot&)> select;static AxMCPResourceSubscriptionPolicy all(){AxMCPResourceSubscriptionPolicy value;value.mode=Mode::all;return value;}static AxMCPResourceSubscriptionPolicy explicit_values(std::vector<std::string> uris){AxMCPResourceSubscriptionPolicy value;value.mode=Mode::explicit_uris;value.uris=std::move(uris);return value;}static AxMCPResourceSubscriptionPolicy selecting(std::function<bool(const Value&,const AxMCPCatalogSnapshot&)> select){AxMCPResourceSubscriptionPolicy value;value.mode=Mode::selector;value.select=std::move(select);return value;}};
class AxMCPEventSource final:public AxEventSource,public AxScopedEventSource {
 public:
  AxMCPEventSource(std::shared_ptr<AxMCPClient> client,std::string namespace_name="",std::string identity_scope="anonymous",std::string trust="untrusted",std::vector<std::string> subscriptions={}):AxMCPEventSource(std::move(client),std::move(namespace_name),std::move(identity_scope),std::move(trust),subscriptions.empty()?AxMCPResourceSubscriptionPolicy{}:AxMCPResourceSubscriptionPolicy::explicit_values(std::move(subscriptions))){}
  AxMCPEventSource(std::shared_ptr<AxMCPClient> client,std::string namespace_name,std::string identity_scope,std::string trust,AxMCPResourceSubscriptionPolicy policy):client_(std::move(client)),namespace_(namespace_name.empty()?client_->namespace_name():std::move(namespace_name)),identity_scope_(std::move(identity_scope)),trust_(std::move(trust)),policy_(std::move(policy)),owner_("event-source:"+std::to_string(reinterpret_cast<std::uintptr_t>(this))){}
  void start(std::function<void(AxEventEnvelope)> publish)override{start_scoped([publish=std::move(publish)](AxEventEnvelope event,std::string,std::string){publish(std::move(event));});}
  void start_scoped(std::function<void(AxEventEnvelope,std::string,std::string)> publish)override{client_->init();publish_=std::move(publish);listener_id_=client_->add_notification_listener([this](Value message){on_notification(std::move(message));});lifecycle_listener_id_=client_->add_lifecycle_listener([this](const std::string& state){if(state=="reconnected")reconcile();});reconcile();}
  void reconnect(){client_->restore_resource_subscriptions();reconcile();}
  void close()override{for(const auto& uri:subscriptions_){try{client_->release_resource_subscription(uri,owner_);}catch(...){}}subscriptions_.clear();if(listener_id_>0)client_->remove_notification_listener(listener_id_);if(lifecycle_listener_id_>0)client_->remove_lifecycle_listener(lifecycle_listener_id_);listener_id_=0;lifecycle_listener_id_=0;publish_={};}
 private:
  std::vector<std::string> selected(const AxMCPCatalogSnapshot& catalog){Value resources=Value::array(),explicit_uris=Value::array();std::string mode="none";if(policy_.mode==AxMCPResourceSubscriptionPolicy::Mode::all){mode="all";resources=catalog.resources;}else if(policy_.mode==AxMCPResourceSubscriptionPolicy::Mode::explicit_uris){mode="explicit";for(const auto& uri:policy_.uris)Core::append(explicit_uris,uri);}else if(policy_.mode==AxMCPResourceSubscriptionPolicy::Mode::selector){if(!policy_.select)throw std::runtime_error("MCP selector policy requires a callback");mode="selector";for(const auto& resource:Core::iter(catalog.resources))if(policy_.select(resource,catalog))Core::append(resources,resource);}auto normalized=Core::mcp_resource_subscription_selection(resources,mode,explicit_uris);std::vector<std::string> out;for(const auto& value:Core::iter(normalized))out.push_back(display(value));std::sort(out.begin(),out.end());return out;}
  void reconcile(){auto catalog=client_->inspect_catalog();if(policy_.mode!=AxMCPResourceSubscriptionPolicy::Mode::none&&!Core::truthy(Core::get(Core::get(catalog.server_capabilities,"resources",Value::object()),"subscribe",false)))throw std::runtime_error("MCP server "+catalog.namespace_name+" does not advertise resource subscriptions");std::vector<std::string> desired;try{desired=selected(catalog);}catch(const std::exception& error){errors_.push_back(error.what());return;}Value desired_value=Value::array();for(const auto& uri:desired)Core::append(desired_value,uri);Value current_value=Value::array();for(const auto& uri:subscriptions_)Core::append(current_value,uri);auto plan=Core::mcp_resource_subscription_plan(desired_value,current_value);for(const auto& value:Core::iter(Core::get(plan,"removals",Value::array()))){auto uri=display(value);try{client_->release_resource_subscription(uri,owner_);subscriptions_.erase(std::remove(subscriptions_.begin(),subscriptions_.end(),uri),subscriptions_.end());}catch(const std::exception& error){errors_.push_back(error.what());}}for(const auto& value:Core::iter(Core::get(plan,"additions",Value::array()))){auto uri=display(value);try{client_->acquire_resource_subscription(uri,owner_);subscriptions_.push_back(uri);std::sort(subscriptions_.begin(),subscriptions_.end());}catch(const std::exception& error){errors_.push_back(error.what());}}}
  void on_notification(Value message){if(!publish_)return;auto method=display(Core::get(message,"method",""));if(method.empty())return;if(method=="notifications/resources/list_changed")reconcile();auto normalized=Core::event_normalize_mcp(namespace_,method,Core::get(message,"params",Value::object()));AxEventEnvelope event;event.id="mcp:"+namespace_+":"+std::to_string(next_id_++);event.source=display(Core::get(normalized,"source"));event.type=display(Core::get(normalized,"type"));event.data=Core::get(normalized,"data",Value::object());event.subject=display(Core::get(event.data,"uri",Core::get(Core::get(event.data,"task",Value::object()),"taskId","")));auto key=Core::get(normalized,"correlation",Value());if(!key.is_null())event.correlation.push_back({display(Core::get(key,"kind")),display(Core::get(key,"value"))});publish_(std::move(event),identity_scope_,trust_);}
  std::shared_ptr<AxMCPClient> client_;std::string namespace_,identity_scope_,trust_;AxMCPResourceSubscriptionPolicy policy_;std::string owner_;std::vector<std::string> subscriptions_,errors_;std::function<void(AxEventEnvelope,std::string,std::string)> publish_;int listener_id_=0,lifecycle_listener_id_=0,next_id_=1;
};
class AxEventRuntime {
 public:
  explicit AxEventRuntime(std::vector<AxEventRoute> routes,Value options=Value::object()):routes_(std::move(routes)),options_(std::move(options)){
    Value values=Value::array();for(const auto& route:routes_)Core::append(values,route.value());descriptor_=Core::event_runtime_descriptor(values,options_);
    clock_=std::make_shared<AxSystemEventClock>();store_.clock=clock_;
  }
  AxEventRuntime& clock(std::shared_ptr<AxEventClock> value){clock_=std::move(value);store_.clock=clock_;return *this;}
  AxEventRuntime& limits(int max_pending,long max_queued_bytes,long max_envelope_bytes,long publish_timeout_ms=5000){store_.maxPending=max_pending;store_.maxQueuedBytes=max_queued_bytes;store_.maxEnvelopeBytes=max_envelope_bytes;store_.publishTimeoutMs=publish_timeout_ms;return *this;}
  AxEventRuntime& register_target(AxEventTarget target){targets_[target.id]=std::move(target);return *this;}
  AxEventRuntime& add_source(std::shared_ptr<AxEventSource> source){sources_.push_back(std::move(source));return *this;}
  AxEventRuntime& start(){if(started_)return *this;started_=true;for(auto& source:sources_){if(auto scoped=std::dynamic_pointer_cast<AxScopedEventSource>(source))scoped->start_scoped([this](AxEventEnvelope event,std::string scope,std::string trust){publish(event,scope,trust);});else source->start([this](AxEventEnvelope event){publish(event);});}return *this;}
  Value plan(const AxEventEnvelope& event,const std::string& identity_scope="anonymous",const std::string& trust="untrusted") const {Value values=Value::array();for(const auto& route:routes_)Core::append(values,route.value());auto raw=Core::event_route_commands(event.value(),values,identity_scope,trust);Value out=Value::array();for(auto command:Core::iter(raw)){auto route_id=display(Core::get(command,"routeId"));for(const auto& route:routes_)if(route.id==route_id&&!route.instanceKey.is_null()){auto ingress=object({{"event",event.value()},{"identity",object({{"scope",identity_scope}})},{"trust",trust}});auto resolved=Core::event_resolve_path(ingress,route.instanceKey,Value());if(resolved.is_null())throw std::runtime_error("Route "+route_id+" instance key was not present");Core::set(command,"instanceKey",display(resolved));}Core::append(out,command);}return out;}
  AxEventPublishReceipt publish(const AxEventEnvelope& event,const std::string& identity_scope="anonymous",const std::string& trust="untrusted") {if(!started_)throw std::runtime_error("AxEventRuntime must be started first");Value raw=plan(event,identity_scope,trust);std::vector<std::string> ids;bool duplicate=!Core::iter(raw).empty();for(auto value:Core::iter(raw)){auto route_id=display(Core::get(value,"routeId"));auto id=route_id+":"+event.id;ids.push_back(id);if(store_.deliveries.count(id)==0)duplicate=false;long debounce=0;for(const auto& route:routes_)if(route.id==route_id)debounce=route.debounceMs;if(debounce>0)for(auto& item:store_.deliveries){auto& old=item.second;if(old.status=="queued"&&old.command.routeId==route_id&&old.command.targetId==display(Core::get(value,"targetId"))&&old.command.instanceKey==display(Core::get(value,"instanceKey"))){old.status="coalesced";store_.release(old);}}Value one=Value::array();Core::append(one,value);store_.enqueue_at(event,one,clock_->now()+debounce);}for(const auto& id:ids){store_.deliveries.at(id).identityScope=identity_scope;store_.deliveries.at(id).trust=trust;}if(!duplicate)run_due();return AxEventPublishReceipt{event.id,true,duplicate,"volatile",ids};}
  long next_due_at()const{long out=-1;for(const auto& item:store_.deliveries)if(item.second.status=="queued"&&(out<0||item.second.availableAt<out))out=item.second.availableAt;return out;}
  int run_due(){int processed=0;while(true){AxEventDelivery* due=nullptr;for(auto& item:store_.deliveries){auto& value=item.second;if(value.status=="queued"&&value.availableAt<=clock_->now()&&strict_delivery_eligible(value)&&(!due||value.availableAt<due->availableAt||(value.availableAt==due->availableAt&&value.sequence<due->sequence)))due=&value;}if(!due)return processed;due->status="running";store_.release(*due);dispatch(due->event,due->command,due->identityScope,due->trust);++processed;}}
  bool cancel_run(const std::string& run_id,const std::string& reason="cancelled"){auto found=active_.find(run_id);if(found==active_.end())return false;found->second->cancel(reason);return true;}
  const AxEventRun* get_run(const std::string& run_id)const{auto found=store_.runs.find(run_id);return found==store_.runs.end()?nullptr:&found->second;}
  std::vector<AxEventDeadLetter> list_dead_letters()const{std::vector<AxEventDeadLetter> out;for(const auto& item:store_.deadLetters)out.push_back(item.second);return out;}
  void redrive(const std::string& dead_id){auto found=store_.deadLetters.find(dead_id);if(found==store_.deadLetters.end())throw std::runtime_error("unknown event dead letter");auto dead=found->second;store_.deadLetters.erase(found);if(!dead.sinkId.empty()){auto run_found=store_.runs.find(dead.runId);if(run_found==store_.runs.end())throw std::runtime_error("sink redrive run is unavailable");auto target_found=targets_.find(run_found->second.targetId);if(target_found==targets_.end())throw std::runtime_error("sink redrive target is unavailable");for(auto& sink:target_found->second.sinks)if(sink.first==dead.sinkId){try{sink.second->write(run_found->second.output,object({{"runId",run_found->second.id},{"idempotencyKey",run_found->second.id+":"+dead.sinkId}}));return;}catch(...){store_.deadLetters[dead.id]=dead;throw;}}throw std::runtime_error("sink redrive sink is unavailable");}auto& delivery=store_.deliveries.at(dead.deliveryId);delivery.attempt=0;store_.requeue(delivery,clock_->now());run_due();}
  void close(){for(auto& source:sources_)source->close();started_=false;}
  static Value normalize_mcp(const std::string& namespace_name,const std::string& method,Value params){return Core::event_normalize_mcp(namespace_name,method,std::move(params));}
  Value descriptor()const{return descriptor_;}
 private:
  const AxEventContinuation* find_continuation(const AxEventEnvelope& event,const std::string& scope)const{for(const auto& item:store_.continuations){const auto& value=item.second;if(value.completed||value.identityScope!=scope||(value.expiresAt>0&&value.expiresAt<=clock_->now()))continue;for(const auto& left:value.correlation)for(const auto& right:event.correlation)if(left==right)return &value;}return nullptr;}
  void dead_letter(const std::string& delivery_id,const std::string& run_id,const std::string& reason,const std::string& sink_id=""){auto id="dead:"+std::to_string(store_.deadLetters.size()+1);store_.deadLetters[id]=AxEventDeadLetter{id,delivery_id,run_id,sink_id,reason};if(sink_id.empty())store_.deliveries[delivery_id].status="dead_lettered";}
  bool strict_delivery_eligible(const AxEventDelivery& candidate)const{auto descriptor=[this](const AxEventDelivery& value){std::string ordering="strict";for(const auto& route:routes_)if(route.id==value.command.routeId){ordering=route.ordering;break;}return object({{"sequence",value.sequence},{"targetId",value.command.targetId},{"instanceKey",value.command.instanceKey},{"status",value.status},{"ordering",ordering}});};Value deliveries=Value::array();for(const auto& item:store_.deliveries)Core::append(deliveries,descriptor(item.second));return Core::truthy(Core::event_strict_delivery_eligible(descriptor(candidate),deliveries));}
  Value map_target_input(const AxEventTarget& target,const AxEventEnvelope& event,const AxEventContinuation* continuation,const std::string& action,const std::string& scope,const std::string& trust){auto plan=action=="resume"?target.resumeInput:target.wakeInput;if(plan.is_null())plan=target.input;Value input;if(!plan.is_null()){if(target.signature.is_null())throw std::runtime_error("Target "+target.id+" requires a signature for declarative input mapping");auto fields=Core::get(target.signature,"input_fields",Core::get(target.signature,"inputs",Value::array()));Value descriptors=Value::array();for(auto field:Core::iter(fields))Core::append(descriptors,object({{"name",Core::get(field,"name","")},{"optional",Core::get(field,"is_optional",Core::get(field,"isOptional",false))}}));Value continuation_value;if(continuation)continuation_value=object({{"metadata",continuation->metadata}});auto result=Core::event_map_input(object({{"event",event.value()},{"identity",object({{"scope",scope}})},{"trust",trust}}),plan,descriptors,continuation_value);if(!Core::truthy(Core::get(result,"ok",false)))throw std::runtime_error(display(Core::get(result,"error","Event input mapping failed")));input=Core::get(result,"value");}else input=target.mapInput?target.mapInput(event,continuation):event.data;if(!target.signature.is_null()){auto fields=Core::get(target.signature,"input_fields",Core::get(target.signature,"inputs",Value::array()));Value descriptors=Value::array();for(auto field:Core::iter(fields))Core::append(descriptors,object({{"name",Core::get(field,"name","")},{"optional",Core::get(field,"is_optional",Core::get(field,"isOptional",false))}}));auto normalized=Core::event_normalize_input(input,descriptors);if(!Core::truthy(Core::get(normalized,"ok",false)))throw std::runtime_error(display(Core::get(normalized,"error","Event input normalization failed")));input=Core::get(normalized,"value");Core::validate_fields(fields,input,"input");}return input;}
  void dispatch(const AxEventEnvelope& event,const AxEventCommand& command,const std::string& scope,const std::string& trust){auto delivery_id=command.routeId+":"+event.id;auto& delivery=store_.deliveries.at(delivery_id);auto target_id=command.targetId;const AxEventContinuation* continuation=nullptr;if(command.action=="resume"){continuation=find_continuation(event,scope);if(!continuation){dead_letter(delivery_id,"","continuation_not_found");return;}target_id=continuation->targetId;}if(command.action=="observe"||command.action=="invalidate"){delivery.status="succeeded";return;}auto target_found=targets_.find(target_id);if(target_found==targets_.end()){dead_letter(delivery_id,"","unknown_target:"+target_id);return;}auto& target=target_found->second;auto run_id=delivery.runId.empty()?"run:"+delivery_id+":"+std::to_string(store_.runs.size()+1):delivery.runId;auto& run=store_.runs[run_id];if(delivery.runId.empty()){run=AxEventRun{run_id,delivery_id,command.routeId,target_id,command.instanceKey};delivery.runId=run_id;}auto token=std::make_shared<AxEventCancellationToken>();active_[run_id]=token;auto state_key=target_id+"\n"+scope+"\n"+command.instanceKey;if(target.restoreState&&store_.programState.count(state_key))target.restoreState(store_.programState.at(state_key));Value input;try{input=map_target_input(target,event,continuation,command.action,scope,trust);}catch(const std::exception& error){run.status="failed";run.error="event_input_invalid:"+std::string(error.what());dead_letter(delivery_id,run_id,run.error);active_.erase(run_id);return;}auto attempt=++delivery.attempt;run.attempt=attempt;run.status="running";try{AxEventInvocationContext context{run_id,delivery_id,command.instanceKey,scope,command.idempotencyKey,token.get(),continuation};auto output=target.invoke(input,context);if(token->cancelled){run.status="cancelled";delivery.status="cancelled";active_.erase(run_id);return;}if(target.captureState)store_.programState[state_key]=target.captureState();run.output=output;for(auto declaration:Core::iter(target.waitFor)){auto raw=Core::get(declaration,"value");auto value=raw.is_object()&&Core::truthy(Core::get(raw,"root",false))?Core::event_resolve_path(object({{"event",event.value()},{"identity",object({{"scope",scope}})}}),raw,Value()):Core::get(event.data,display(raw));if(value.is_null())throw std::runtime_error("continuation value is missing");auto id="continuation:"+target.id+":"+std::to_string(store_.continuations.size()+1);auto expires=static_cast<long>(Core::number(Core::get(declaration,"expiresInMs",0)));store_.continuations[id]=AxEventContinuation{id,target.id,command.instanceKey,scope,{{display(Core::get(declaration,"kind")),display(value)}},Core::get(declaration,"metadata",Value::object()),false,expires>0?clock_->now()+expires:0};run.continuationIds.push_back(id);}if(run.continuationIds.empty()){run.status="succeeded";delivery.status="succeeded";for(auto& sink:target.sinks){try{sink.second->write(output,object({{"runId",run_id},{"idempotencyKey",run_id+":"+sink.first}}));}catch(const std::exception& error){dead_letter(delivery_id,run_id,error.what(),sink.first);}}}else{run.status="waiting_event";delivery.status="waiting_event";}if(continuation)store_.continuations[continuation->id].completed=true;}catch(const std::exception& error){if(attempt<maxAttempts_&&target.retrySafety=="idempotent"){run.status="queued";store_.requeue(delivery,clock_->now()+retryBackoffMs_*(1L<<(attempt-1)));}else{run.status=target.retrySafety=="idempotent"?"failed":"outcome_unknown";run.error=error.what();delivery.status=run.status;dead_letter(delivery_id,run_id,run.error);}}active_.erase(run_id);}
  std::vector<AxEventRoute> routes_;Value options_;Value descriptor_;AxInMemoryEventStore store_;std::shared_ptr<AxEventClock> clock_;std::map<std::string,AxEventTarget> targets_;std::vector<std::shared_ptr<AxEventSource>> sources_;std::map<std::string,std::shared_ptr<AxEventCancellationToken>> active_;bool started_=false;int maxAttempts_=3;long retryBackoffMs_=1000;
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
  void set_message_handler(std::function<void(Value)> handler) override {message_handler_=std::move(handler);}
  void set_lifecycle_handler(std::function<void(std::string)> handler) override {lifecycle_handler_=std::move(handler);}
  void set_protocol_version(const std::string& protocol_version) override;
  void start_listening() override;
  void close() override;
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
  std::function<void(Value)> message_handler_;
  std::function<void(std::string)> lifecycle_handler_;
  std::atomic<bool> listen_stop_{true};
  std::thread listen_thread_;
  std::mutex listen_mutex_;
  std::string last_event_id_;
  std::string sse_buffer_;
  void listen_loop();
  void consume_sse_chunk(const char* data,std::size_t size);
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
  void set_message_handler(std::function<void(Value)> handler) override {handler_=std::move(handler);}
  void emit(Value message){if(handler_)handler_(std::move(message));}
  void set_protocol_version(const std::string& protocol_version) override;
  std::vector<Value> requests;
  std::vector<Value> notifications;
  std::vector<Value> sent_responses;

 private:
  std::vector<Value> responses_;
  std::string protocol_version_;
  std::function<void(Value)> handler_;
};

std::string ax_mcp_stdio_encode(Value message);
Value ax_mcp_stdio_decode(const std::string& line);
std::string ax_mcp_pkce_verifier();
std::string ax_mcp_pkce_challenge(const std::string& verifier);
std::string ax_mcp_validate_endpoint(const std::string& endpoint, Value options = Value::object());
void run_mcp_conformance_fixture(Value fixture);

}  // namespace axllm
