#include "axllm/axllm.hpp"

#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>

#include <cctype>
#include <cstring>
#include <iostream>
#include <string>
#include <thread>

// Drive transcribe()/speak() through the REAL libcurl HttpTransport against an
// in-process loopback server, exercising the wire-level encoders the conformance
// ScriptedTransport bypasses: the multipart/form-data request body (transcribe)
// and binary (non-UTF8) response handling (speak). Returns non-zero on any
// mismatch so axir verify fails if either regresses. Requires libcurl
// (AXLLM_ENABLE_CURL); axir verify skips it when libcurl is unavailable.

namespace {

struct Request {
  std::string line;
  std::string content_type;
  std::string body;
};

Request read_request(int fd) {
  Request req;
  std::string buf;
  char tmp[4096];
  size_t header_end = 0;
  while (true) {
    size_t pos = buf.find("\r\n\r\n");
    if (pos != std::string::npos) {
      header_end = pos + 4;
      break;
    }
    ssize_t n = recv(fd, tmp, sizeof(tmp), 0);
    if (n <= 0) {
      header_end = buf.size();
      break;
    }
    buf.append(tmp, static_cast<size_t>(n));
  }
  std::string headers = buf.substr(0, header_end);
  size_t eol = headers.find("\r\n");
  req.line = headers.substr(0, eol == std::string::npos ? headers.size() : eol);
  size_t content_length = 0;
  size_t start = (eol == std::string::npos) ? headers.size() : eol + 2;
  while (start < headers.size()) {
    size_t next = headers.find("\r\n", start);
    std::string line =
        headers.substr(start, (next == std::string::npos ? headers.size() : next) - start);
    std::string lower = line;
    for (char& c : lower) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    if (lower.rfind("content-type:", 0) == 0) {
      req.content_type = line.substr(line.find(':') + 1);
      while (!req.content_type.empty() && req.content_type.front() == ' ') {
        req.content_type.erase(req.content_type.begin());
      }
    } else if (lower.rfind("content-length:", 0) == 0) {
      content_length = std::stoul(line.substr(line.find(':') + 1));
    }
    if (next == std::string::npos) break;
    start = next + 2;
  }
  req.body = buf.substr(header_end);
  while (req.body.size() < content_length) {
    ssize_t n = recv(fd, tmp, sizeof(tmp), 0);
    if (n <= 0) break;
    req.body.append(tmp, static_cast<size_t>(n));
  }
  return req;
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
  // Deliberately non-UTF8 bytes so a UTF-8/JSON decode regression corrupts them.
  const char audio_raw[] = {0x00, 0x01, 0x02, static_cast<char>(0xff),
                            static_cast<char>(0xfe), 0x10, 0x7f};
  const std::string audio_bytes(audio_raw, sizeof(audio_raw));
  const std::string audio_b64 = "AAEC//4Qfw==";
  const char speech_raw[] = {static_cast<char>(0xff), static_cast<char>(0xd8),
                             static_cast<char>(0xff), 0x00, 0x11, 0x22, static_cast<char>(0xfe)};
  const std::string speech_bytes(speech_raw, sizeof(speech_raw));
  const std::string want_audio = "/9j/ABEi/g==";

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

  bool saw_multipart = false;
  bool file_present = false;
  std::thread server([&]() {
    for (int handled = 0; handled < 2; ++handled) {
      int fd = accept(server_fd, nullptr, nullptr);
      if (fd < 0) break;
      Request req = read_request(fd);
      if (req.line.find("/audio/transcriptions") != std::string::npos) {
        saw_multipart = req.content_type.rfind("multipart/form-data; boundary=", 0) == 0;
        file_present = req.body.find(audio_bytes) != std::string::npos;
        write_response(fd, "application/json",
                       "{\"text\":\"hello world\",\"language\":\"en\",\"duration\":1.25}");
      } else if (req.line.find("/audio/speech") != std::string::npos) {
        write_response(fd, "audio/mpeg", speech_bytes);
      } else {
        write_response(fd, "text/plain", "");
      }
      close(fd);
    }
  });

  axllm::OpenAIResponsesClient client(
      axllm::object({{"api_key", "test-key"},
                     {"base_url", std::string("http://127.0.0.1:") + std::to_string(port)}}),
      nullptr);
  axllm::Value transcript = client.transcribe(axllm::object({{"audio", audio_b64},
                                                             {"language", "en"},
                                                             {"model", "gpt-4o-mini-transcribe"},
                                                             {"format", "json"}}));
  axllm::Value speech = client.speak(axllm::object(
      {{"text", "hello"}, {"voice", "alloy"}, {"format", "mp3"}, {"model", "gpt-4o-mini-tts"}}));

  server.join();
  close(server_fd);

  if (!saw_multipart) {
    std::cerr << "loopback server never received a multipart transcribe request\n";
    return 1;
  }
  if (!file_present) {
    std::cerr << "multipart body did not contain the decoded file bytes\n";
    return 1;
  }
  if (!axllm::equal(axllm::Core::get(transcript, "text"), "hello world")) {
    std::cerr << "transcribe response not normalized: " << axllm::stringify(transcript) << "\n";
    return 1;
  }
  if (!axllm::equal(axllm::Core::get(speech, "audio"), want_audio)) {
    std::cerr << "speak binary response not base64-encoded as expected: "
              << axllm::stringify(speech) << "\n";
    return 1;
  }
  std::cout << "audio-http-roundtrip-ok\n";
  return 0;
}
