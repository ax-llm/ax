#include "axllm/axllm.hpp"

#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>

#include <atomic>
#include <cctype>
#include <chrono>
#include <csignal>
#include <cstdio>
#include <functional>
#include <iostream>
#include <memory>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>

// Send requests through the REAL libcurl HttpTransport to in-process loopback
// servers that fail the way networks do, and check that the failures surface
// as TypeScript's apiCall reports fetch's: a refused or dropped connection is
// AxAIServiceNetworkError ("Network Error: ..."), which a stream's request
// layer retries under the call's retry options; a timeout is
// AxAIServiceTimeoutError ("Request timed out after <ms>ms", the client's
// timeout in milliseconds), which the request layer never retries; and AxGen
// retries both as infrastructure errors. Returns non-zero on any mismatch so
// axir verify fails if it regresses. Requires libcurl (AXLLM_ENABLE_CURL);
// axir verify skips it when libcurl is unavailable.

namespace {

const std::string kDropEvent =
    "data: {\"id\":\"chatcmpl_drop\",\"object\":\"chat.completion.chunk\",\"created\":0,\"model\":\"gpt-5.4-mini\","
    "\"choices\":[{\"index\":0,\"delta\":{\"content\":\"Hel\"},\"finish_reason\":null}]}\n\n";

int listen_loopback(int* port) {
  int fd = socket(AF_INET, SOCK_STREAM, 0);
  if (fd < 0) throw std::runtime_error("socket failed");
  sockaddr_in address{};
  address.sin_family = AF_INET;
  address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
  if (bind(fd, reinterpret_cast<sockaddr*>(&address), sizeof(address)) < 0 || listen(fd, 16) < 0)
    throw std::runtime_error("listen failed");
  socklen_t size = sizeof(address);
  getsockname(fd, reinterpret_cast<sockaddr*>(&address), &size);
  *port = ntohs(address.sin_port);
  return fd;
}

// A loopback port nothing listens on.
int closed_port() {
  int port = 0;
  close(listen_loopback(&port));
  return port;
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

// Accept connections and count them: "close" closes each one without a
// response, "drop" sends one stream event and drops it, "hold" never answers.
std::shared_ptr<std::atomic<int>> serve(const std::string& mode, int* port) {
  int listener = listen_loopback(port);
  auto connections = std::make_shared<std::atomic<int>>(0);
  std::thread([listener, mode, connections] {
    std::vector<int> held;
    while (true) {
      int fd = accept(listener, nullptr, nullptr);
      if (fd < 0) return;
      connections->fetch_add(1);
      if (mode == "hold") {
        held.push_back(fd);
        continue;
      }
      drain_request(fd);
      if (mode == "drop") {
        char size[16];
        std::snprintf(size, sizeof(size), "%zx", kDropEvent.size());
        std::string response = std::string("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\n\r\n") + size + "\r\n" + kDropEvent + "\r\n";
        (void)send(fd, response.data(), response.size(), 0);
        std::this_thread::sleep_for(std::chrono::milliseconds(50));
      }
      close(fd);
    }
  }).detach();
  return connections;
}

std::unique_ptr<axllm::OpenAICompatibleClient> client(int port, axllm::Value options = axllm::Value::object()) {
  axllm::Value config = axllm::object({{"api_key", "test-key"}, {"base_url", "http://127.0.0.1:" + std::to_string(port)}, {"model", "gpt-5.4-mini"}});
  for (const char* key : {"timeout", "retry"}) {
    if (!axllm::Core::get(options, key).is_null()) axllm::Core::set(config, key, axllm::Core::get(options, key));
  }
  return std::make_unique<axllm::OpenAICompatibleClient>(config, nullptr);
}

// The error, or an error it wraps, must be of the Ax error type with a
// message that starts with prefix.
void expect(const std::string& label, const std::string& type, const std::string& prefix, const std::function<void()>& run) {
  try {
    run();
  } catch (const axllm::AxError& error) {
    for (const axllm::AxError* current = &error; current != nullptr; current = current->cause()) {
      if (current->type == type) {
        if (std::string(current->what()).rfind(prefix, 0) != 0) throw std::runtime_error(label + ": " + current->what() + " does not start with " + prefix);
        return;
      }
    }
    throw std::runtime_error(label + ": want " + type + ", got " + error.type + ": " + error.what());
  }
  throw std::runtime_error(label + ": no error");
}

void expect_count(const std::string& label, int got, int want) {
  if (got != want) throw std::runtime_error(label + ": " + std::to_string(got) + " requests, want " + std::to_string(want));
}

}  // namespace

int main() {
  ::signal(SIGPIPE, SIG_IGN);
  using namespace axllm;
  Value request = object({{"chat_prompt", array({object({{"role", "user"}, {"content", "hi"}})})}});
  Value fast_retry = object({{"maxRetries", 2}, {"initialDelayMs", 10}, {"maxDelayMs", 20}});
  auto ignore = [](const Value&) { return true; };

  // A refused connection.
  int refused = closed_port();
  expect("refused chat", "AxAIServiceNetworkError", "Network Error: ", [&] { client(refused)->chat(request, object({{"stream", false}})); });
  expect("refused stream", "AxAIServiceNetworkError", "Network Error: ", [&] { client(refused)->stream_each(request, ignore, object({{"retry", fast_retry}})); });

  // A server that closes each connection without a response. The stream's
  // request layer retries it under the call's retry options: the first
  // request and two retries.
  int closing = 0;
  auto closed = serve("close", &closing);
  expect("closed chat", "AxAIServiceNetworkError", "Network Error: ", [&] { client(closing)->chat(request, object({{"stream", false}})); });
  int before = closed->load();
  expect("closed stream", "AxAIServiceNetworkError", "Network Error: ", [&] { client(closing)->stream_each(request, ignore, object({{"retry", fast_retry}})); });
  expect_count("closed stream", closed->load() - before, 3);

  // The client's own timeout (seconds) ends a chat or a stream whose response
  // has not started, in TS's words, and the request layer does not retry it.
  int silent = 0;
  auto held = serve("hold", &silent);
  before = held->load();
  expect("timed-out chat", "AxAIServiceTimeoutError", "Request timed out after 300ms", [&] { client(silent, object({{"timeout", 0.3}}))->chat(request, object({{"stream", false}})); });
  expect("timed-out stream", "AxAIServiceTimeoutError", "Request timed out after 300ms", [&] { client(silent, object({{"timeout", 0.3}}))->stream_each(request, ignore, object({{"retry", fast_retry}})); });
  expect_count("timed-out requests", held->load() - before, 2);

  // A server that sends one event and drops the connection: the stream ends
  // in an infrastructure error after the event, and is not retried.
  int dropping = 0;
  auto dropped = serve("drop", &dropping);
  int delivered = 0;
  expect("dropped stream", "AxAIServiceStreamTerminatedError", "", [&] {
    client(dropping)->stream_each(request, [&delivered](const Value&) { delivered++; return true; }, object({{"retry", fast_retry}}));
  });
  expect_count("dropped stream events", delivered, 1);
  expect_count("dropped stream", dropped->load(), 1);

  // The Typesafe client types the same failures, and does not retry a timeout.
  expect("Typesafe refused", "AxAIServiceNetworkError", "Network Error: ", [&] {
    typesafe(object({{"api_key", "test-key"}, {"base_url", "http://127.0.0.1:" + std::to_string(closed_port())}, {"retry", fast_retry}})).list_models();
  });
  before = held->load();
  expect("Typesafe timeout", "AxAIServiceTimeoutError", "Request timed out after 300ms", [&] {
    typesafe(object({{"api_key", "test-key"}, {"base_url", "http://127.0.0.1:" + std::to_string(silent)}, {"timeout", 0.3}, {"retry", fast_retry}})).list_models();
  });
  expect_count("Typesafe timeout", held->load() - before, 1);

  // AxGen retries a network error and a timeout as infrastructure errors. The
  // client's own retries are off, so each request is one AxGen attempt:
  // maxRetries 1 is the first attempt and one retry.
  Value no_request_retry = object({{"retry", object({{"maxRetries", 0}})}});
  for (bool stream : {false, true}) {
    std::string mode = stream ? " (stream)" : "";
    before = closed->load();
    expect("AxGen network" + mode, "AxAIServiceNetworkError", "Network Error: ", [&] {
      ax("question:string -> answer:string").forward(*client(closing, no_request_retry), object({{"question", "hi"}}), object({{"maxRetries", 1}, {"stream", stream}}));
    });
    expect_count("AxGen network" + mode, closed->load() - before, 2);
    before = held->load();
    expect("AxGen timeout" + mode, "AxAIServiceTimeoutError", "Request timed out after 200ms", [&] {
      ax("question:string -> answer:string").forward(*client(silent, no_request_retry), object({{"question", "hi"}}), object({{"maxRetries", 1}, {"stream", stream}, {"timeoutMs", 200}}));
    });
    expect_count("AxGen timeout" + mode, held->load() - before, 2);
  }
  std::cout << "transport-errors-http-roundtrip-ok" << std::endl;
  std::_Exit(0);
}
