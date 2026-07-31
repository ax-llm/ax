#include "mcp.hpp"

#include <curl/curl.h>
#include <cstdlib>
#include <iostream>
#include <map>

using namespace axllm;

static size_t append(char* data, size_t size, size_t count, void* output) {
  static_cast<std::string*>(output)->append(data, size * count);
  return size * count;
}

static Value authorize(const std::string& url) {
  CURL* curl = curl_easy_init();
  if (!curl) throw std::runtime_error("curl initialization failed");
  std::string body;
  curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
  curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, append);
  curl_easy_setopt(curl, CURLOPT_WRITEDATA, &body);
  CURLcode result = curl_easy_perform(curl);
  curl_easy_cleanup(curl);
  if (result != CURLE_OK) throw std::runtime_error(curl_easy_strerror(result));
  return Core::json_parse(body);
}

int main() {
  const char* endpoint = std::getenv("AX_MCP_ENDPOINT");
  if (!endpoint) throw std::runtime_error("AX_MCP_ENDPOINT is required");
  std::string expected_error = std::getenv("AX_MCP_EXPECT_ERROR") ? std::getenv("AX_MCP_EXPECT_ERROR") : "";
  Value protection = object({{"requireHttps", false}, {"allowLocalhost", true}, {"allowPrivateNetworks", true}});
  AxMCPStreamableHTTPTransport transport(endpoint, object({{"ssrfProtection", protection}}));
  std::map<std::string, Value> tokens;
  transport.oauth.clientId = "ax-port-client";
  transport.oauth.redirectUri = "http://localhost:8787/callback";
  transport.oauth.scopes = {"mcp:read"};
  transport.oauth.requireIss = true;
  transport.oauth.ssrfProtection = protection;
  transport.oauth.onAuthCode = authorize;
  transport.oauth.getToken = [&](const std::string& key) { auto item = tokens.find(key); return item == tokens.end() ? Value() : item->second; };
  transport.oauth.setToken = [&](const std::string& key, Value token) { tokens[key] = std::move(token); };
  transport.oauth.clearToken = [&](const std::string& key) { tokens.erase(key); };
  try {
    transport.send(object({{"jsonrpc", "2.0"}, {"id", 1}, {"method", "initialize"}, {"params", Value::object()}}));
    transport.send(object({{"jsonrpc", "2.0"}, {"id", 2}, {"method", "tools/list"}, {"params", Value::object()}}));
    if (!expected_error.empty()) throw std::runtime_error("expected " + expected_error + " error");
    std::cout << "AX_MCP_OAUTH_OK" << std::endl;
  } catch (const std::exception& error) {
    std::string message = error.what();
    if (!expected_error.empty() && message.find(expected_error) != std::string::npos) {
      std::cout << "AX_MCP_OAUTH_EXPECTED_ERROR" << std::endl;
    } else throw;
  }
}
