#include "axllm/axllm.hpp"
#include "axllm/mcp.hpp"
#include <iostream>
#include <future>
using namespace axllm;
struct Gate {
  std::mutex mutex;std::condition_variable ready;bool started=false,released=false;std::atomic<int> calls{0};
};
static Value completed(const std::string& id,const std::string& answer){return object({{"type","response.completed"},{"response",object({{"id",id},{"model","gpt-6-astra"},{"output",Value(Array{object({{"type","message"},{"id","msg-"+id},{"content",Value(Array{object({{"type","output_text"},{"text",answer}})})}})})}})}});}
class GatedTransport final:public Transport {
 public:
  std::shared_ptr<Gate> gate;std::atomic<int> requests{0};
  explicit GatedTransport(std::shared_ptr<Gate> gate):gate(std::move(gate)){}
  Value call(Value) override{throw std::runtime_error("Expected incremental streaming");}
  void stream(Value request,AxTransportStreamHandler handler) override{
    Value payload=Core::get(request,"json");int number=++requests;
    if(number==1){
      Value tools=Core::get(payload,"tools");if(!Core::truthy(Core::get(Core::get(tools,0),"async")))throw std::runtime_error("Background tool was not declared async");
      handler(object({{"type","response.created"},{"response",object({{"id","r1"}})}}));
      handler(object({{"type","response.function_call_arguments.delta"},{"item_id","i1"},{"delta","{"}}));
      if(gate->calls.load()!=0)throw std::runtime_error("Partial arguments executed a tool");
      Value event=object({{"type","response.output_item.done"},{"item",object({{"type","function_call"},{"id","i1"},{"call_id","c1"},{"name","lookup"},{"arguments","{}"}})}});
      handler(event);handler(event);
      {std::unique_lock<std::mutex> lock(gate->mutex);if(!gate->ready.wait_for(lock,std::chrono::seconds(5),[&]{return gate->started;}))throw std::runtime_error("Tool did not start while model stream was open");gate->released=true;gate->ready.notify_all();}
      handler(completed("r1","{\"answer\":\"provisional\"}"));return;
    }
    if(number!=2)throw std::runtime_error("Work was replayed");
    if(stringify(Core::get(payload,"previous_response_id"))!="\"r1\"")throw std::runtime_error("Lost response ID");
    Value expected=Value(Array{object({{"type","function_call_output"},{"call_id","c1"},{"output","REF-42"}})});
    if(stringify(Core::get(payload,"input"))!=stringify(expected))throw std::runtime_error("Result not incorporated exactly once");
    handler(completed("r2","{\"answer\":\"REF-42\"}"));
  }
};

