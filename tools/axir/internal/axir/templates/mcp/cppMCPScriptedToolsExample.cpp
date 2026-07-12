#include "axllm/mcp.hpp"

#include <iostream>
#include <memory>

int main() {
  using namespace axllm;
  auto transport = std::make_shared<AxMCPScriptedTransport>(array({
      object({{"method", "initialize"},
              {"result", object({{"protocolVersion", "2025-11-25"},
                                  {"capabilities", object({{"tools", Value::object()}})},
                                  {"serverInfo", object({{"name", "scripted-mcp"}, {"version", "1.0.0"}})}})}}),
      object({{"method", "tools/list"},
              {"result", object({{"tools", array({object({{"name", "echo"},
                                                            {"description", "Echo text"},
                                                            {"inputSchema", object({{"type", "object"}})}})})}})}}),
      object({{"method", "tools/call"},
              {"result", object({{"structuredContent", object({{"echo", "hello"}})}})}}),
  }));
  AxMCPClient client(transport);
  client.init();
  Value result = client.native_tools().front().handler(object({{"text", "hello"}}));
  if (display(Core::get(Core::get(result, "structuredContent"), "echo", "")) != "hello") return 1;
  std::cout << "cpp-mcp-ok\n";
  return 0;
}
