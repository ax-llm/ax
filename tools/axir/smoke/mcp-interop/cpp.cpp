#include "mcp.hpp"

#include <cstdlib>
#include <iostream>
#include <stdexcept>
#include <string>

using namespace axllm;

int main() {
  const char* endpoint = std::getenv("AX_MCP_ENDPOINT");
  if (!endpoint) throw std::runtime_error("AX_MCP_ENDPOINT is required");
  auto transport = std::make_shared<AxMCPStreamableHTTPTransport>(
      endpoint,
      object({{"ssrfProtection", object({{"requireHttps", false}, {"allowLocalhost", true}, {"allowPrivateNetworks", true}})}}));
  AxMCPClient client(transport, object({{"namespace", "foreign"}, {"era", "auto"}}));
  auto catalog = client.inspect_catalog();
  if (client.get_era() != "legacy" || catalog.protocol_version != "2025-11-25") {
    throw std::runtime_error("unexpected MCP classification: era=" + client.get_era() + " version=" + catalog.protocol_version);
  }
  if (Core::iter(catalog.tools).empty()) throw std::runtime_error("foreign MCP catalog has no tools");
  std::cout << "AX_MCP_INTEROP_READY" << std::endl;
  auto result = client.call_tool("echo", object({{"message", "ax-interop-cpp"}}));
  if (display(result).find("Echo: ax-interop-cpp") == std::string::npos) {
    throw std::runtime_error("unexpected echo result: " + display(result));
  }
  client.close();
  std::cout << "AX_MCP_INTEROP_OK" << std::endl;
}
