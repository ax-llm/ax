#include "axllm/axllm.hpp"

#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>

#include <atomic>
#include <chrono>
#include <csignal>
#include <functional>
#include <iostream>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>

// Time requests out through the REAL libcurl HttpTransport against in-process
// loopback servers. A call's timeout (TypeScript's per-call timeout, in
// milliseconds) ends a chat or a stream whose response has not started, and
// the request layer does not retry it. A stream whose response has started
// runs past it, because the timer stops at the response headers, as in
// TypeScript's apiCall. Returns non-zero on any mismatch so axir verify fails
// if it regresses. Requires libcurl (AXLLM_ENABLE_CURL); axir verify skips it
// when libcurl is unavailable.

namespace {

int listen_loopback() {
  int fd = socket(AF_INET, SOCK_STREAM, 0);
  if (fd < 0) throw std::runtime_error("socket failed");
  sockaddr_in address{};
  address.sin_family = AF_INET;
  address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
  if (bind(fd, reinterpret_cast<sockaddr*>(&address), sizeof(address)) < 0 || listen(fd, 16) < 0)
    throw std::runtime_error("listen failed");
  return fd;
}

int port_of(int fd) {
  sockaddr_in address{};
  socklen_t size = sizeof(address);
  getsockname(fd, reinterpret_cast<sockaddr*>(&address), &size);
  return ntohs(address.sin_port);
}

// Read the request headers and its Content-Length body.
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
        std::string lower = buf.substr(0, pos);
        for (char& c : lower) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        size_t at = lower.find("content-length:");
        if (at != std::string::npos) content_length = std::stoul(lower.substr(at + 15));
      }
    }
    if (header_end != std::string::npos && buf.size() >= header_end + content_length) break;
    ssize_t n = recv(fd, tmp, sizeof(tmp), 0);
    if (n <= 0) break;
    buf.append(tmp, static_cast<size_t>(n));
  }
}

void send_all(int fd, const std::string& text) {
  size_t offset = 0;
  while (offset < text.size()) {
    ssize_t n = send(fd, text.data() + offset, text.size() - offset, 0);
    if (n <= 0) break;
    offset += static_cast<size_t>(n);
  }
}

std::string event(const std::string& content, const std::string& finish) {
  return "{\"id\":\"chatcmpl_slow\",\"model\":\"gpt-5.4-mini\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"" + content + "\"},\"finish_reason\":" + finish + "}]}";
}

void expect_timeout(const std::string& label, const std::function<void()>& run) {
  auto started = std::chrono::steady_clock::now();
  try {
    run();
  } catch (const axllm::AxError& error) {
    if (error.type != "AxAIServiceTimeoutError" || std::string(error.what()).find("Request timed out after 200ms") == std::string::npos)
      throw std::runtime_error(label + ": " + error.type + ": " + error.what());
    if (std::chrono::steady_clock::now() - started >= std::chrono::seconds(5)) throw std::runtime_error(label + ": timed out too late");
    return;
  }
  throw std::runtime_error(label + ": the request did not time out");
}

}  // namespace

int main() {
  ::signal(SIGPIPE, SIG_IGN);
  using namespace axllm;
  // A server that accepts connections and never answers.
  int silent = listen_loopback();
  std::atomic<int> accepted{0};
  std::thread([silent, &accepted] {
    std::vector<int> held;
    while (true) {
      int fd = accept(silent, nullptr, nullptr);
      if (fd < 0) return;
      accepted.fetch_add(1);
      held.push_back(fd);
    }
  }).detach();
  Value request = object({{"chat_prompt", array({object({{"role", "user"}, {"content", "hi"}})})}});
  OpenAICompatibleClient client(
      object({{"api_key", "test-key"}, {"base_url", "http://127.0.0.1:" + std::to_string(port_of(silent))}, {"model", "gpt-5.4-mini"}}),
      nullptr);
  expect_timeout("chat", [&] { client.chat(request, object({{"timeout", 200}})); });
  expect_timeout("stream", [&] { client.stream(request, object({{"timeout", 200}})); });
  if (accepted.load() != 2) throw std::runtime_error("a timed-out request was retried: " + std::to_string(accepted.load()) + " connections");

  // A stream whose headers arrive at once and whose second event comes after
  // more than the timeout.
  int slow = listen_loopback();
  std::thread server([slow] {
    int fd = accept(slow, nullptr, nullptr);
    if (fd < 0) return;
    drain_request(fd);
    send_all(fd, "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n");
    send_all(fd, "data: " + event("Hel", "null") + "\n\n");
    std::this_thread::sleep_for(std::chrono::milliseconds(1500));
    send_all(fd, "data: " + event("lo", "\"stop\"") + "\n\ndata: [DONE]\n\n");
    close(fd);
  });
  OpenAICompatibleClient slow_client(
      object({{"api_key", "test-key"}, {"base_url", "http://127.0.0.1:" + std::to_string(port_of(slow))}, {"model", "gpt-5.4-mini"}}),
      nullptr);
  std::string text;
  for (const auto& event : slow_client.stream(request, object({{"timeout", 1000}}))) {
    text += display(Core::get(Core::get(Core::get(event, "results"), 0), "content", ""));
  }
  server.join();
  close(slow);
  close(silent);
  if (text != "Hello") {
    std::cerr << "a started stream was cut off: " << text << "\n";
    return 1;
  }
  std::cout << "timeout-http-roundtrip-ok\n";
  return 0;
}
