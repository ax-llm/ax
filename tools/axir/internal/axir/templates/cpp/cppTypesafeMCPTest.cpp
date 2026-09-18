#include "axllm/axllm.hpp"
#include "axllm/mcp.hpp"
#include <future>
#include <deque>
#include <iostream>
using namespace axllm;
static void check(bool value,const char* message){if(!value)throw std::runtime_error(message);}
static Value request(int id){return Value(Object{{"jsonrpc","2.0"},{"id",id},{"method","ping"}});}
struct Socket:RealtimeTransport{
  std::mutex mutex;std::condition_variable changed;std::deque<Value> incoming;int sent=0;bool closed=false;std::atomic<bool> fail{false};
  void send(const Value&)override{if(fail)throw std::runtime_error("send failed");std::lock_guard<std::mutex> lock(mutex);sent++;changed.notify_all();}
  bool recv(Value& out)override{std::unique_lock<std::mutex> lock(mutex);changed.wait(lock,[&]{return closed||!incoming.empty();});if(incoming.empty())return false;out=incoming.front();incoming.pop_front();return true;}
  void close()override{std::lock_guard<std::mutex> lock(mutex);closed=true;changed.notify_all();}
  void wait_sent(int count){std::unique_lock<std::mutex> lock(mutex);check(changed.wait_for(lock,std::chrono::seconds(2),[&]{return sent>=count;}),"request did not start");}
  void respond(const std::string& value){std::lock_guard<std::mutex> lock(mutex);incoming.push_back(Value(Object{{"id",1},{"result",value}}));changed.notify_all();}
};
static void error(std::future<Value>& result,const std::string& expected){check(result.wait_for(std::chrono::seconds(2))==std::future_status::ready,"pending request leaked");try{result.get();throw std::runtime_error("Expected failure");}catch(const std::exception& actual){check(std::string(actual.what()).find(expected)!=std::string::npos,"unexpected request error");}}
static void websocket(){
  auto socket=std::make_shared<Socket>();AxMCPWebSocketTransport transport("ws://example.test",[socket](const auto&){return socket;});transport.set_protocol_version("2025-03-26");
  Value batch=Value(Array{request(1),request(2)});socket->fail=true;
  auto single=std::async(std::launch::async,[&]{return transport.send(request(1));});error(single,"send failed");
  auto failed_batch=std::async(std::launch::async,[&]{return transport.send_batch(batch);});error(failed_batch,"send failed");socket->fail=false;
  auto obsolete=std::make_shared<std::atomic<bool>>(false);AxToolContext old;old.cancelled=obsolete;
  auto first=std::async(std::launch::async,[&]{return transport.send_with_context(request(1),Value::object(),old);});socket->wait_sent(1);socket->respond("first");check(display(Core::get(first.get(),"result"))=="first","first response");
  auto second=std::async(std::launch::async,[&]{return transport.send(request(1));});socket->wait_sent(2);obsolete->store(true);
  auto duplicate=std::async(std::launch::async,[&]{return transport.send(request(1));});error(duplicate,"already pending");socket->respond("second");check(display(Core::get(second.get(),"result"))=="second","old cancellation erased reused ID");
  AxToolContext context;context.cancelled=std::make_shared<std::atomic<bool>>(false);
  auto aborted=std::async(std::launch::async,[&]{return transport.send_batch(batch,context);});socket->wait_sent(3);context.cancelled->store(true);error(aborted,"cancelled");
  auto pending=std::async(std::launch::async,[&]{return transport.send_batch(batch);});socket->wait_sent(4);transport.close();error(pending,"closed");
}
struct NativeTransport:Transport{
  std::atomic<int> discovery{0};
  Value call(Value request)override{
    if(display(Core::get(request,"method"))=="GET"){
      check(Core::get(request,"json").is_null()&&Core::get(request,"data").is_null(),"GET had body");
      if(discovery.fetch_add(1)==0)return Value(Object{{"status",429},{"json",Value(Object{{"error","retry"}})}});
      return parse_json("{\"models\":[{\"name\":\"jev-latest\",\"description\":\"Jev\",\"release_date\":\"2026-09-01\"}]}");
    }
    auto payload=Core::get(request,"json");Value answers=Value::object();for(auto key:Core::iter(Core::map_keys(Core::get(payload,"questions"))))Core::set(answers,key,Value(Object{{"type","noul"},{"noul",Core::get(Core::get(payload,"state"),"probability")}}));
    return Value(Object{{"model",Core::get(payload,"model")},{"answers",answers},{"usage",Value(Object{{"input_tokens",1},{"output_tokens",1}})}});
  }
};
static void native_client(){
  NativeTransport transport;std::atomic<int> credentials{0};
  auto client=typesafe(Value(Object{{"retry",Value(Object{{"maxRetries",1},{"initialDelayMs",1}})}}),&transport,[&](const AxCredentialRequest&){credentials++;return std::map<std::string,std::string>{{"Authorization","Bearer test"}};});
  auto models=client.list_models();check(models.size()==1&&transport.discovery==2&&credentials==2,"model discovery retry or credentials");
  std::vector<std::future<TypesafeResponse>> requests;
  for(int i=0;i<10;i++)requests.push_back(std::async(std::launch::async,[&,i]{std::string key="question"+std::to_string(i);auto result=client.system_one(Value(Object{{"state",Value(Object{{"probability",i/10.0}})},{"questions",Value(Object{{key,Value(Object{{"type","noul"}})}})}}));check(std::get<TypesafeNoul>(result.answers.at(key)).noul==i/10.0,"native probability or question key changed");return result;}));
  for(auto& result:requests)result.get();
  AxCancellationToken token;token.cancel("cancel native");int before=credentials;
  try{client.list_models(Value::object(),&token);throw std::runtime_error("expected cancellation");}catch(const AxAIServiceAbortedError&){}
  check(credentials==before,"pre-aborted request accessed credentials");
}
int main(){websocket();native_client();std::cout<<"C++ Typesafe native client and MCP WebSocket cleanup passed\n";}
