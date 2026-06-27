#include "axllm/axllm.hpp"

#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>

#include <iostream>
#include <string>
#include <thread>
#include <vector>

// Drive a streaming stream() through the REAL libcurl HttpTransport against an
// in-process loopback server that returns a spec-legal text/event-stream body
// with a MULTI-LINE data: event and CRLF line endings. The conformance
// ScriptedTransport only ever feeds single-line data: JSON, so this is the only
// end-to-end coverage for the SSE line-folding that src/ax/util/sse.ts performs.
// Returns non-zero on any mismatch so axir verify fails if the folding
// regresses. Requires libcurl (AXLLM_ENABLE_CURL); axir verify skips it when
// libcurl is unavailable.

namespace {

// Read the full request (headers + Content-Length body) so libcurl can then
// read the response without the connection being reset mid-write.
void drain_request(int fd) {
  std::string buf;
  char tmp[4096];
  size_t header_end = std::string::npos;
  size_t content_length = 0;
  while (true) {
    if (header_end == std::string::npos) {
      size_t pos = buf.find("\r\n\r\n");
      if (pos != std::string::npos) {
        header_end = pos + 4;
        std::string headers = buf.substr(0, pos);
        size_t start = 0;
        while (start < headers.size()) {
          size_t next = headers.find("\r\n", start);
          std::string line =
              headers.substr(start, (next == std::string::npos ? headers.size() : next) - start);
          std::string lower = line;
          for (char& c : lower) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
          if (lower.rfind("content-length:", 0) == 0) {
            content_length = std::stoul(line.substr(line.find(':') + 1));
          }
          if (next == std::string::npos) break;
          start = next + 2;
        }
      }
    }
    if (header_end != std::string::npos && buf.size() >= header_end + content_length) break;
    ssize_t n = recv(fd, tmp, sizeof(tmp), 0);
    if (n <= 0) break;
    buf.append(tmp, static_cast<size_t>(n));
  }
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
  // One logical delta whose JSON is split across two data: lines (folded with
  // "\n"), then a single-line delta, then [DONE]. Every line uses CRLF.
  const std::string event1a =
      "{\"id\":\"chatcmpl_stream\",\"model\":\"gpt-5.4-mini\",\"choices\":[{\"index\":0,\"delta\":";
  const std::string event1b = "{\"content\":\"Hello \"}}]}";
  const std::string event2 =
      "{\"id\":\"chatcmpl_stream\",\"model\":\"gpt-5.4-mini\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"world\"},\"finish_reason\":\"stop\"}]}";
  const std::string sse_body = "data: " + event1a + "\r\n" + "data: " + event1b + "\r\n" + "\r\n" +
                               "data: " + event2 + "\r\n" + "\r\n" + "data: [DONE]\r\n" + "\r\n";

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
    int fd = accept(server_fd, nullptr, nullptr);
    if (fd < 0) return;
    drain_request(fd);
    write_response(fd, "text/event-stream", sse_body);
    close(fd);
  });

  axllm::OpenAICompatibleClient client(
      axllm::object({{"api_key", "test-key"},
                     {"base_url", std::string("http://127.0.0.1:") + std::to_string(port)},
                     {"model", "gpt-5.4-mini"}}),
      nullptr);
  std::vector<std::string> deltas;
  for (const auto& event : client.stream(axllm::object(
           {{"chat_prompt",
             axllm::array({axllm::object({{"role", "user"}, {"content", "stream"}})})}}))) {
    std::string content = axllm::display(
        axllm::Core::get(axllm::Core::get(axllm::Core::get(event, "results"), 0), "content", ""));
    if (!content.empty()) deltas.push_back(content);
  }

  server.join();
  close(server_fd);

  if (deltas.empty() || deltas.front() != "Hello ") {
    std::cerr << "multi-line data: event was not folded into one JSON value\n";
    return 1;
  }
  std::string text;
  for (const auto& d : deltas) text += d;
  if (text != "Hello world") {
    std::cerr << "bad stream fold: " << text << "\n";
    return 1;
  }
  std::cout << "stream-http-roundtrip-ok\n";
  return 0;
}
