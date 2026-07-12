// ax-example:start
// title: C++ MCP Resource Wake
// group: mcp
// description: Normalizes a subscribed resource notification and dispatches an authenticated wake command to an Agent.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: intermediate
// order: 20
// story: 61
// ax-example:end
#include "axllm/mcp.hpp"
#include "axllm/runtime/quickjs/quickjs_runtime.hpp"
#include <cstdlib>
#include <iostream>

int main() {
  const char* key = std::getenv("OPENAI_API_KEY"); if (!key) key = std::getenv("OPENAI_APIKEY");
  if (!key) return 2;
  axllm::AxEventRoute route{"resource-wake", "wake", axllm::object({{"types", axllm::array({"mcp.resource.updated"})}}), "inventory-agent", true};
  axllm::AxEventRuntime runtime({route});
  auto normalized = axllm::AxEventRuntime::normalize_mcp("inventory", "notifications/resources/updated", axllm::object({{"uri", "demo://inventory"}}));
  axllm::AxEventEnvelope event{"1.0", "resource-1", axllm::display(axllm::Core::get(normalized, "source")), axllm::display(axllm::Core::get(normalized, "type")), "tenant:demo", axllm::Core::get(normalized, "data")};
  auto commands = runtime.publish(event, "tenant:demo", "authenticated");
  if (axllm::display(axllm::Core::get(axllm::Core::get(commands, 0), "action")) == "wake") {
    auto program = axllm::agent("uri:string -> summary:string", axllm::object({{"runtime", axllm::object({{"language", "JavaScript"}})}}));
    axllm::OpenAICompatibleClient llm(axllm::object({{"api_key", key}, {"model", "gpt-5.4-mini"}}));
    axllm::runtime::quickjs::QuickJsCodeRuntime js;
    std::cout << axllm::stringify(program.forward(llm, axllm::object({{"uri", "demo://inventory"}}), axllm::object({{"runtime", axllm::Core::code_runtime_ref(js)}}))) << "\n";
  }
}
