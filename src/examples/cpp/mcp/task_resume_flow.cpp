// ax-example:start
// title: C++ MCP Task Continuation
// group: mcp
// description: Creates an owned continuation and resumes an AxFlow from real MCP progress and terminal task notifications.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY, AX_MCP_ENDPOINT
// level: advanced
// order: 30
// story: 62
// ax-example:end
#include "axllm/mcp.hpp"
#include <chrono>
#include <condition_variable>
#include <cstdlib>
#include <iostream>
#include <mutex>

int main(){
  const char* key=std::getenv("OPENAI_API_KEY");if(!key)key=std::getenv("OPENAI_APIKEY");const char* endpoint=std::getenv("AX_MCP_ENDPOINT");if(!key||!endpoint)return 2;std::string url(endpoint);bool local=url.rfind("http://127.0.0.1",0)==0;auto transport=std::make_shared<axllm::AxMCPStreamableHTTPTransport>(url,axllm::object({{"ssrfProtection",axllm::object({{"requireHttps",!local},{"allowLocalhost",local},{"allowPrivateNetworks",local}})}}));auto client=std::make_shared<axllm::AxMCPClient>(transport,axllm::object({{"namespace","inventory"}}));client->add_notification_listener([](axllm::Value message){if(axllm::display(axllm::Core::get(message,"method",""))=="notifications/progress")std::cout<<"MCP task progress\n";});client->init();auto result=client->call_tool("start_reindex",axllm::object({{"scope","all"}}));auto task_id=axllm::display(axllm::Core::get(axllm::Core::get(result,"task",axllm::Value::object()),"taskId",""));
  auto status=axllm::ax("taskId:string -> status:string");auto program=axllm::flow(axllm::object({{"id","reindex-flow"}})).execute("status",status).returns(axllm::object({{"status","status"}}));axllm::OpenAICompatibleClient llm(axllm::object({{"api_key",key},{"model","gpt-5.4-mini"}}));std::mutex mutex;std::condition_variable changed;int calls=0;
  axllm::AxEventTarget target;target.id="reindex-flow";target.retrySafety="idempotent";target.waitFor=axllm::array({axllm::object({{"kind","mcp.task"},{"value","taskKey"},{"metadata",axllm::object({{"taskId",task_id}})}})});target.mapInput=[](const axllm::AxEventEnvelope& event,const axllm::AxEventContinuation* continuation){return axllm::object({{"taskId",continuation?axllm::Core::get(continuation->metadata,"taskId"):axllm::Core::get(event.data,"taskId")}});};target.invoke=[&](axllm::Value input,const axllm::AxEventInvocationContext&){auto output=program.forward(llm,input);std::cout<<axllm::stringify(output)<<"\n";{std::lock_guard<std::mutex> lock(mutex);++calls;}changed.notify_all();return output;};
  axllm::AxEventRuntime runtime({axllm::AxEventRoute{"task-start","wake",axllm::object({{"types",axllm::array({"app.task.started"})}}),"reindex-flow"},axllm::AxEventRoute{"task-progress","observe",axllm::object({{"types",axllm::array({"mcp.progress"})}})},axllm::AxEventRoute{"task-resume","resume",axllm::object({{"types",axllm::array({"mcp.task.status"})}}),"reindex-flow"}});runtime.register_target(std::move(target)).start();axllm::AxEventEnvelope event;event.id="task-start";event.source="app://tasks";event.type="app.task.started";event.data=axllm::object({{"taskId",task_id},{"taskKey","inventory:"+task_id}});runtime.publish(event,"tenant:demo","authenticated");auto source=std::make_shared<axllm::AxMCPEventSource>(client,"inventory","tenant:demo","authenticated");source->start_scoped([&](axllm::AxEventEnvelope inbound,std::string scope,std::string trust){runtime.publish(inbound,scope,trust);});std::cout<<"Waiting for terminal MCP task notification "<<task_id<<"\n";std::unique_lock<std::mutex> lock(mutex);if(!changed.wait_for(lock,std::chrono::seconds(60),[&]{return calls>=2;}))throw std::runtime_error("Timed out waiting for the MCP task continuation");lock.unlock();source->close();runtime.close();client->close();
}
