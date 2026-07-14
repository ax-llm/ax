// ax-example:start
// title: C++ MCP Resource Wake
// group: mcp
// description: Subscribes over real Streamable HTTP and lets AxEventRuntime wake an authenticated Agent automatically.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY, AX_MCP_ENDPOINT
// level: intermediate
// order: 20
// story: 61
// ax-example:end
#include "axllm/mcp.hpp"
#include "axllm/runtime/quickjs/quickjs_runtime.hpp"
#include <chrono>
#include <condition_variable>
#include <cstdlib>
#include <iostream>
#include <mutex>

int main() {
  const char* key=std::getenv("OPENAI_API_KEY");if(!key)key=std::getenv("OPENAI_APIKEY");const char* endpoint=std::getenv("AX_MCP_ENDPOINT");if(!key||!endpoint)return 2;std::string url(endpoint);bool local=url.rfind("http://127.0.0.1",0)==0;
  auto transport=std::make_shared<axllm::AxMCPStreamableHTTPTransport>(url,axllm::object({{"ssrfProtection",axllm::object({{"requireHttps",!local},{"allowLocalhost",local},{"allowPrivateNetworks",local}})}}));auto client=std::make_shared<axllm::AxMCPClient>(transport,axllm::object({{"namespace","inventory"}}));auto source=std::make_shared<axllm::AxMCPEventSource>(client,"inventory","tenant:demo","authenticated",std::vector<std::string>{"demo://inventory"});
  auto program=axllm::agent("uri:string -> summary:string",axllm::object({{"runtime",axllm::object({{"language","JavaScript"}})}}));axllm::OpenAICompatibleClient llm(axllm::object({{"api_key",key},{"model","gpt-5.4-mini"}}));axllm::runtime::quickjs::QuickJsCodeRuntime js;std::mutex mutex;std::condition_variable changed;bool complete=false;
  axllm::AxEventTarget target;target.id="inventory-agent";target.retrySafety="idempotent";target.mapInput=[](const axllm::AxEventEnvelope& event,const axllm::AxEventContinuation*){return axllm::object({{"uri",axllm::Core::get(event.data,"uri")}});};target.invoke=[&](axllm::Value input,const axllm::AxEventInvocationContext&){auto output=program.forward(llm,input,axllm::object({{"runtime",axllm::Core::code_runtime_ref(js)}}));std::cout<<axllm::stringify(output)<<"\n";{std::lock_guard<std::mutex> lock(mutex);complete=true;}changed.notify_all();return output;};
  axllm::AxEventRuntime runtime({axllm::AxEventRoute{"resource-wake","wake",axllm::object({{"types",axllm::array({"mcp.resource.updated"})}}),"inventory-agent",true}});runtime.register_target(std::move(target)).add_source(source).start();std::unique_lock<std::mutex> lock(mutex);if(!changed.wait_for(lock,std::chrono::seconds(60),[&]{return complete;}))throw std::runtime_error("Timed out waiting for an MCP resource notification");lock.unlock();runtime.close();client->close();
}
