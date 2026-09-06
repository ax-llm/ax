#include "axllm/axllm.hpp"
#include <iostream>
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
    int number=++requests;Value body=Core::get(request,"json");if(number==2){Value tool=Core::get(Core::get(body,"tools"),0);if(stringify(Core::get(tool,"name"))!="\"tools_lookup\""||!Core::truthy(Core::get(tool,"async")))throw std::runtime_error("Missing native actor tool");
      handler(object({{"type","response.output_item.done"},{"item",object({{"type","function_call"},{"id","item"},{"call_id","agent-call"},{"name","tools_lookup"},{"arguments","{\"query\":\"REF-42\"}"}})}}));
      {std::unique_lock<std::mutex> lock(gate->mutex);if(!gate->ready.wait_for(lock,std::chrono::seconds(2),[&]{return gate->started;}))throw std::runtime_error("Agent handler did not overlap model work");gate->released=true;gate->ready.notify_all();}
      handler(completed("executor1","{\"completion\":{\"type\":\"final\",\"args\":[\"Report reference\",{\"answer\":\"provisional\"}]}}"));return;
    }
    if(number!=3||stringify(Core::get(body,"previous_response_id"))!="\"executor1\""||stringify(Core::get(body,"input")).find("REF-42")==std::string::npos)throw std::runtime_error("Lost native tool result");
    handler(completed("executor2","{\"completion\":{\"type\":\"final\",\"args\":[\"Report reference\",{\"answer\":\"REF-42\"}]}}"));
  }
};
void native_agent(){
  auto gate=std::make_shared<Gate>();auto transport=std::make_shared<AgentSessionTransport>(gate);auto client=ai("openai",object({{"api_key","test"},{"model","gpt-6-astra"}}));dynamic_cast<OpenAICompatibleClient&>(*client).shared_transport(transport);
  Tool lookup("lookup","Lookup",object({{"type","object"},{"properties",object({{"query",object({{"type","string"}})}})},{"required",Value(Array{"query"})}}),[gate](Value args){++gate->calls;std::unique_lock<std::mutex> lock(gate->mutex);gate->started=true;gate->ready.notify_all();if(!gate->ready.wait_for(lock,std::chrono::seconds(2),[&]{return gate->released;}))throw std::runtime_error("Agent model did not overlap tool");return Core::get(args,"query");});lookup.execution("background");
  auto program=agent("question -> answer",object({{"directResponse","off"}}));program.add_tool_module("tools",std::vector<Tool>{lookup});Value result=program.forward(*client,object({{"question","Find reference"}}));
  if(stringify(Core::get(result,"answer"))!="\"REF-42\""||gate->calls.load()!=1||transport->requests.load()!=4)throw std::runtime_error("Invalid native agent result");
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
 for(const std::string arguments:{"{}","{\"query\":123}","{\"query\":false}","{\"query\":null}"}) for(bool exhausted:{false,true}){
  auto transport=std::make_shared<InvalidArgumentsTransport>(exhausted,arguments);auto calls=std::make_shared<std::atomic<int>>(0);
  auto client=ai("openai",object({{"api_key","test"},{"model","gpt-6-astra"}}));dynamic_cast<OpenAICompatibleClient&>(*client).shared_transport(transport);
  Tool lookup("validated_lookup","Requires a query",object({{"type","object"},{"properties",object({{"query",object({{"type","string"}})}})},{"required",Value(Array{"query"})}}),[calls](Value){++*calls;return Value("unexpected");});lookup.execution("background");auto program=ax("question -> answer");program.add_tool(lookup);
  bool failed=false;try{Value result=program.forward(*client,object({{"question","Find reference"}}),object({{"maxSteps",exhausted?1:3}}));if(display(Core::get(result,"answer"))!="CORRECTED")throw std::logic_error("Incorrect final answer");}catch(const AxError& error){failed=true;if(!exhausted||std::string(error.what()).find("steps")==std::string::npos)throw;}
  if(failed!=exhausted||calls->load()!=0||transport->requests!=(exhausted?1:2))throw std::runtime_error("Invalid terminal outcome, handler execution, or replay");
 }
 std::cout<<"cpp invalid arguments, correction continuation, and step exhaustion passed\n";
}
int main(){
  auto gate=std::make_shared<Gate>();auto transport=std::make_shared<GatedTransport>(gate);
  auto client=ai("openai",object({{"api_key","test"},{"model","gpt-6-astra"},{"model_config",object({{"thinkingTokenBudget","low"}})}}));
  dynamic_cast<OpenAICompatibleClient&>(*client).shared_transport(transport);
  Tool lookup("lookup","Look up a reference",Value::object(),[gate](Value){++gate->calls;std::unique_lock<std::mutex> lock(gate->mutex);gate->started=true;gate->ready.notify_all();if(!gate->ready.wait_for(lock,std::chrono::seconds(5),[&]{return gate->released;}))throw std::runtime_error("Model work did not overlap tool");return Value("REF-42");});
  lookup.execution("background");auto program=ax("question -> answer");program.add_tool(lookup);
  ProviderRouter routed(std::vector<std::shared_ptr<AxAIService>>{client});
  Value result=program.forward(routed,object({{"question","Find reference"}}));
  if(stringify(Core::get(result,"answer"))!="\"REF-42\""||gate->calls.load()!=1)throw std::runtime_error("Provisional output escaped");
  std::cout<<"cpp high-level async overlap and final incorporation passed\n";
  invalid_arguments_and_exhaustion();flow_isolation();native_steering();buffered_steering_boundary();cancellation();disconnect_pending();noncooperative_cancellation();native_agent();mixed_balancer();
}
