#pragma once

#include "axllm.hpp"

#include <memory>
#include <string>
#include <vector>

namespace axllm {

inline const char* AX_MCP_PROTOCOL_VERSION = "2025-11-25";

struct AxMCPTokenSet {
  std::string accessToken;
  std::string refreshToken;
  long expiresAt = 0;
  std::string issuer;
};

struct AxMCPOAuthOptions {
  std::string clientId;
  std::string clientSecret;
  std::string redirectUri;
  std::vector<std::string> scopes;
  std::function<Value(const std::string&)> onAuthCode;
  std::function<Value(const std::string&)> getToken;
  std::function<void(const std::string&, Value)> setToken;
  Value ssrfProtection = Value::object();
};

class AxMCPTransport {
 public:
  virtual ~AxMCPTransport() = default;
  virtual Value send(Value message) = 0;
  virtual void send_notification(Value message) = 0;
  virtual void send_response(Value message) { send_notification(std::move(message)); }
  virtual void set_protocol_version(const std::string&) {}
  virtual void connect() {}
};

class AxMCPClient {
 public:
  AxMCPClient(std::shared_ptr<AxMCPTransport> transport, Value options = Value::object());
  void init();
  void refresh();
  std::string protocol_version() const;
  Value ping();
  Value list_tools(const std::string& cursor = "");
  Value call_tool(const std::string& name, Value arguments = Value::object());
  Value list_prompts(const std::string& cursor = "");
  Value get_prompt(const std::string& name, Value arguments = Value::object());
  Value list_resources(const std::string& cursor = "");
  Value read_resource(const std::string& uri);
  Value list_resource_templates(const std::string& cursor = "");
  void notify(const std::string& method, Value params = Value());
  void cancel_request(Value request_id, const std::string& reason = "");
  std::vector<Tool> to_function();

 private:
  std::shared_ptr<AxMCPTransport> transport_;
  Value options_;
  Value server_capabilities_ = Value::object();
  std::string negotiated_protocol_version_;
  std::vector<Value> tools_;
  std::vector<Value> prompts_;
  std::vector<Value> resources_;
  std::vector<Value> resource_templates_;
  int next_id_ = 1;

  Value request(const std::string& method, Value params = Value::object());
  bool capability(const std::string& name) const;
  Tool tool_to_function(Value spec);
  Tool prompt_to_function(Value spec);
  Tool resource_to_function(Value spec);
  Tool resource_template_to_function(Value spec);
};

class AxMCPStreamableHTTPTransport : public AxMCPTransport {
 public:
  explicit AxMCPStreamableHTTPTransport(std::string endpoint, Value options = Value::object());
  Value send(Value message) override;
  void send_notification(Value message) override;
  void set_protocol_version(const std::string& protocol_version) override;
  void set_session_id(std::string session_id);
  Value build_headers(Value base = Value::object(), bool include_protocol = true) const;
  bool apply_oauth();
  AxMCPOAuthOptions oauth;

 private:
  std::string endpoint_;
  Value options_;
  Value headers_ = Value::object();
  std::string session_id_;
  std::string protocol_version_;
  HttpTransport http_;
};

class AxMCPStdioTransport : public AxMCPTransport {
 public:
  AxMCPStdioTransport(std::string command, std::vector<std::string> args = {});
  Value send(Value message) override;
  void send_notification(Value message) override;
};

class AxMCPScriptedTransport : public AxMCPTransport {
 public:
  explicit AxMCPScriptedTransport(Value responses = Value::array());
  Value send(Value message) override;
  void send_notification(Value message) override;
  void send_response(Value message) override;
  void set_protocol_version(const std::string& protocol_version) override;
  std::vector<Value> requests;
  std::vector<Value> notifications;
  std::vector<Value> sent_responses;

 private:
  std::vector<Value> responses_;
  std::string protocol_version_;
};

std::string ax_mcp_stdio_encode(Value message);
Value ax_mcp_stdio_decode(const std::string& line);
std::string ax_mcp_pkce_verifier();
std::string ax_mcp_pkce_challenge(const std::string& verifier);
std::string ax_mcp_validate_endpoint(const std::string& endpoint, Value options = Value::object());
void run_mcp_conformance_fixture(Value fixture);

}  // namespace axllm
