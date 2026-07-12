// ax-example:start
// title: C++ MCP Task Continuation
// group: mcp
// description: Correlates a terminal MCP task event and dispatches a resume command to the owning AxFlow host.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: advanced
// order: 30
// story: 62
// ax-example:end
#include "axllm/mcp.hpp"
#include <cstdlib>
#include <iostream>

int main() {
  const char* key = std::getenv("OPENAI_API_KEY"); if (!key) key = std::getenv("OPENAI_APIKEY");
  if (!key) return 2;
  axllm::AxEventRoute route{"task-resume", "resume", axllm::object({{"types", axllm::array({"mcp.task.status"})}}), "reindex-flow"};
  axllm::AxEventRuntime runtime({route});
  auto normalized = axllm::AxEventRuntime::normalize_mcp("inventory", "notifications/tasks/status", axllm::object({{"task", axllm::object({{"taskId", "42"}, {"status", "completed"}})}}));
  axllm::AxEventEnvelope event{"1.0", "task-42-complete", axllm::display(axllm::Core::get(normalized, "source")), axllm::display(axllm::Core::get(normalized, "type")), "inventory:42", axllm::Core::get(normalized, "data")};
  auto commands = runtime.publish(event, "tenant:demo", "authenticated");
  if (axllm::display(axllm::Core::get(axllm::Core::get(commands, 0), "action")) == "resume") {
    auto status = axllm::ax("taskId:string -> status:string");
    auto flow = axllm::flow(axllm::object({{"id", "reindex-flow"}})).execute("status", status).returns(axllm::object({{"status", "status"}}));
    axllm::OpenAICompatibleClient llm(axllm::object({{"api_key", key}, {"model", "gpt-5.4-mini"}}));
    std::cout << axllm::stringify(flow.forward(llm, axllm::object({{"taskId", "42"}}))) << "\n";
  }
}
