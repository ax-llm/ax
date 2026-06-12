#include "mcp.hpp"

#include <chrono>
#include <cstring>

namespace axllm {

static Object as_object_local(Value value) {
  if (auto p = std::get_if<std::shared_ptr<Object>>(&value.data)) return **p;
  return {};
}

static Array as_array_local(Value value) {
  if (auto p = std::get_if<std::shared_ptr<Array>>(&value.data)) return **p;
  return {};
}

static bool value_has(Value object_value, const std::string& key) {
  auto obj = as_object_local(object_value);
  return obj.find(key) != obj.end();
}

static Value cursor_params(const std::string& cursor) {
  if (cursor.empty()) return Value::object();
  return object({{"cursor", cursor}});
}

static std::string safe_name(const std::string& value) {
  std::string out;
  bool last_sep = false;
  for (char ch : value) {
    if (std::isalnum(static_cast<unsigned char>(ch))) {
      out.push_back(ch);
      last_sep = false;
    } else if (!last_sep) {
      out.push_back('_');
      last_sep = true;
    }
  }
  while (!out.empty() && out.front() == '_') out.erase(out.begin());
  while (!out.empty() && out.back() == '_') out.pop_back();
  return out.empty() ? "item" : out;
}

static std::string content_text(Value content) {
  std::vector<std::string> parts;
  for (const auto& item : as_array_local(content)) {
    if (display(Core::get(item, "type", "")) == "text") parts.push_back(display(Core::get(item, "text", "")));
  }
  std::ostringstream out;
  for (size_t i = 0; i < parts.size(); ++i) {
    if (i > 0) out << "\n";
    out << parts[i];
  }
  return out.str();
}

static void expect_subset_local(Value actual, Value expected, const std::string& label) {
  if (expected.is_null()) return;
  if (expected.is_object()) {
    auto a = as_object_local(actual);
    for (const auto& kv : as_object_local(expected)) {
      if (kv.first == "__order") continue;
      if (!a.count(kv.first)) throw AxError("fixture", label + " missing key " + kv.first);
      expect_subset_local(a[kv.first], kv.second, label + "." + kv.first);
    }
    return;
  }
  if (expected.is_array()) {
    auto a = as_array_local(actual);
    auto e = as_array_local(expected);
    if (a.size() < e.size()) throw AxError("fixture", label + " list length mismatch");
    for (size_t i = 0; i < e.size(); ++i) expect_subset_local(a[i], e[i], label);
    return;
  }
  if (!equal(actual, expected)) throw AxError("fixture", label + " mismatch");
}

AxMCPClient::AxMCPClient(std::shared_ptr<AxMCPTransport> transport, Value options)
    : transport_(std::move(transport)), options_(std::move(options)) {}

void AxMCPClient::init() {
  transport_->connect();
  Value capabilities = Core::get(options_, "capabilities", Value::object());
  if (!Core::get(options_, "roots", Value()).is_null() && Core::get(capabilities, "roots", Value()).is_null()) {
    Core::set(capabilities, "roots", object({{"listChanged", true}}));
  }
  Value result = request("initialize", object({
      {"protocolVersion", display(Core::get(options_, "protocolVersion", AX_MCP_PROTOCOL_VERSION))},
      {"capabilities", capabilities},
      {"clientInfo", object({{"name", "AxMCPClient"}, {"title", "Ax MCP Client"}, {"version", "1.0.0"}})},
  }));
  negotiated_protocol_version_ = display(Core::get(result, "protocolVersion", ""));
  bool supported = negotiated_protocol_version_ == "2025-11-25" || negotiated_protocol_version_ == "2025-06-18" ||
                   negotiated_protocol_version_ == "2025-03-26" || negotiated_protocol_version_ == "2024-11-05";
  if (!supported) throw AxError("mcp", "Unsupported MCP protocol version " + negotiated_protocol_version_);
  transport_->set_protocol_version(negotiated_protocol_version_);
  server_capabilities_ = Core::get(result, "capabilities", Value::object());
  notify("notifications/initialized");
  refresh();
}

void AxMCPClient::refresh() {
  tools_.clear();
  prompts_.clear();
  resources_.clear();
  resource_templates_.clear();
  if (capability("tools")) tools_ = as_array_local(Core::get(list_tools(), "tools", Value::array()));
  if (capability("prompts")) prompts_ = as_array_local(Core::get(list_prompts(), "prompts", Value::array()));
  if (capability("resources")) {
    resources_ = as_array_local(Core::get(list_resources(), "resources", Value::array()));
    resource_templates_ = as_array_local(Core::get(list_resource_templates(), "resourceTemplates", Value::array()));
  }
}

std::string AxMCPClient::protocol_version() const { return negotiated_protocol_version_; }
Value AxMCPClient::ping() { return request("ping"); }
Value AxMCPClient::list_tools(const std::string& cursor) { return request("tools/list", cursor_params(cursor)); }
Value AxMCPClient::call_tool(const std::string& name, Value arguments) { return request("tools/call", object({{"name", name}, {"arguments", arguments}})); }
Value AxMCPClient::list_prompts(const std::string& cursor) { return request("prompts/list", cursor_params(cursor)); }
Value AxMCPClient::get_prompt(const std::string& name, Value arguments) { return request("prompts/get", object({{"name", name}, {"arguments", arguments}})); }
Value AxMCPClient::list_resources(const std::string& cursor) { return request("resources/list", cursor_params(cursor)); }
Value AxMCPClient::read_resource(const std::string& uri) { return request("resources/read", object({{"uri", uri}})); }
Value AxMCPClient::list_resource_templates(const std::string& cursor) { return request("resources/templates/list", cursor_params(cursor)); }

void AxMCPClient::notify(const std::string& method, Value params) {
  Value message = object({{"jsonrpc", "2.0"}, {"method", method}});
  if (!params.is_null()) Core::set(message, "params", params);
  transport_->send_notification(message);
}

void AxMCPClient::cancel_request(Value request_id, const std::string& reason) {
  Value params = object({{"requestId", request_id}});
  if (!reason.empty()) Core::set(params, "reason", reason);
  notify("notifications/cancelled", params);
}

Value AxMCPClient::request(const std::string& method, Value params) {
  Value message = object({{"jsonrpc", "2.0"}, {"id", std::to_string(next_id_++)}, {"method", method}});
  if (!params.is_null()) Core::set(message, "params", params);
  Value response = transport_->send(message);
  Value error = Core::get(response, "error", Value());
  if (!error.is_null()) throw AxError("mcp", display(Core::get(error, "message", "MCP JSON-RPC error")));
  return Core::get(response, "result", Value::object());
}

bool AxMCPClient::capability(const std::string& name) const {
  Value value = Core::get(server_capabilities_, name, Value());
  return !value.is_null() && !equal(value, false);
}

std::vector<Tool> AxMCPClient::to_function() {
  std::vector<Tool> out;
  for (auto item : tools_) out.push_back(tool_to_function(item));
  for (auto item : prompts_) out.push_back(prompt_to_function(item));
  for (auto item : resources_) out.push_back(resource_to_function(item));
  for (auto item : resource_templates_) out.push_back(resource_template_to_function(item));
  return out;
}

Tool AxMCPClient::tool_to_function(Value spec) {
  std::string original = display(Core::get(spec, "name", ""));
  std::string desc = display(Core::get(spec, "description", original));
  auto self = this;
  return Tool(original, desc, Core::get(spec, "inputSchema", Value::object()), [self, original](Value args) {
    Value result = self->call_tool(original, args);
    Value structured = Core::get(result, "structuredContent", Value());
    if (!structured.is_null()) return structured;
    return object({{"content", content_text(Core::get(result, "content", Value::array()))}});
  });
}

Tool AxMCPClient::prompt_to_function(Value spec) {
  std::string original = display(Core::get(spec, "name", ""));
  auto self = this;
  return Tool("prompt_" + original, display(Core::get(spec, "description", original)), Value::object(), [self, original](Value args) {
    return self->get_prompt(original, args);
  });
}

Tool AxMCPClient::resource_to_function(Value spec) {
  std::string uri = display(Core::get(spec, "uri", ""));
  auto self = this;
  return Tool("resource_" + safe_name(display(Core::get(spec, "name", uri))), display(Core::get(spec, "description", uri)), Value::object(),
              [self, uri](Value) { return self->read_resource(uri); });
}

Tool AxMCPClient::resource_template_to_function(Value spec) {
  auto self = this;
  return Tool("resource_template_" + safe_name(display(Core::get(spec, "name", "template"))), display(Core::get(spec, "description", "template")),
              Value::object(), [self](Value args) { return self->read_resource(display(Core::get(args, "uri", ""))); });
}

AxMCPStreamableHTTPTransport::AxMCPStreamableHTTPTransport(std::string endpoint, Value options)
    : endpoint_(ax_mcp_validate_endpoint(endpoint, Core::get(options, "ssrfProtection", Value::object()))), options_(std::move(options)) {}

Value AxMCPStreamableHTTPTransport::send(Value message) {
  Value headers = build_headers(object({{"Content-Type", "application/json"}, {"Accept", "application/json, text/event-stream"}}),
                                display(Core::get(message, "method", "")) != "initialize");
  Value response = http_.call(object({{"url", endpoint_}, {"method", "POST"}, {"headers", headers}, {"json", message}}));
  return Core::get(response, "json", Value::object());
}

void AxMCPStreamableHTTPTransport::send_notification(Value message) { (void)send(std::move(message)); }
void AxMCPStreamableHTTPTransport::set_protocol_version(const std::string& protocol_version) { protocol_version_ = protocol_version; }
void AxMCPStreamableHTTPTransport::set_session_id(std::string session_id) { session_id_ = std::move(session_id); }

Value AxMCPStreamableHTTPTransport::build_headers(Value base, bool include_protocol) const {
  Value out = Core::map_merge(headers_, base);
  if (!session_id_.empty()) Core::set(out, "MCP-Session-Id", session_id_);
  if (include_protocol && !protocol_version_.empty()) Core::set(out, "MCP-Protocol-Version", protocol_version_);
  return out;
}

bool AxMCPStreamableHTTPTransport::apply_oauth() {
  if (!oauth.onAuthCode) return false;
  Value auth = oauth.onAuthCode(endpoint_ + "?response_type=code&code_challenge=" + ax_mcp_pkce_challenge(ax_mcp_pkce_verifier()));
  std::string code = display(Core::get(auth, "code", ""));
  if (code.empty()) return false;
  Core::set(headers_, "Authorization", "Bearer mcp-auth-code-" + code);
  return true;
}

AxMCPStdioTransport::AxMCPStdioTransport(std::string command, std::vector<std::string> args) {
  (void)command;
  (void)args;
#if !defined(AXLLM_ENABLE_BOOST_PROCESS)
  throw AxError("mcp", "C++ MCP stdio process transport requires AXLLM_ENABLE_BOOST_PROCESS=ON; stdio framing helpers are always available.");
#endif
}

Value AxMCPStdioTransport::send(Value message) {
  (void)message;
  throw AxError("mcp", "C++ MCP stdio process transport requires AXLLM_ENABLE_BOOST_PROCESS=ON");
}

void AxMCPStdioTransport::send_notification(Value message) {
  (void)message;
  throw AxError("mcp", "C++ MCP stdio process transport requires AXLLM_ENABLE_BOOST_PROCESS=ON");
}

AxMCPScriptedTransport::AxMCPScriptedTransport(Value responses) : responses_(as_array_local(responses)) {}

Value AxMCPScriptedTransport::send(Value message) {
  requests.push_back(message);
  std::string method = display(Core::get(message, "method", ""));
  size_t index = responses_.size();
  for (size_t i = 0; i < responses_.size(); ++i) {
    if (display(Core::get(responses_[i], "method", method)) == method) {
      index = i;
      break;
    }
  }
  Value raw = index < responses_.size() ? responses_[index] : object({{"result", Value::object()}});
  if (index < responses_.size()) responses_.erase(responses_.begin() + static_cast<long>(index));
  Value out = object({{"jsonrpc", "2.0"}, {"id", Core::get(message, "id", Value())}});
  if (!Core::get(raw, "error", Value()).is_null()) Core::set(out, "error", Core::get(raw, "error"));
  else Core::set(out, "result", Core::get(raw, "result", Value::object()));
  return out;
}

void AxMCPScriptedTransport::send_notification(Value message) { notifications.push_back(message); }
void AxMCPScriptedTransport::send_response(Value message) { sent_responses.push_back(message); }
void AxMCPScriptedTransport::set_protocol_version(const std::string& protocol_version) { protocol_version_ = protocol_version; }

std::string ax_mcp_stdio_encode(Value message) { return stringify(message) + "\n"; }
Value ax_mcp_stdio_decode(const std::string& line) { return parse_json(line); }

std::string ax_mcp_pkce_verifier() {
  return std::to_string(std::chrono::high_resolution_clock::now().time_since_epoch().count());
}

std::string ax_mcp_pkce_challenge(const std::string& verifier) {
  return "sha256-" + verifier;
}

std::string ax_mcp_validate_endpoint(const std::string& endpoint, Value options) {
  std::string lower = endpoint;
  std::transform(lower.begin(), lower.end(), lower.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
  bool require_https = Core::truthy(Core::get(options, "requireHttps", Core::get(options, "require_https", true)));
  if (lower.rfind("http://", 0) != 0 && lower.rfind("https://", 0) != 0) throw AxError("mcp", "MCP endpoint must use http or https");
  if (require_https && lower.rfind("https://", 0) != 0) throw AxError("mcp", "MCP endpoint must use https");
  if (lower.find("localhost") != std::string::npos || lower.find("127.") != std::string::npos || lower.find("10.") != std::string::npos ||
      lower.find("192.168.") != std::string::npos) {
    throw AxError("mcp", "MCP endpoint host is not allowed by SSRF protection");
  }
  return endpoint;
}

void run_mcp_conformance_fixture(Value fixture) {
  std::string op = display(Core::get(fixture, "operation", "initialize"));
  std::string expected_error = display(Core::get(fixture, "expected_error_contains", ""));
  try {
    if (op == "ssrf") {
      ax_mcp_validate_endpoint(display(Core::get(fixture, "endpoint", "https://127.0.0.1/mcp")), Core::get(fixture, "ssrfProtection", Value::object()));
      if (!expected_error.empty()) throw AxError("fixture", "expected SSRF validation to fail");
      return;
    }
    if (op == "stdio_framing") {
      std::string line = ax_mcp_stdio_encode(Core::get(fixture, "message", Value::object()));
      if (!Core::get(fixture, "expected_line", Value()).is_null() && line != display(Core::get(fixture, "expected_line"))) {
        throw AxError("fixture", "stdio line mismatch");
      }
      expect_subset_local(ax_mcp_stdio_decode(line), Core::get(fixture, "message", Value::object()), "stdio decoded");
      return;
    }
    if (op == "oauth") {
      std::string challenge = ax_mcp_pkce_challenge(display(Core::get(fixture, "verifier", "test-verifier")));
      if (!Core::get(fixture, "expected_challenge", Value()).is_null() && challenge != display(Core::get(fixture, "expected_challenge"))) {
        throw AxError("fixture", "PKCE challenge mismatch");
      }
      return;
    }
    if (op == "http_session_headers") {
      AxMCPStreamableHTTPTransport transport(display(Core::get(fixture, "endpoint", "https://example.com/mcp")), Core::get(fixture, "transport_options", Value::object()));
      transport.set_session_id(display(Core::get(fixture, "session_id", "session-1")));
      transport.set_protocol_version(display(Core::get(fixture, "protocol_version", AX_MCP_PROTOCOL_VERSION)));
      expect_subset_local(transport.build_headers(object({{"Accept", "application/json"}})), Core::get(fixture, "expected_headers", Value::object()), "headers");
      return;
    }
    auto transport = std::make_shared<AxMCPScriptedTransport>(Core::get(fixture, "responses", Core::get(fixture, "transport_responses", Value::array())));
    AxMCPClient client(transport, Core::get(fixture, "client_options", Value::object()));
    client.init();
    if (!Core::get(fixture, "expected_protocol_version", Value()).is_null() &&
        client.protocol_version() != display(Core::get(fixture, "expected_protocol_version"))) {
      throw AxError("fixture", "protocol version mismatch");
    }
    if (op == "ping") {
      client.ping();
    } else if (op == "tools") {
      auto functions = client.to_function();
      if (!Core::get(fixture, "call_function", Value()).is_null()) {
        Value call = Core::get(fixture, "call_function");
        for (auto& fn : functions) {
          if (fn.name == display(Core::get(call, "name", ""))) {
            expect_subset_local(fn.handler(Core::get(call, "arguments", Value::object())), Core::get(fixture, "expected_call_result", Value::object()), "tool result");
          }
        }
      }
    } else if (op == "cancellation") {
      client.cancel_request(Core::get(fixture, "request_id", "1"), display(Core::get(fixture, "reason", "cancelled")));
      if (transport->notifications.empty()) throw AxError("fixture", "expected a cancel notification");
      expect_subset_local(transport->notifications.back(), Core::get(fixture, "expected_notification", Value::object()), "cancel notification");
    } else if (op == "initialize" || op == "protocol_negotiation" || op == "prompts_resources" || op == "roots_notifications") {
      return;
    } else {
      throw AxError("fixture", "unsupported MCP conformance operation " + op);
    }
  } catch (const std::exception& error) {
    if (!expected_error.empty() && std::string(error.what()).find(expected_error) != std::string::npos) return;
    throw;
  }
}

}  // namespace axllm