class FlowTransport final:public Transport {
 public:
  std::atomic<int> requests{0};
  Value call(Value) override{throw std::runtime_error("Expected streaming");}
  void stream(Value request,AxTransportStreamHandler handler) override{
    Value body=Core::get(request,"json");
    if(stringify(Core::get(body,"model"))!="\"gpt-6-astra\"")throw std::runtime_error("Alias was not resolved");
    if(++requests%2==1){
      if(Core::truthy(Core::get(body,"previous_response_id")))throw std::runtime_error("Node inherited another conversation");
      handler(object({{"type","response.completed"},{"response",object({{"id","node-start"},{"model","gpt-6-astra"},{"output",Value(Array{object({{"type","function_call"},{"id","item"},{"call_id","same-call"},{"name","lookup"},{"arguments","{\"query\":\"REF-42\"}"}})})}})}}));
    }else{
      if(stringify(Core::get(body,"previous_response_id"))!="\"node-start\"")throw std::runtime_error("Lost node response ID");
      Value input=Core::get(body,"input");
      if(stringify(Core::get(Core::get(input,0),"role"))!="\"user\"" || stringify(Core::get(input,1))!=stringify(object({{"type","function_call_output"},{"call_id","same-call"},{"output","REF-42"}})))throw std::runtime_error("Lost scoped update or result");
      handler(completed("node-final","{\"answer\":\"REF-42\"}"));
    }
  }
};
class SteeringSocket final:public RealtimeTransport {
 public:
  std::mutex mutex;std::condition_variable ready;std::deque<Value> incoming;std::vector<Value> sent;bool closed=false,pending=false;
  void send(const Value& event)override{
    std::lock_guard<std::mutex> lock(mutex);sent.push_back(event);
    if(pending){incoming.push_back(object({{"type","response.created"},{"response",object({{"id","pending"}})}}));incoming.push_back(object({{"type","response.output_item.done"},{"item",object({{"type","function_call"},{"id","item"},{"call_id","pending-call"},{"name","lookup"},{"arguments","{}"}})}}));ready.notify_all();return;}
    if(stringify(Core::get(event,"type"))=="\"response.create\"") {
      if(!Core::get(event,"stream").is_null())throw std::runtime_error("WebSocket create retained stream");
      incoming.push_back(object({{"type","response.created"},{"response",object({{"id","parent"}})}}));
      incoming.push_back(object({{"type","response.output_text.delta"},{"delta","provisional"}}));
    }else{
      if(stringify(Core::get(event,"type"))!="\"response.steer\"" || stringify(Core::get(event,"previous_response_id"))!="\"parent\"")throw std::runtime_error("Invalid steering");
      Value ack=object({{"type","response.steer.accepted"},{"steer",object({{"id","s1"},{"previous_response_id","parent"}})}});incoming.push_back(ack);incoming.push_back(ack);
      incoming.push_back(object({{"type","response.incomplete"},{"response",object({{"id","parent"},{"model","gpt-6-astra"},{"output",Value::array()},{"incomplete_details",object({{"reason","steered"}})},{"usage",object({{"input_tokens",3},{"output_tokens",2}})}})}}));
      incoming.push_back(object({{"type","response.created"},{"response",object({{"id","successor"}})}}));
      incoming.push_back(completed("successor","{\"answer\":\"CORRECTED\"}"));
    }
    ready.notify_all();
  }
  bool recv(Value& out)override{std::unique_lock<std::mutex> lock(mutex);if(!ready.wait_for(lock,std::chrono::seconds(5),[&]{return closed||!incoming.empty();})||closed)return false;out=incoming.front();incoming.pop_front();return true;}
  void close()override{std::lock_guard<std::mutex> lock(mutex);closed=true;ready.notify_all();}
};
class AgentSessionTransport final:public Transport {
 public:
  std::shared_ptr<Gate> gate;std::atomic<int> requests{0};explicit AgentSessionTransport(std::shared_ptr<Gate> value):gate(value){}
  Value call(Value request)override{
    int number=++requests;Value body=Core::get(request,"json");for(const auto& tool:Core::iter(Core::get(body,"tools",Value::array())))if(Core::truthy(Core::get(tool,"async")))throw std::runtime_error("Actor authority leaked to another stage");
    if(number==1)return Core::get(completed("distiller","{\"completion\":{\"type\":\"final\",\"args\":[\"Find reference\",{}]}}"),"response");
    if(number!=4||stringify(body).find("REF-42")==std::string::npos)throw std::runtime_error("Responder ran before final incorporation");return Core::get(completed("responder","{\"answer\":\"REF-42\"}"),"response");
  }
  void stream(Value request,AxTransportStreamHandler handler)override{
    int number=++requests;Value body=Core::get(request,"json");if(number==1||number==2||number==5||number==6){
      for(const auto& t:Core::iter(Core::get(body,"tools",Value::array())))if(Core::truthy(Core::get(t,"async")))throw std::runtime_error("Actor authority leaked");
      std::string stage=number<3?"distiller":"responder",suffix=(number==1||number==5)?"-start":"-final";
      if(number==2||number==6){std::string input=stringify(Core::get(body,"input"));if(display(Core::get(body,"previous_response_id"))!=stage+"-start"||input.find("ROOT-GUIDANCE")==std::string::npos||(input.find("RESPONDER-ONLY")!=std::string::npos)!=(number==6))throw std::runtime_error("Scoped stage update mismatch");}
      if(number==5&&stringify(body).find("REF-42")==std::string::npos)throw std::runtime_error("Responder started before incorporation");
      handler(completed(stage+suffix,number<3?"{\"completion\":{\"type\":\"final\",\"args\":[\"Find reference\",{}]}}":"{\"answer\":\"REF-42\"}"));return;
    }
    if(number==3){Value tool=Core::get(Core::get(body,"tools"),0);if(stringify(Core::get(tool,"name"))!="\"tools_lookup\""||!Core::truthy(Core::get(tool,"async")))throw std::runtime_error("Missing native actor tool");
      handler(object({{"type","response.output_item.done"},{"item",object({{"type","function_call"},{"id","item"},{"call_id","agent-call"},{"name","tools_lookup"},{"arguments","{\"query\":\"REF-42\"}"}})}}));
      {std::unique_lock<std::mutex> lock(gate->mutex);if(!gate->ready.wait_for(lock,std::chrono::seconds(2),[&]{return gate->started;}))throw std::runtime_error("Agent handler did not overlap model work");gate->released=true;gate->ready.notify_all();}
      handler(completed("executor1","{\"completion\":{\"type\":\"final\",\"args\":[\"Report reference\",{\"answer\":\"provisional\"}]}}"));return;
    }
    if(number!=4||stringify(Core::get(body,"previous_response_id"))!="\"executor1\""||stringify(Core::get(body,"input")).find("REF-42")==std::string::npos)throw std::runtime_error("Lost native tool result");
    std::string updates=stringify(Core::get(body,"input"));if(updates.find("ROOT-GUIDANCE")==std::string::npos||updates.find("RESPONDER-ONLY")!=std::string::npos||updates.find("configuration_update")==std::string::npos||updates.find("medium")==std::string::npos)throw std::runtime_error("Missing executor update");
    handler(completed("executor2","{\"completion\":{\"type\":\"final\",\"args\":[\"Report reference\",{\"answer\":\"REF-42\"}]}}"));
  }
};
void native_agent(){
  auto control=run_control();control.steer("ROOT-GUIDANCE");control.steer("RESPONDER-ONLY","root/responder");control.set_thinking_token_budget("medium","root/executor");
  auto gate=std::make_shared<Gate>();auto transport=std::make_shared<AgentSessionTransport>(gate);auto client=ai("openai",object({{"api_key","test"},{"model","gpt-6-astra"}}));dynamic_cast<OpenAICompatibleClient&>(*client).shared_transport(transport);
  Tool lookup("lookup","Lookup",object({{"type","object"},{"properties",object({{"query",object({{"type","string"}})}})},{"required",Value(Array{"query"})}}),[gate](Value args){++gate->calls;std::unique_lock<std::mutex> lock(gate->mutex);gate->started=true;gate->ready.notify_all();if(!gate->ready.wait_for(lock,std::chrono::seconds(2),[&]{return gate->released;}))throw std::runtime_error("Agent model did not overlap tool");return Core::get(args,"query");});lookup.execution("background");
  auto program=agent("question -> answer",object({{"directResponse","off"}}));program.add_tool_module("tools",std::vector<Tool>{lookup});Value result=program.forward(*client,object({{"question","Find reference"}}),object({{"control",control.value()}}));
  if(stringify(Core::get(result,"answer"))!="\"REF-42\""||gate->calls.load()!=1||transport->requests.load()!=6)throw std::runtime_error("Invalid native agent result");
  Value activity=Value::array();for(const auto& entry:Core::iter(program.get_action_log()))if(stringify(Core::get(entry,"type"))=="\"function_call\"")Core::append(activity,entry);
  if(Core::iter(activity).size()!=1||stringify(Core::get(Core::get(activity,0),"qualified_name"))!="\"tools.lookup\""||stringify(Core::get(Core::get(activity,0),"call_id"))!="\"agent-call\"")throw std::runtime_error("Lost native activity: "+stringify(activity));
  Value duplicate=program.invoke_callable("tools.lookup",object({{"query","REF-42"}}));if(stringify(Core::get(duplicate,"status"))!="\"error\""||gate->calls.load()!=1)throw std::runtime_error("Native call replayed through actor machinery");
  std::cout<<"cpp native agent tools, authority boundaries, action logs, and duplicate prevention passed\n";
}
void cancellation(){
  auto socket=std::make_shared<SteeringSocket>();socket->pending=true;auto control=run_control();auto settled=std::make_shared<std::atomic<bool>>(false);
  auto client=ai("openai",object({{"api_key","test"},{"model","gpt-6-astra"}}));dynamic_cast<OpenAICompatibleClient&>(*client).session_web_socket_factory([socket](const std::string&,Value){return socket;});
  Tool lookup("lookup","Lookup");lookup.execution("background").context_handler([control,settled](Value,const AxToolContext& context){if(context.call_id!="pending-call")throw std::runtime_error("Lost context call ID");control.abort();auto deadline=std::chrono::steady_clock::now()+std::chrono::seconds(2);while(!context.is_cancelled()&&std::chrono::steady_clock::now()<deadline)std::this_thread::sleep_for(std::chrono::milliseconds(1));if(!context.is_cancelled())throw std::runtime_error("Tool missed cancellation");settled->store(true);return Value("LATE");});
  auto program=ax("question -> answer");program.add_tool(lookup);auto start=std::chrono::steady_clock::now();
  try{program.forward(*client,object({{"question","Find answer"}}),object({{"control",control.value()}}));throw std::runtime_error("Cancelled run returned success");}catch(const std::exception& error){if(std::string(error.what()).find("pending-call")==std::string::npos)throw;}
  if(std::chrono::steady_clock::now()-start>std::chrono::seconds(2))throw std::runtime_error("Cancellation blocked the caller");
  auto deadline=std::chrono::steady_clock::now()+std::chrono::seconds(2);while(!settled->load()&&std::chrono::steady_clock::now()<deadline)std::this_thread::sleep_for(std::chrono::milliseconds(1));
  {std::lock_guard<std::mutex> lock(socket->mutex);if(!socket->closed||socket->sent.size()!=1||!settled->load())throw std::runtime_error("Cancellation leaked or replayed work");}
  std::cout<<"cpp cancellation context, pending IDs, and late-result isolation passed\n";
}
void disconnect_pending(){
  auto socket=std::make_shared<SteeringSocket>();socket->pending=true;auto control=run_control();auto settled=std::make_shared<std::atomic<bool>>(false);
  auto client=ai("openai",object({{"api_key","test"},{"model","gpt-6-astra"}}));dynamic_cast<OpenAICompatibleClient&>(*client).session_web_socket_factory([socket](const std::string&,Value){return socket;});
  Tool lookup("lookup","Lookup");lookup.execution("background").context_handler([socket,settled](Value,const AxToolContext& context){if(context.call_id!="pending-call")throw std::runtime_error("Lost context call ID");socket->close();auto deadline=std::chrono::steady_clock::now()+std::chrono::seconds(2);while(!context.is_cancelled()&&std::chrono::steady_clock::now()<deadline)std::this_thread::sleep_for(std::chrono::milliseconds(1));if(!context.is_cancelled())throw std::runtime_error("Tool missed cancellation");settled->store(true);return Value("LATE");});
  auto program=ax("question -> answer");program.add_tool(lookup);auto start=std::chrono::steady_clock::now();
  try{program.forward(*client,object({{"question","Find answer"}}),object({{"control",control.value()}}));throw std::runtime_error("Cancelled run returned success");}catch(const std::exception& error){if(std::string(error.what()).find("pending-call")==std::string::npos)throw;}
  if(std::chrono::steady_clock::now()-start>std::chrono::seconds(2))throw std::runtime_error("Cancellation blocked the caller");
  auto deadline=std::chrono::steady_clock::now()+std::chrono::seconds(2);while(!settled->load()&&std::chrono::steady_clock::now()<deadline)std::this_thread::sleep_for(std::chrono::milliseconds(1));
  {std::lock_guard<std::mutex> lock(socket->mutex);if(!socket->closed||socket->sent.size()!=1||!settled->load())throw std::runtime_error("Cancellation leaked or replayed work");}
  std::cout<<"cpp disconnect preserves pending call IDs and cancels tool work\n";
}
void noncooperative_cancellation(){
  auto socket=std::make_shared<SteeringSocket>();socket->pending=true;auto control=run_control();auto settled=std::make_shared<std::atomic<bool>>(false);
  auto client=ai("openai",object({{"api_key","test"},{"model","gpt-6-astra"}}));dynamic_cast<OpenAICompatibleClient&>(*client).session_web_socket_factory([socket](const std::string&,Value){return socket;});
  auto release=std::make_shared<std::atomic<bool>>(false);
  Tool lookup("lookup","Lookup");lookup.execution("background").context_handler([control,settled,release](Value,const AxToolContext& context){if(context.call_id!="pending-call")throw std::runtime_error("Lost context call ID");control.abort();auto deadline=std::chrono::steady_clock::now()+std::chrono::seconds(3);while(!release->load()&&std::chrono::steady_clock::now()<deadline)std::this_thread::sleep_for(std::chrono::milliseconds(1));if(!release->load())throw std::runtime_error("Caller waited for noncooperative work");settled->store(true);return Value("LATE");});
  auto program=ax("question -> answer");program.add_tool(lookup);auto start=std::chrono::steady_clock::now();
  try{program.forward(*client,object({{"question","Find answer"}}),object({{"control",control.value()}}));throw std::runtime_error("Cancelled run returned success");}catch(const std::exception& error){if(std::string(error.what()).find("pending-call")==std::string::npos)throw;}
  if(std::chrono::steady_clock::now()-start>std::chrono::seconds(2))throw std::runtime_error("Cancellation blocked the caller");
  auto unresolved=program.get_function_call_traces();if(Core::iter(unresolved).size()!=1||display(Core::get(Core::get(unresolved,0),"id"))!="pending-call"||display(Core::get(Core::get(unresolved,0),"status"))!="unresolved")throw std::runtime_error("Unresolved action missing from tool traces");
  if(settled->load())throw std::runtime_error("Caller waited for tool completion");release->store(true);
  auto deadline=std::chrono::steady_clock::now()+std::chrono::seconds(2);while(!settled->load()&&std::chrono::steady_clock::now()<deadline)std::this_thread::sleep_for(std::chrono::milliseconds(1));
  {std::lock_guard<std::mutex> lock(socket->mutex);if(!socket->closed||socket->sent.size()!=1||!settled->load())throw std::runtime_error("Cancellation leaked or replayed work");}
  std::cout<<"cpp noncooperative cancellation returns before tool completion\n";
}
class BoundarySocket final:public RealtimeTransport {
 public:
  std::mutex mutex;std::condition_variable ready;std::deque<Value> incoming;bool received=false,closed=false;int sent=0,reads=0;
  void send(const Value& event)override{std::lock_guard<std::mutex> lock(mutex);++sent;if(display(Core::get(event,"type"))!="response.create")throw std::runtime_error("Steered a completed response");incoming.push_back(object({{"type","response.created"},{"response",object({{"id","parent"}})}}));incoming.push_back(object({{"type","response.output_text.delta"},{"delta","provisional"}}));incoming.push_back(completed("parent",""));ready.notify_all();}
  bool recv(Value& event)override{std::unique_lock<std::mutex> lock(mutex);if(reads==3){received=true;ready.notify_all();}ready.wait(lock,[&]{return closed||!incoming.empty();});if(closed)return false;event=incoming.front();incoming.pop_front();++reads;return true;}
  void close()override{std::lock_guard<std::mutex> lock(mutex);closed=true;ready.notify_all();}
};
void buffered_steering_boundary(){
 auto socket=std::make_shared<BoundarySocket>();auto client=ai("openai",object({{"api_key","test"},{"model","gpt-6-astra"}}));dynamic_cast<OpenAICompatibleClient&>(*client).session_web_socket_factory([socket](const std::string&,Value){return socket;});
 auto session=client->open_chat_session(object({{"chat_prompt",Value(Array{object({{"role","user"},{"content","probe"}})})}}),Value::object());
 {std::unique_lock<std::mutex> lock(socket->mutex);if(!socket->ready.wait_for(lock,std::chrono::seconds(2),[&]{return socket->received;}))throw std::runtime_error("Terminal frame was not received");}
 if(display(Core::get(session->next(std::chrono::seconds(2)),"type"))!="response")throw std::runtime_error("Missing delta");
 if(session->update(object({{"type","steer"},{"text","Correct answer"}}))!="next-response")throw std::runtime_error("Steered buffered completion");session->close();
 std::cout<<"cpp buffered terminal steering boundary passed\n";
}
void native_steering(){
  auto socket=std::make_shared<SteeringSocket>();auto control=run_control();bool steered=false;std::vector<std::string> applied;
  control.on_event([&](Value event){if(stringify(Core::get(event,"type"))=="\"model.output\""&&!steered){steered=true;control.steer("Use CORRECTED.");}if(stringify(Core::get(event,"type"))=="\"applied\"")applied.push_back(stringify(Core::get(event,"timing")));});
  auto client=ai("openai",object({{"api_key","test"},{"model","gpt-6-astra"},{"base_url","https://example.test/v1"}}));
  dynamic_cast<OpenAICompatibleClient&>(*client).session_web_socket_factory([socket](const std::string& url,Value headers){if(url!="wss://example.test/v1/responses" || stringify(Core::get(headers,"Authorization"))!="\"Bearer test\"")throw std::runtime_error("Lost endpoint or authentication");return socket;});
  auto program=ax("question -> answer");Value result=program.forward(*client,object({{"question","Find answer"}}),object({{"control",control.value()}}));
  if(stringify(Core::get(result,"answer"))!="\"CORRECTED\"" || applied!=std::vector<std::string>{"\"native\""})throw std::runtime_error("Incorrect native steering completion");
  {std::lock_guard<std::mutex> lock(socket->mutex);if(socket->sent.size()!=2||!socket->closed)throw std::runtime_error("Socket replay or leak");}
  Value logs=program.get_chat_log();if(stringify(Core::get(Core::get(logs,0),"remote_id"))!="\"parent\"" || stringify(Core::get(Core::get(logs,1),"remote_id"))!="\"successor\"")throw std::runtime_error("Lost response accounting");
  std::cout<<"cpp native steering, successor accounting, and closure passed\n";
}
void flow_isolation(){
  auto transport=std::make_shared<FlowTransport>();auto calls=std::make_shared<std::atomic<int>>(0);
  auto client=ai("openai",object({{"api_key","test"},{"model","gpt-6-astra"}}));dynamic_cast<OpenAICompatibleClient&>(*client).shared_transport(transport);
  MultiServiceRouter routed;routed.set_service_entry("smart",client);
  if(!Core::truthy(Core::get(routed.get_features("smart"),"asyncTools")))throw std::runtime_error("Alias capabilities");
  auto control=run_control();std::vector<std::string> applied;
  control.on_event([&applied](Value event){if(stringify(Core::get(event,"type"))=="\"applied\"")applied.push_back(stringify(Core::get(event,"path")));});control.steer("Keep the reference exact.");
  Tool lookup("lookup","Look up reference",object({{"type","object"},{"properties",object({{"query",object({{"type","string"}})}})},{"required",Value(Array{"query"})}}),[calls](Value args){++*calls;return Core::get(args,"query");});lookup.execution("background");
  auto first=ax("question -> answer"),second=ax("question -> answer");first.add_tool(lookup);second.add_tool(lookup);
  auto workflow=flow().execute("first",first).execute("second",second).returns(object({{"first","firstResult"},{"second","secondResult"}}));
  for(int index=0;index<2;index++){
    Value result=workflow.forward(routed,object({{"question","Find reference"}}),object({{"control",control.value()},{"model","smart"}}));
    if(stringify(result)!=stringify(object({{"first",object({{"answer","REF-42"}})},{"second",object({{"answer","REF-42"}})}})))throw std::runtime_error("Invalid flow result");
  }
  if(transport->requests.load()!=8 || calls->load()!=4 || applied!=std::vector<std::string>{"\"root/first\"","\"root/second\"","\"root/first\"","\"root/second\""})throw std::runtime_error("Invalid flow isolation");
  control.on_event([&control](Value event){if(stringify(Core::get(event,"type"))=="\"completed\"" && stringify(Core::get(event,"path"))=="\"root/first\"")control.abort();});
  bool aborted=false;try{workflow.forward(routed,object({{"question","Find reference"}}),object({{"control",control.value()},{"model","smart"}}));}catch(const std::exception& error){aborted=std::string(error.what()).find("Flow aborted")!=std::string::npos;}
  if(!aborted || transport->requests.load()!=10 || calls->load()!=5)throw std::runtime_error("Aborted flow started another node");
  std::cout<<"cpp flow conversations, future root updates, and controlled reruns passed\n";
}
void mixed_balancer(){
  struct ChatOnly:OpenAICompatibleClient {
    bool unused;int calls=0;std::shared_ptr<std::atomic<int>> tools;
    ChatOnly(bool unused,std::shared_ptr<std::atomic<int>> tools):OpenAICompatibleClient(object({{"api_key","test"},{"model","gpt-6-astra"}})),unused(unused),tools(tools){}
    Value get_features(Value model=Value())override{Value features=OpenAICompatibleClient::get_features(model);Core::set(features,"asyncTools",unused);return features;}
    Value chat(Value request,Value options)override{
      if(unused)throw std::runtime_error("Pinned run changed providers");++calls;
      if(calls==1)return parse_json(R"({"results":[{"function_calls":[{"id":"balanced-call","function":{"name":"lookup","params":{}}}]}]})");
      if(calls!=2||tools->load()!=1||stringify(request).find("FALLBACK")==std::string::npos||stringify(request).find("balanced-call")==std::string::npos)throw std::runtime_error("Lost tool continuation");
      return object({{"results",array({object({{"content","{\"answer\":\"FALLBACK\"}"}})})}});
    }
    std::shared_ptr<AxChatSession> open_chat_session(Value,Value)override{throw std::runtime_error("Chat-only selection opened a session");}
  };
  auto tools=std::make_shared<std::atomic<int>>(0);auto ordinary=std::make_shared<ChatOnly>(false,tools);auto unused=std::make_shared<ChatOnly>(true,tools);
  AxBalancer client(std::vector<std::shared_ptr<AxAIService>>{ordinary,unused},object({{"strategy","input_order"}}));
  Tool lookup("lookup","Lookup",Value(),[tools](Value){++*tools;return Value("FALLBACK");});lookup.execution("background");auto program=ax("question -> answer");program.add_tool(lookup);
  Value result=program.forward(client,object({{"question","Lookup"}}));if(display(Core::get(result,"answer"))!="FALLBACK"||ordinary->calls!=2||unused->calls!=0||tools->load()!=1)throw std::runtime_error("Invalid pinned result");
  std::cout<<"cpp mixed balancer pins ordinary-chat fallback for the entire run\n";
}


