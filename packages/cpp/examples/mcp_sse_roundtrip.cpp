#include "axllm/axllm.hpp"
#include "axllm/mcp.hpp"

#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>

#include <cctype>
#include <iostream>
#include <memory>
#include <string>
#include <thread>

// Drive AxMCPStreamableHTTPTransport::send() through the REAL libcurl
// HttpTransport against an in-process loopback server that answers the JSON-RPC
// POST with Content-Type: text/event-stream -- the MCP Streamable HTTP SSE path
// the ScriptedTransport conformance fixtures bypass. The SSE body interleaves a
// notification ahead of the id-matched response, so a transport that ignored the
// Content-Type (JSON-decoding the raw stream) or returned the first data frame
// would fail. Returns non-zero on any mismatch so axir verify fails if the SSE
// branch regresses. Requires libcurl (AXLLM_ENABLE_CURL); axir verify skips it
// when libcurl is unavailable.

namespace {

std::string drain_request(int fd) {
  std::string buf;
  char tmp[4096];
  size_t header_end = std::string::npos;
  size_t content_length = 0;
  while (true) {
    size_t pos = buf.find("\r\n\r\n");
    if (pos != std::string::npos) {
      header_end = pos + 4;
      break;
    }
    ssize_t n = recv(fd, tmp, sizeof(tmp), 0);
    if (n <= 0) return buf;
    buf.append(tmp, static_cast<size_t>(n));
  }
  std::string lower = buf.substr(0, header_end);
  for (char& c : lower) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
  size_t cl = lower.find("content-length:");
  if (cl != std::string::npos) content_length = std::stoul(lower.substr(cl + 15));
  while (buf.size() - header_end < content_length) {
    ssize_t n = recv(fd, tmp, sizeof(tmp), 0);
    if (n <= 0) break;
    buf.append(tmp, static_cast<size_t>(n));
  }
  return buf;
}

void write_response(int fd, const std::string& content_type, const std::string& body) {
  std::string out = "HTTP/1.1 200 OK\r\nContent-Type: " + content_type +
                    "\r\nContent-Length: " + std::to_string(body.size()) +
                    "\r\nConnection: close\r\n\r\n" + body;
  size_t off = 0;
  while (off < out.size()) {
    ssize_t n = send(fd, out.data() + off, out.size() - off, 0);
    if (n <= 0) break;
    off += static_cast<size_t>(n);
  }
}

}  // namespace

int main() {
  const std::string sse_body =
      ": keepalive\n"
      "event: message\n"
      "data: {\"jsonrpc\":\"2.0\",\"method\":\"notifications/message\",\"params\":{\"level\":\"info\"}}\n"
      "\n"
      "event: message\n"
      "data: {\"jsonrpc\":\"2.0\",\"id\":\"ax-sse-1\",\"result\":{\"ok\":true,\"protocolVersion\":\"2025-11-25\"}}\n"
      "\n";

  int server_fd = socket(AF_INET, SOCK_STREAM, 0);
  if (server_fd < 0) {
    std::cerr << "socket failed\n";
    return 1;
  }
  int opt = 1;
  setsockopt(server_fd, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt));
  sockaddr_in addr{};
  addr.sin_family = AF_INET;
  addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
  addr.sin_port = 0;
  if (bind(server_fd, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) < 0) {
    std::cerr << "bind failed\n";
    return 1;
  }
  if (listen(server_fd, 4) < 0) {
    std::cerr << "listen failed\n";
    return 1;
  }
  socklen_t alen = sizeof(addr);
  getsockname(server_fd, reinterpret_cast<sockaddr*>(&addr), &alen);
  int port = ntohs(addr.sin_port);

  std::thread server([&]() {
    bool done = false;
    while (!done) {
      int fd = accept(server_fd, nullptr, nullptr);
      if (fd < 0) return;
      std::string request = drain_request(fd);
      if (request.find("server/discover") != std::string::npos) {
        write_response(fd, "application/json", "{\"jsonrpc\":\"2.0\",\"id\":1,\"error\":{\"code\":-32601,\"message\":\"Method not found\"}}");
      } else if (request.find("\"method\":\"initialize\"") != std::string::npos) {
        write_response(fd, "application/json", "{\"jsonrpc\":\"2.0\",\"id\":2,\"result\":{\"protocolVersion\":\"2025-11-25\",\"capabilities\":{},\"serverInfo\":{\"name\":\"legacy-loopback\",\"version\":\"1.0.0\"}}}");
      } else if (request.find("notifications/initialized") != std::string::npos || request.rfind("GET ", 0) == 0) {
        write_response(fd, "application/json", "");
      } else {
        std::string response = sse_body;
        size_t id = response.find("\"ax-sse-1\"");
        if (id != std::string::npos) response.replace(id, 10, "3");
        write_response(fd, "text/event-stream", response);
        done = true;
      }
      close(fd);
    }
  });

  auto transport = std::make_shared<axllm::AxMCPStreamableHTTPTransport>(
      std::string("http://127.0.0.1:") + std::to_string(port) + "/mcp",
      axllm::object({{"ssrfProtection", axllm::object({{"requireHttps", false}, {"allowLocalhost", true}, {"allowPrivateNetworks", true}})}}));
  axllm::AxMCPClient client(transport);
  client.init();
  if (client.get_era() != "legacy") {
    std::cerr << "auto discovery did not fall back to legacy\n";
    return 1;
  }
  axllm::Value result = client.call_tool("noop", axllm::Value::object());
  client.close();

  server.join();
  close(server_fd);

  if (!axllm::Core::truthy(axllm::Core::get(result, "ok"))) {
    std::cerr << "SSE result not decoded from text/event-stream body: " << axllm::stringify(result)
              << "\n";
    return 1;
  }
  std::cout << "mcp-sse-roundtrip-ok\n";
  return 0;
}
