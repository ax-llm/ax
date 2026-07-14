// ax-example:start
// title: C++ Native MCP Tools
// group: mcp
// description: Attaches a live MCP client directly to AxGen without a lossy function adapter.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY, MCP_URL
// level: beginner
// order: 10
// story: 60
// ax-example:end
#include "axllm/mcp.hpp"
#include <cstdlib>
#include <iostream>
#include <memory>

int main() {
  const char* key = std::getenv("OPENAI_API_KEY"); if (!key) key = std::getenv("OPENAI_APIKEY");
  const char* endpoint = std::getenv("MCP_URL");
  if (!key || !endpoint) return 2;
  auto transport = std::make_shared<axllm::AxMCPStreamableHTTPTransport>(endpoint);
  auto mcp = std::make_shared<axllm::AxMCPClient>(transport, axllm::object({{"namespace", "inventory"}}));
  axllm::AxExecutionContext context({mcp});
  auto program = axllm::ax("request:string -> answer:string");
  context.attach(program);
  axllm::OpenAICompatibleClient llm(axllm::object({{"api_key", key}, {"model", "gpt-5.4-mini"}}));
  std::cout << axllm::stringify(program.forward(llm, axllm::object({{"request", "Reindex inventory."}}))) << "\n";
  mcp->close();
}