class InvalidArgumentsTransport final: public Transport {
 public:
  int requests=0;bool exhausted;std::string arguments;
  explicit InvalidArgumentsTransport(bool exhausted,std::string arguments):exhausted(exhausted),arguments(std::move(arguments)){}
  Value call(Value)override{throw std::runtime_error("Expected streaming");}
  void stream(Value request,AxTransportStreamHandler handler)override{
    if(++requests==1){handler(object({{"type","response.completed"},{"response",object({{"id","invalid"},{"model","gpt-6-astra"},{"output",Value(Array{object({{"type","function_call"},{"id","invalid-item"},{"call_id","invalid-call"},{"name","validated_lookup"},{"arguments",arguments}})})}})}}));return;}
    if(exhausted||requests!=2)throw std::runtime_error("Work replayed after exhaustion");
    Value body=Core::get(request,"json"),outputs=Core::get(body,"input");
    if(display(Core::get(body,"previous_response_id"))!="invalid"||display(Core::len(outputs))!="1"||display(Core::get(Core::get(outputs,0),"call_id"))!="invalid-call"||display(Core::string_lower(Core::get(Core::get(outputs,0),"output"))).find("query")==std::string::npos)throw std::runtime_error("Invalid correction continuation: "+stringify(body));
    handler(completed("corrected","{\"answer\":\"CORRECTED\"}"));
  }
};
static void invalid_arguments_and_exhaustion(){
 for(const std::string arguments:{"{}","{\"query\":123}","{\"query\":false}","{\"query\":null}","{\"query\":\"ab\"}"}) for(bool exhausted:{false,true}){
  auto transport=std::make_shared<InvalidArgumentsTransport>(exhausted,arguments);auto calls=std::make_shared<std::atomic<int>>(0);
  auto client=ai("openai",object({{"api_key","test"},{"model","gpt-6-astra"}}));dynamic_cast<OpenAICompatibleClient&>(*client).shared_transport(transport);
  Tool lookup("validated_lookup","Requires a query",parse_json(R"schema({"type":"object","$defs":{"query":{"type":"string","minLength":3,"pattern":"^[A-Z]+$"}},"properties":{"query":{"$ref":"#/$defs/query"}},"required":["query"],"additionalProperties":false})schema"),[calls](Value){++*calls;return Value("unexpected");});lookup.execution("background");auto program=ax("question -> answer");program.add_tool(lookup);
  bool failed=false;try{Value result=program.forward(*client,object({{"question","Find reference"}}),object({{"maxSteps",exhausted?1:3}}));if(display(Core::get(result,"answer"))!="CORRECTED")throw std::logic_error("Incorrect final answer");}catch(const AxError& error){failed=true;if(!exhausted||std::string(error.what()).find("steps")==std::string::npos)throw;}
  if(failed!=exhausted||calls->load()!=0||transport->requests!=(exhausted?1:2))throw std::runtime_error("Invalid terminal outcome, handler execution, or replay");
 }
 std::cout<<"cpp invalid arguments, correction continuation, and step exhaustion passed\n";
}
class NativeFileTransport final:public Transport {
 public: std::vector<Value> requests;
 Value call(Value request) override {requests.push_back(Core::get(request,"json"));return object({{"status",200},{"json",object({{"id","file-response"},{"choices",Value(Array{object({{"index",0},{"message",object({{"role","assistant"},{"content","{\"summary\":\"Read\"}"}})}})})}})}});}
};
static void native_files(){
 auto transport=std::make_shared<NativeFileTransport>();
 auto client=std::make_shared<OpenAICompatibleClient>("openai","OpenAI",object({{"api_key","test"},{"model","gpt-5.6"}}),transport.get(),"gpt-5.6","");
 auto balancer=std::make_shared<AxBalancer>(std::vector<std::shared_ptr<AxAIService>>{client});
 ProviderRouter router({balancer});router.file_to_text([](const std::string&,const std::string&)->std::string{throw std::runtime_error("Native file extracted");});
 Value message=object({{"role","user"},{"content",Value(Array{object({{"type","text"},{"text","Read"}}),object({{"type","file"},{"filename","report.pdf"},{"mimeType","application/pdf"},{"data","JVBERi0="},{"extractedText","fallback"},{"cache",true}}),object({{"type","text"},{"text","Summarize"}})})}});
 std::string original=stringify(message);Value prompt=Value(Array{message});Value request=object({{"chatPrompt",prompt},{"modelConfig",object({{"stream",false}})}});
 router.chat(request);
 Core::append(prompt,object({{"role","assistant"},{"content","Read"}}));Core::append(prompt,object({{"role","user"},{"content","Continue"}}));Core::set(request,"chatPrompt",prompt);router.chat(request);
 if(stringify(message)!=original||transport->requests.size()!=2)throw std::runtime_error("History mutated or work replayed");
 for(auto body:transport->requests){auto parts=Core::get(Core::get(Core::get(body,"messages"),0),"content");
 if(display(Core::get(Core::get(Core::get(parts,1),"file"),"filename"))!="report.pdf"||display(Core::get(Core::get(Core::get(parts,1),"file"),"file_data"))!="data:application/pdf;base64,JVBERi0="||display(Core::get(Core::get(parts,0),"text"))!="Read"||display(Core::get(Core::get(parts,2),"text"))!="Summarize")throw std::runtime_error("Native file or ordering lost");
 }
 auto generated=ax("document:file -> summary:string").forward(router,object({{"document",object({{"filename","report.pdf"},{"mimeType","application/pdf"},{"data","JVBERi0="}})}}));
 if(display(Core::get(generated,"summary"))!="Read"||transport->requests.size()!=3)throw std::runtime_error("Router lost generator completion");

}
static void file_extraction(){
 NativeFileTransport transport;
 auto client=std::make_shared<OpenAICompatibleClient>("deepseek","DeepSeek",object({{"api_key","test"},{"model","deepseek-v4-flash"}}),&transport,"deepseek-v4-flash","");
 ProviderRouter router(std::vector<std::shared_ptr<AxAIService>>{client});
 router.file_to_text([](const std::string& data,const std::string& mime){if(data!="JVBERi0="||mime!="application/pdf")throw std::runtime_error("Extraction arguments lost");return std::string();});
 auto request=object({{"chatPrompt",Value(Array{object({{"role","user"},{"content",Value(Array{object({{"type","file"},{"data","JVBERi0="},{"mimeType","application/pdf"}})})}})})}});
 router.chat(request);
 if(display(Core::get(Core::get(Core::get(transport.requests[0],"messages"),0),"content"))!="")throw std::runtime_error("Empty extraction lost");
 router.file_to_text([](const std::string&,const std::string&)->std::string{throw std::runtime_error("extractor failed");});
 bool failed=false;try{router.chat(request);}catch(const AxError& error){failed=std::string(error.what()).find("extractor failed")!=std::string::npos;}
 if(!failed||transport.requests.size()!=1)throw std::runtime_error("Failed extraction reached transport or error lost");
 ProviderRouter reject_files(std::vector<std::shared_ptr<AxAIService>>{client},Value::object(),object({{"fallbackBehavior","error"}}));
 failed=false;try{reject_files.chat(request);}catch(const AxError& error){failed=std::string(error.what()).find("Files are not supported")!=std::string::npos;}
 if(!failed||transport.requests.size()!=1)throw std::runtime_error("Unsupported file reached transport or error lost");
}
struct OverlapGate {std::mutex mutex;std::condition_variable ready;int requests=0;};
class OwnedOverlapTransport final:public Transport {
  std::shared_ptr<OverlapGate> gate;
 public:
  explicit OwnedOverlapTransport(std::shared_ptr<OverlapGate> gate):gate(std::move(gate)){}
  std::function<std::shared_ptr<Transport>()> owned_worker_factory() override {auto shared=gate;return [shared]{return std::make_shared<OwnedOverlapTransport>(shared);};}
  Value call(Value request) override {
    if(display(Core::get(Core::get(request,"headers"),"Authorization"))!="Bearer worker-test")throw std::runtime_error("Worker lost authentication");
    {std::unique_lock<std::mutex> lock(gate->mutex);++gate->requests;gate->ready.notify_all();if(!gate->ready.wait_for(lock,std::chrono::seconds(3),[&]{return gate->requests==2;}))throw std::runtime_error("Independent nodes did not overlap");}
    return parse_json(R"({"status":200,"json":{"id":"reply","choices":[{"index":0,"message":{"role":"assistant","content":"{\"answer\":\"DONE\"}"},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":1,"total_tokens":3}}})");
  }
};
static void owned_flow_overlap(){
  auto gate=std::make_shared<OverlapGate>();auto transport=std::make_shared<OwnedOverlapTransport>(gate);
  auto client=ai("openai",object({{"api_key","worker-test"},{"model","gpt-5.6"}}));
  dynamic_cast<OpenAICompatibleClient&>(*client).shared_transport(transport);
  auto balancer=std::make_shared<AxBalancer>(std::vector<std::shared_ptr<AxAIService>>{client});
  auto aliases=std::make_shared<MultiServiceRouter>();aliases->set_service_entry("smart",balancer);
  ProviderRouter router(std::vector<std::shared_ptr<AxAIService>>{aliases});
  auto program=ax("question -> answer");auto workflow=flow().execute("first",program).execute("second",program).returns(object({{"first","firstResult"},{"second","secondResult"}}));
  auto result=workflow.forward(router,object({{"question","Ready"}}),object({{"stream",false},{"model","smart"}}));
  if(stringify(result)!=stringify(parse_json(R"({"first":{"answer":"DONE"},"second":{"answer":"DONE"}})"))||Core::iter(workflow.get_chat_log()).size()!=2||gate->requests!=2)throw std::runtime_error("Owned flow result or history incorrect: "+stringify(result));
  std::cout<<"cpp owned flow transport barrier passed\n";
}

struct FailureGate {std::mutex mutex;std::condition_variable ready;int requests=0;bool fast=false,released=false,late=false;std::chrono::steady_clock::time_point failure;};
class FailureTransport final:public Transport {
  std::shared_ptr<FailureGate> gate;
 public:
  explicit FailureTransport(std::shared_ptr<FailureGate> gate):gate(std::move(gate)){}
  std::function<std::shared_ptr<Transport>()> owned_worker_factory() override {auto shared=gate;return [shared]{return std::make_shared<FailureTransport>(shared);};}
  Value call(Value request) override {
    auto body=stringify(Core::get(request,"json"));std::unique_lock<std::mutex> lock(gate->mutex);++gate->requests;gate->ready.notify_all();
    if(!gate->ready.wait_for(lock,std::chrono::seconds(3),[&]{return gate->requests==3;}))throw std::runtime_error("Independent nodes did not overlap");
    std::string content=R"({"fastAnswer":"DONE"})";
    if(body.find("lateAnswer")!=std::string::npos){if(!gate->ready.wait_for(lock,std::chrono::seconds(3),[&]{return gate->released;}))throw std::runtime_error("Late worker was not released");content=R"({"lateAnswer":"LATE"})";gate->late=true;gate->ready.notify_all();}
    else if(body.find("failAnswer")!=std::string::npos){if(!gate->ready.wait_for(lock,std::chrono::seconds(3),[&]{return gate->fast;}))throw std::runtime_error("Completed sibling was not reported");content=R"({"wrong":"invalid"})";}
    return object({{"status",200},{"json",object({{"id","reply"},{"choices",Value(Array{object({{"index",0},{"message",object({{"role","assistant"},{"content",content}})},{"finish_reason","stop"}})})}})}});
  }
};
static void owned_flow_failure(){
  auto gate=std::make_shared<FailureGate>();struct Release{std::shared_ptr<FailureGate> gate;~Release(){std::lock_guard<std::mutex> lock(gate->mutex);gate->released=true;gate->ready.notify_all();}} release{gate};
  auto control=run_control();control.on_event([gate](Value event){if(display(Core::get(event,"type"))=="failed"&&display(Core::get(event,"path"))=="root/fail")gate->failure=std::chrono::steady_clock::now();if(display(Core::get(event,"type"))=="completed"&&display(Core::get(event,"path"))=="root/fast"){std::lock_guard<std::mutex> lock(gate->mutex);gate->fast=true;gate->ready.notify_all();}});
  auto client=ai("openai",object({{"api_key","test"},{"model","gpt-5.6"}}));dynamic_cast<OpenAICompatibleClient&>(*client).shared_transport(std::make_shared<FailureTransport>(gate));
  auto fast=ax("question -> fastAnswer"),fail=ax("question -> failAnswer"),late=ax("question -> lateAnswer");auto workflow=flow().execute("fast",fast).execute("fail",fail).execute("late",late);
  auto started=std::chrono::steady_clock::now();bool failed=false;std::string failure_message;
  try{workflow.forward(*client,object({{"question","Ready"}}),object({{"control",control.value()},{"stream",false},{"maxSteps",1},{"validationRetries",0},{"infraRetries",0}}));}catch(const std::exception& error){failure_message=error.what();failed=failure_message.find("late")!=std::string::npos;}
  if(!failed||gate->failure==std::chrono::steady_clock::time_point{}||std::chrono::steady_clock::now()-gate->failure>std::chrono::seconds(2))throw std::runtime_error("Flow failed to promptly report unresolved work: "+failure_message+"; elapsed_ms="+std::to_string(std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now()-started).count()));
  auto state=stringify(Core::get(workflow.value(),"completed_state"));if(display(Core::get(Core::get(Core::get(workflow.value(),"completed_state"),"fastResult"),"fastAnswer"))!="DONE")throw std::runtime_error("Completed node lost");
  {std::unique_lock<std::mutex> lock(gate->mutex);if(gate->late)throw std::runtime_error("Flow waited for late work");gate->released=true;gate->ready.notify_all();if(!gate->ready.wait_for(lock,std::chrono::seconds(3),[&]{return gate->late;}))throw std::runtime_error("Late work did not finish");if(gate->requests!=3)throw std::runtime_error("Started work replayed");}
  if(state!=stringify(Core::get(workflow.value(),"completed_state")))throw std::runtime_error("Late delivery changed completed state");
  std::cout<<"cpp parallel failure preserves completed state and discards late work\n";
}

class ConcurrentMCPTransport final: public AxMCPTransport {
 public:
  std::mutex mutex;std::condition_variable ready;std::vector<Value> requests;
  void send_notification(Value message)override{if(display(Core::get(message,"method"))!="notifications/initialized")throw std::runtime_error("Unexpected MCP notification");}
  Value send(Value message)override {
    auto method=display(Core::get(message,"method"));Value result;
    if(method=="server/discover")result=object({{"resultType","complete"},{"supportedVersions",Value(Array{"2026-07-28"})},{"ttlMs",60000},{"cacheScope","private"},{"capabilities",object({{"tools",Value::object()}})}});
    else if(method=="initialize")result=object({{"protocolVersion","2025-11-25"},{"serverInfo",object({{"name","orders"},{"version","1"}})},{"capabilities",object({{"tools",Value::object()}})}});
    else if(method=="tools/list")result=object({{"tools",Value(Array{object({{"name","lookup"},{"inputSchema",object({{"type","object"},{"properties",object({{"index",object({{"type","integer"}})}})}})}})})}});
    else {auto params=Core::get(message,"params");if(method!="tools/call"||display(Core::get(params,"name"))!="lookup")throw std::runtime_error("Unexpected native request");
      {std::unique_lock<std::mutex> lock(mutex);requests.push_back(message);ready.notify_all();if(!ready.wait_for(lock,std::chrono::seconds(3),[&]{return requests.size()==32;}))throw std::runtime_error("MCP calls did not overlap");}
      result=object({{"resultType","complete"},{"_meta",object({{"io.modelcontextprotocol/serverInfo",object({{"name","orders"},{"version",Core::get(message,"id")}})}})},{"structuredContent",Core::get(params,"arguments")}});
    }
    return object({{"jsonrpc","2.0"},{"id",Core::get(message,"id")},{"result",result}});
  }
};
void owned_balancer_failure_accounting(){
  struct FailingTransport:Transport {
    std::shared_ptr<std::atomic<int>> calls;explicit FailingTransport(std::shared_ptr<std::atomic<int>> calls):calls(calls){}
    std::function<std::shared_ptr<Transport>()> owned_worker_factory() override {auto counter=calls;return [counter]{return std::make_shared<FailingTransport>(counter);};}
    Value call(Value) override {++*calls;return object({{"status",429},{"json",object({{"error",object({{"message","fixture rate limit"}})}})}});}
  };
  auto calls=std::make_shared<std::atomic<int>>(0);auto client=ai("openai",object({{"api_key","test"},{"model","gpt-5.6"}}));dynamic_cast<OpenAICompatibleClient&>(*client).shared_transport(std::make_shared<FailingTransport>(calls));
  AxBalancer owner(std::vector<std::shared_ptr<AxAIService>>{client},object({{"maxRetries",1},{"initialBackoffMs",0}}));auto worker=owner.owned_worker_factory()();
  auto request=object({{"chat_prompt",array({object({{"role","user"},{"content","Hello"}})})},{"model_config",object({{"stream",false}})}});
  bool failed=false;try{worker->chat(request);}catch(const AxError&){failed=true;}if(!failed||calls->load()==0)throw std::runtime_error("Worker failure was not exercised");int first=calls->load();failed=false;try{owner.chat(request);}catch(const AxError&){failed=true;}if(!failed||calls->load()!=first)throw std::runtime_error("Parent forgot worker failure and replayed route");
  std::cout<<"cpp owned balancer shares failure accounting\n";
}
void concurrent_mcp_header_state(){
  AxMCPStreamableHTTPTransport transport("https://example.com/mcp");
  std::vector<std::future<void>> workers;
  for(int index=0;index<8;++index)workers.push_back(std::async(std::launch::async,[&,index]{
    for(int attempt=0;attempt<200;++attempt){
      transport.set_era(attempt%2 ? "modern" : "legacy");
      transport.set_protocol_version("2026-07-28");
      transport.set_session_id("session-"+std::to_string(index));
      auto headers=transport.build_headers(Value::object(),true,"tools/call",object({{"name","lookup"}}));
      if(!headers.is_object())throw std::runtime_error("Invalid concurrent MCP headers");
      (void)transport.headers();transport.terminate_session();
    }
  }));
  for(auto& worker:workers)worker.get();
  transport.set_era("modern");transport.set_session_id("legacy-session");
  auto headers=transport.build_headers(Value::object(),true,"tools/call",object({{"name","lookup"}}));
  if(!Core::get(headers,"MCP-Session-Id").is_null()||display(Core::get(headers,"MCP-Protocol-Version"))!="2026-07-28")throw std::runtime_error("Modern MCP headers retained legacy state");
  std::cout<<"cpp concurrent MCP header state passed\n";
}
void concurrent_native_mcp(){
  auto transport=std::make_shared<ConcurrentMCPTransport>();AxMCPClient client(transport,object({{"era","modern"},{"namespace","orders"}}));client.init();auto native=client.native_tools().at(0);
  std::vector<std::future<Value>> results;for(int index=0;index<32;index++)results.push_back(std::async(std::launch::async,[native,index]()mutable{return native.handler(object({{"index",index}}));}));
  for(int index=0;index<32;index++){auto result=results[index].get();if(Core::number(Core::get(Core::get(result,"structuredContent"),"index"))!=index)throw std::runtime_error("Lost native MCP result");}
  std::set<std::string> ids;for(const auto& request:transport->requests)ids.insert(display(Core::get(request,"id")));if(ids.size()!=32||transport->requests.size()!=32)throw std::runtime_error("Duplicate native MCP request IDs");
  std::cout<<"cpp concurrent native MCP identities and results passed\n";
}
class MCPAgentTransport final:public AxMCPTransport {
 public:
  std::shared_ptr<Gate> gate;Value schema;std::vector<Value> calls;
  explicit MCPAgentTransport(std::shared_ptr<Gate> gate):gate(gate),schema(parse_json(R"({"type":"object","$defs":{"reference":{"type":"string","minLength":3}},"properties":{"query":{"$ref":"#/$defs/reference"}},"required":["query"],"additionalProperties":false})")){}
  void send_notification(Value)override{throw std::runtime_error("Modern discovery initialized");}
  Value send(Value message)override{
    auto method=display(Core::get(message,"method"));Value result;
    if(method=="server/discover")result=parse_json(R"({"resultType":"complete","supportedVersions":["2026-07-28"],"ttlMs":60000,"cacheScope":"private","capabilities":{"tools":{}}})");
    else if(method=="tools/list")result=object({{"tools",array({object({{"name","lookup"},{"description","Find a reference"},{"inputSchema",schema}})})}});
    else{
      auto params=Core::get(message,"params");if(method!="tools/call"||display(Core::get(params,"name"))!="lookup"||display(Core::get(Core::get(params,"arguments"),"query"))!="REF-42"||!Core::get(params,"_meta").is_object())throw std::runtime_error("Invalid MCP invocation");
      std::unique_lock<std::mutex> lock(gate->mutex);calls.push_back(message);++gate->calls;gate->started=true;gate->ready.notify_all();if(!gate->ready.wait_for(lock,std::chrono::seconds(3),[&]{return gate->released;}))throw std::runtime_error("MCP handler failed to overlap");
      result=parse_json(R"({"resultType":"complete","structuredContent":{"reference":"REF-42"},"content":[]})");
    }
    return object({{"jsonrpc","2.0"},{"id",Core::get(message,"id")},{"result",result}});
  }
};
class MCPAgentModel final:public Transport {
 public:
  std::shared_ptr<MCPAgentTransport> mcp;bool hidden=true;int requests=0;
  explicit MCPAgentModel(std::shared_ptr<MCPAgentTransport> mcp):mcp(mcp){}
  Value respond(Value request,AxTransportStreamHandler handler){
    int number=++requests;auto body=Core::get(request,"json");Value actor=Value::array();for(auto tool:Core::iter(Core::get(body,"tools",Value::array())))if(Core::truthy(Core::get(tool,"async")))Core::append(actor,tool);
    auto stage=[](const std::string& answer){return std::string("{\"completion\":{\"type\":\"final\",\"args\":[\"Report reference\",{\"answer\":\"")+answer+"\"}]}}";};Value event;
    if(hidden){if(!Core::iter(actor).empty())throw std::runtime_error("Undiscovered native tool exposed");event=completed("hidden-"+std::to_string(number),number<3?stage("not discovered"):"{\"answer\":\"not discovered\"}");}
    else if(number==1)event=completed("distiller",stage("Find reference"));
    else if(number==2||number==3){
      if(Core::iter(actor).size()!=1)throw std::runtime_error("Missing discovered native MCP tool");auto tool=Core::get(actor,0);if(display(Core::get(tool,"name"))!="orders_lookup"||stringify(Core::get(tool,"parameters"))!=stringify(mcp->schema))throw std::runtime_error("Lost native MCP schema: "+stringify(tool));
      if(number==3&&(mcp->gate->calls.load()!=0||display(Core::get(body,"previous_response_id"))!="invalid-response"))throw std::runtime_error("Invalid MCP arguments executed or correction lost");
      std::string id=number==2?"invalid-call":"mcp-call";handler(object({{"type","response.output_item.done"},{"item",object({{"type","function_call"},{"id",id},{"call_id",id},{"name","orders_lookup"},{"arguments",number==2?"{\"query\":\"X\"}":"{\"query\":\"REF-42\"}"}})}}));
      if(number==3){auto gate=mcp->gate;std::unique_lock<std::mutex> lock(gate->mutex);if(!gate->ready.wait_for(lock,std::chrono::seconds(3),[&]{return gate->started;}))throw std::runtime_error("Native MCP work did not start");gate->released=true;gate->ready.notify_all();}
      event=completed(number==2?"invalid-response":"mcp-response",stage("provisional"));
    }else if(number==4){auto input=Core::get(body,"input");bool found=false;for(auto item:Core::iter(input))if(display(Core::get(item,"call_id"))=="mcp-call"){auto result=parse_json(display(Core::get(item,"output")));found=display(Core::get(Core::get(result,"structuredContent"),"reference"))=="REF-42";}if(!found||display(Core::get(body,"previous_response_id"))!="mcp-response")throw std::runtime_error("Lost raw MCP continuation: "+stringify(body));event=completed("actor-final",stage("REF-42"));}
    else{if(number!=5||!Core::iter(actor).empty()||stringify(body).find("REF-42")==std::string::npos)throw std::runtime_error("Responder ran before MCP incorporation");event=completed("responder","{\"answer\":\"REF-42\"}");}
    return event;
  }
  Value call(Value request)override{return Core::get(respond(request,[](Value)->bool{throw std::runtime_error("Expected streaming tool call");}),"response");}
  void stream(Value request,AxTransportStreamHandler handler)override{handler(respond(request,handler));}
};
void native_mcp_agent_discovery(){
  auto gate=std::make_shared<Gate>();auto transport=std::make_shared<MCPAgentTransport>(gate);AxMCPClient mcp(transport,object({{"era","modern"},{"namespace","orders"}}));mcp.init();auto tool=mcp.native_tools().at(0);if(tool.execution_mode!="blocking")throw std::runtime_error("MCP inferred background permission");tool.execution("background");
  auto model=std::make_shared<MCPAgentModel>(transport);auto client=ai("openai",object({{"api_key","test"},{"model","gpt-6-astra"}}));dynamic_cast<OpenAICompatibleClient&>(*client).shared_transport(model);
  auto program=agent("question -> answer",object({{"functionDiscovery",true},{"directResponse","off"}}));program.add_tool_module("orders",std::vector<Tool>{tool});
  auto result=program.forward(*client,object({{"question","Find reference"}}));if(display(Core::get(result,"answer"))!="not discovered"||gate->calls.load()!=0||model->requests!=3)throw std::runtime_error("MCP discovery boundary failed");
  program.discover(object({{"tools",array({"orders"})}}));model->hidden=false;model->requests=0;result=program.forward(*client,object({{"question","Find reference"}}));if(display(Core::get(result,"answer"))!="REF-42"||gate->calls.load()!=1||model->requests!=5)throw std::runtime_error("MCP agent final output failed");
  int logged=0;for(auto entry:Core::iter(program.get_action_log()))if(display(Core::get(entry,"call_id"))=="mcp-call"&&display(Core::get(entry,"qualified_name"))=="orders.lookup"&&display(Core::get(entry,"status"))=="ok")++logged;if(logged!=1)throw std::runtime_error("Lost native MCP action log: "+stringify(program.get_action_log()));
  auto duplicate=program.invoke_callable("orders.lookup",object({{"query","REF-42"}}));if(display(Core::get(duplicate,"status"))!="error"||gate->calls.load()!=1)throw std::runtime_error("MCP call replayed through actor code");
  std::cout<<"cpp discovered MCP native agent schema, correction, overlap, result and action log passed\n";
}
void native_mcp_owned_lifetime(){
  auto gate=std::make_shared<Gate>();auto transport=std::make_shared<MCPAgentTransport>(gate);std::optional<Tool> tool;std::future<Value> result;
  {
    AxMCPClient client(transport,object({{"era","modern"},{"namespace","orders"}}));client.init();tool=client.native_tools().at(0);
    result=std::async(std::launch::async,[handler=tool->handler]{return handler(object({{"query","REF-42"}}));});
    std::unique_lock<std::mutex> lock(gate->mutex);if(!gate->ready.wait_for(lock,std::chrono::seconds(3),[&]{return gate->started;}))throw std::runtime_error("MCP lifetime test did not start");
  }
  tool.reset(); // Public client and caller tool are gone while the worker is pending.
  {std::lock_guard<std::mutex> lock(gate->mutex);gate->released=true;gate->ready.notify_all();}
  auto output=result.get();if(display(Core::get(Core::get(output,"structuredContent"),"reference"))!="REF-42")throw std::runtime_error("Owned MCP result was lost");
  std::cout<<"cpp native MCP worker retains invocation state after caller destruction\n";
}

void concurrent_owned_tool_registration(){
  std::vector<std::future<std::vector<Value>>> workers;
  for(int worker=0;worker<8;++worker)workers.push_back(std::async(std::launch::async,[worker]{
    std::vector<Value> values;
    for(int index=0;index<100;++index){int expected=worker*100+index;Tool tool("lookup","Lookup",Value::object(),[expected](Value){return Value(expected);});
      if(index%2)tool.context_handler([expected](Value,const AxToolContext&){return Value(expected);});values.push_back(tool.value());}
    return values;
  }));
  std::set<std::string> ids;
  for(int worker=0;worker<8;++worker){auto values=workers[worker].get();for(int index=0;index<100;++index){auto descriptor=values[index];ids.insert(display(Core::get(descriptor,"__tool_id")));auto output=Core::tool_invoke(descriptor,Value::object());if(Core::number(output)!=worker*100+index)throw std::runtime_error("Tool registration rebound another worker's handler");}}
  if(ids.size()!=800)throw std::runtime_error("Concurrent tool IDs collided");
  std::cout<<"cpp concurrent owned tool registration preserves each handler\n";
}
int main(int argc,char** argv){
  owned_flow_failure();
  owned_flow_overlap();
  concurrent_mcp_header_state();owned_balancer_failure_accounting();native_mcp_owned_lifetime();concurrent_owned_tool_registration();
  if(argc>1&&std::string(argv[1])=="--owned-only")return 0;
 native_files();file_extraction();native_mcp_agent_discovery();
  auto gate=std::make_shared<Gate>();auto transport=std::make_shared<GatedTransport>(gate);
  auto client=ai("openai",object({{"api_key","test"},{"model","gpt-6-astra"},{"model_config",object({{"thinkingTokenBudget","low"}})}}));
  dynamic_cast<OpenAICompatibleClient&>(*client).shared_transport(transport);
  Tool lookup("lookup","Look up a reference",Value::object(),[gate](Value){++gate->calls;std::unique_lock<std::mutex> lock(gate->mutex);gate->started=true;gate->ready.notify_all();if(!gate->ready.wait_for(lock,std::chrono::seconds(5),[&]{return gate->released;}))throw std::runtime_error("Model work did not overlap tool");return Value("REF-42");});
  lookup.execution("background");auto program=ax("question -> answer");program.add_tool(lookup);
  ProviderRouter routed(std::vector<std::shared_ptr<AxAIService>>{client});
  Value result=program.forward(routed,object({{"question","Find reference"}}));
  if(stringify(Core::get(result,"answer"))!="\"REF-42\""||gate->calls.load()!=1)throw std::runtime_error("Provisional output escaped");
  std::cout<<"cpp high-level async overlap and final incorporation passed\n";
  invalid_arguments_and_exhaustion();flow_isolation();native_steering();buffered_steering_boundary();cancellation();disconnect_pending();noncooperative_cancellation();native_agent();concurrent_native_mcp();mixed_balancer();
}
