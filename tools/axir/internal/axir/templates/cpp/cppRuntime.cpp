#include "axllm.hpp"

#include <array>
#include <cstdlib>
#include <fstream>
#include <iostream>
#include <mutex>
#include <set>

#if defined(AXLLM_ENABLE_CURL)
#include <curl/curl.h>
#endif

#if defined(AXLLM_ENABLE_REALTIME)
#include <condition_variable>
#include <deque>
#include <ixwebsocket/IXWebSocket.h>
#endif

namespace axllm {

Value::Value() : data(nullptr) {}
Value::Value(std::nullptr_t) : data(nullptr) {}
Value::Value(bool value) : data(value) {}
Value::Value(int value) : data(static_cast<double>(value)) {}
Value::Value(long value) : data(static_cast<double>(value)) {}
Value::Value(double value) : data(value) {}
Value::Value(const char* value) : data(std::string(value == nullptr ? "" : value)) {}
Value::Value(std::string value) : data(std::move(value)) {}
Value::Value(Array value) : data(std::make_shared<Array>(std::move(value))) {}
Value::Value(Object value) : data(std::make_shared<Object>(std::move(value))) {}
Value Value::array() { return Value(Array{}); }
Value Value::object() { return Value(Object{}); }
bool Value::is_null() const { return std::holds_alternative<std::nullptr_t>(data); }
bool Value::is_bool() const { return std::holds_alternative<bool>(data); }
bool Value::is_number() const { return std::holds_alternative<double>(data); }
bool Value::is_string() const { return std::holds_alternative<std::string>(data); }
bool Value::is_array() const { return std::holds_alternative<std::shared_ptr<Array>>(data); }
bool Value::is_object() const { return std::holds_alternative<std::shared_ptr<Object>>(data); }

AxError::AxError(std::string category, std::string message)
    : AxError(std::move(category), std::move(message), "", 0, "", false) {}
AxError::AxError(std::string category, std::string message, std::string type_, int status_, std::string code_, bool retryable_)
    : std::runtime_error(std::move(message)),
      category(std::move(category)),
      type(std::move(type_)),
      status(status_),
      code(std::move(code_)),
      retryable(retryable_) {}

static std::map<std::string, AIClient*>& client_registry() {
  static std::map<std::string, AIClient*> clients;
  return clients;
}

static std::map<std::string, AxProgram*>& agent_stage_registry() {
  static std::map<std::string, AxProgram*> stages;
  return stages;
}

static std::map<std::string, AxCodeRuntime*>& code_runtime_registry() {
  static std::map<std::string, AxCodeRuntime*> runtimes;
  return runtimes;
}

static std::map<std::string, AxCodeSession*>& code_session_registry() {
  static std::map<std::string, AxCodeSession*> sessions;
  return sessions;
}

// Native host search callbacks: Value cannot hold a closure, so the closures live in
// a process-lifetime registry keyed by id, and a small marker object ({"__*_search_id": id})
// is placed in the agent options under "onMemoriesSearch"/"onSkillsSearch". The agent loop
// (Core::agent_memory_search / agent_skill_search) reads the marker and dispatches here.
static std::map<std::string, std::function<Value(Value, Value)>>& memories_search_registry() {
  static std::map<std::string, std::function<Value(Value, Value)>> registry;
  return registry;
}
static std::map<std::string, std::function<Value(Value)>>& skills_search_registry() {
  static std::map<std::string, std::function<Value(Value)>> registry;
  return registry;
}
Value register_memories_search(std::function<Value(Value, Value)> fn) {
  static int counter = 0;
  std::string id = "__mem_search_" + std::to_string(++counter);
  memories_search_registry()[id] = std::move(fn);
  return object({{"__memories_search_id", id}});
}
Value register_skills_search(std::function<Value(Value)> fn) {
  static int counter = 0;
  std::string id = "__skill_search_" + std::to_string(++counter);
  skills_search_registry()[id] = std::move(fn);
  return object({{"__skills_search_id", id}});
}

static std::map<std::string, std::function<Value(Value)>>& tool_registry() {
  static std::map<std::string, std::function<Value(Value)>> handlers;
  return handlers;
}

static std::map<std::string, std::function<Value(Value)>>& assertion_registry() {
  static std::map<std::string, std::function<Value(Value)>> handlers;
  return handlers;
}

static std::map<std::string, std::function<Value(Value)>>& processor_registry() {
  static std::map<std::string, std::function<Value(Value)>> handlers;
  return handlers;
}

static std::map<std::string, std::function<void(Value)>>& function_hook_registry() {
  static std::map<std::string, std::function<void(Value)>> handlers;
  return handlers;
}

static std::map<std::string, std::function<Value(Value)>>& flow_mapper_registry() {
  static std::map<std::string, std::function<Value(Value)>> handlers;
  return handlers;
}

static Value register_flow_mapper(std::string prefix, std::function<Value(Value)> mapper) {
  std::string id = std::move(prefix) + ":flow_mapper:" + std::to_string(flow_mapper_registry().size());
  flow_mapper_registry()[id] = std::move(mapper);
  return object({{"__flow_mapper_id", Value(id)}});
}

Value flow_callback(std::function<Value(Value)> mapper) {
  return register_flow_mapper("host", std::move(mapper));
}

static std::string pointer_id(const void* ptr) {
  std::ostringstream out;
  out << reinterpret_cast<std::uintptr_t>(ptr);
  return out.str();
}

static Array array_ref(const Value& value) {
  if (auto p = std::get_if<std::shared_ptr<Array>>(&value.data)) return **p;
  return Array{};
}

static Array& array_mut(Value& value) {
  if (!value.is_array()) value = Value::array();
  return *std::get<std::shared_ptr<Array>>(value.data);
}

static Object object_ref(const Value& value) {
  if (auto p = std::get_if<std::shared_ptr<Object>>(&value.data)) return **p;
  return Object{};
}

static std::string str(const Value& value);

static std::vector<std::pair<std::string, Value>> entries(const Value& value) {
  Object obj = object_ref(value);
  std::vector<std::pair<std::string, Value>> out;
  std::set<std::string> seen;
  auto order_it = obj.find("__order");
  if (order_it != obj.end()) {
    for (const auto& key_value : array_ref(order_it->second)) {
      std::string key = str(key_value);
      auto it = obj.find(key);
      if (it != obj.end() && key != "__order") {
        out.push_back(*it);
        seen.insert(key);
      }
    }
  }
  for (const auto& kv : obj) {
    if (kv.first != "__order" && seen.count(kv.first) == 0) out.push_back(kv);
  }
  return out;
}

static Object& object_mut(Value& value) {
  if (!value.is_object()) value = Value::object();
  return *std::get<std::shared_ptr<Object>>(value.data);
}

static std::string stable_stringify(const Value& value);

static std::string str(const Value& value) {
  if (auto p = std::get_if<std::string>(&value.data)) return *p;
  if (auto p = std::get_if<double>(&value.data)) return display(value);
  if (auto p = std::get_if<bool>(&value.data)) return *p ? "true" : "false";
  if (value.is_null()) return "";
  return stringify(value);
}

static double num(const Value& value) {
  if (auto p = std::get_if<double>(&value.data)) return *p;
  if (auto p = std::get_if<bool>(&value.data)) return *p ? 1.0 : 0.0;
  std::string s = str(value);
  return s.empty() ? 0.0 : std::stod(s);
}

static std::string key_string(const Value& key) {
  return str(key);
}

static Value get_key(const Value& object, const std::string& key, Value fallback = Value()) {
  const auto& obj = object_ref(object);
  auto it = obj.find(key);
  if (it != obj.end()) return it->second;
  static const std::map<std::string, std::string> aliases = {
      {"is_array", "isArray"}, {"is_optional", "isOptional"},
      {"is_internal", "isInternal"}, {"is_cached", "isCached"},
      {"min_length", "minLength"}, {"max_length", "maxLength"},
      {"pattern_description", "patternDescription"},
      {"input_fields", "inputs"}, {"output_fields", "outputs"}};
  auto alias = aliases.find(key);
  if (alias != aliases.end()) {
    auto jt = obj.find(alias->second);
    if (jt != obj.end()) return jt->second;
  }
  return fallback;
}

static bool has_key(const Value& object, const std::string& key) {
  const auto& obj = object_ref(object);
  if (obj.count(key) > 0) return true;
  static const std::map<std::string, std::string> aliases = {
      {"is_array", "isArray"}, {"is_optional", "isOptional"},
      {"is_internal", "isInternal"}, {"is_cached", "isCached"},
      {"min_length", "minLength"}, {"max_length", "maxLength"},
      {"pattern_description", "patternDescription"}};
  auto alias = aliases.find(key);
  return alias != aliases.end() && obj.count(alias->second) > 0;
}

// Decode a standard / URL-safe base64 string into raw bytes. Whitespace and
// padding are tolerated; invalid characters terminate decoding. Used to turn
// the base64 audio payload of a multipart `file` field back into raw bytes.
static std::string axir_base64_decode(const std::string& input) {
  // Build the reverse lookup table once (standard + URL-safe alphabet).
  static const std::array<int8_t, 256> lookup = []() {
    std::array<int8_t, 256> t{};
    t.fill(-1);
    const std::string alphabet =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    for (size_t i = 0; i < alphabet.size(); ++i) t[static_cast<unsigned char>(alphabet[i])] = static_cast<int8_t>(i);
    // Accept URL-safe variants.
    t[static_cast<unsigned char>('-')] = t[static_cast<unsigned char>('+')];
    t[static_cast<unsigned char>('_')] = t[static_cast<unsigned char>('/')];
    return t;
  }();
  std::string out;
  out.reserve(input.size() / 4 * 3 + 3);
  uint32_t buffer = 0;
  int bits = 0;
  for (unsigned char ch : input) {
    if (ch == '=' || ch == '\r' || ch == '\n' || ch == ' ' || ch == '\t') continue;
    int8_t value = lookup[ch];
    if (value < 0) continue;
    buffer = (buffer << 6) | static_cast<uint32_t>(value);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push_back(static_cast<char>((buffer >> bits) & 0xFF));
    }
  }
  return out;
}

// Encode raw bytes as a standard (RFC 4648) base64 string. Used to return the
// raw body of a binary response (e.g. OpenAI /audio/speech mp3 bytes) as a
// string without UTF-8 / JSON handling. The input is a std::string whose length
// comes from .size() so embedded NUL bytes are preserved.
static std::string axir_base64_encode(const std::string& input) {
  static const char alphabet[] =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  std::string out;
  out.reserve((input.size() + 2) / 3 * 4);
  size_t i = 0;
  const size_t n = input.size();
  while (i + 3 <= n) {
    uint32_t triple = (static_cast<uint8_t>(input[i]) << 16) |
                      (static_cast<uint8_t>(input[i + 1]) << 8) |
                      static_cast<uint8_t>(input[i + 2]);
    out.push_back(alphabet[(triple >> 18) & 0x3F]);
    out.push_back(alphabet[(triple >> 12) & 0x3F]);
    out.push_back(alphabet[(triple >> 6) & 0x3F]);
    out.push_back(alphabet[triple & 0x3F]);
    i += 3;
  }
  const size_t remaining = n - i;
  if (remaining == 1) {
    uint32_t triple = static_cast<uint8_t>(input[i]) << 16;
    out.push_back(alphabet[(triple >> 18) & 0x3F]);
    out.push_back(alphabet[(triple >> 12) & 0x3F]);
    out.push_back('=');
    out.push_back('=');
  } else if (remaining == 2) {
    uint32_t triple = (static_cast<uint8_t>(input[i]) << 16) |
                      (static_cast<uint8_t>(input[i + 1]) << 8);
    out.push_back(alphabet[(triple >> 18) & 0x3F]);
    out.push_back(alphabet[(triple >> 12) & 0x3F]);
    out.push_back(alphabet[(triple >> 6) & 0x3F]);
    out.push_back('=');
  }
  return out;
}

// Encode a request payload as multipart/form-data. Multipart operations (e.g.
// OpenAI /audio/transcriptions) carry the audio as a binary `file` part; every
// other field is a plain form field. The `file` value is a base64 string
// (optionally a data: URL) or an object {data, mimeType?, filename?}. Returns
// the raw (binary-safe) body and the matching Content-Type header value.
static std::pair<std::string, std::string> axir_encode_multipart(const Value& payload) {
  const std::string boundary = "----axllmFormBoundaryAx7LlmMultipartBoundary";
  const std::string crlf = "\r\n";
  std::string body;
  for (const auto& field : entries(payload)) {
    const std::string& key = field.first;
    const Value& value = field.second;
    if (value.is_null()) continue;
    if (key == "file") {
      std::string data;
      std::string filename = "audio.wav";
      std::string content_type = "audio/wav";
      if (value.is_object()) {
        data = str(Core::get(value, "data", Value("")));
        std::string fn = str(Core::get(value, "filename", Value("")));
        if (!fn.empty()) filename = fn;
        std::string mt = str(Core::get(value, "mimeType", Core::get(value, "mime_type", Value(""))));
        if (!mt.empty()) content_type = mt;
      } else {
        data = str(value);
      }
      // Strip an optional `data:<mime>;base64,` URL prefix.
      if (data.rfind("data:", 0) == 0) {
        auto comma = data.find(',');
        if (comma != std::string::npos) data = data.substr(comma + 1);
      }
      std::string file_bytes = axir_base64_decode(data);
      if (file_bytes.empty() && !data.empty()) file_bytes = data;  // not base64 -> send raw
      body += "--" + boundary + crlf;
      body += "Content-Disposition: form-data; name=\"file\"; filename=\"" + filename + "\"" + crlf;
      body += "Content-Type: " + content_type + crlf + crlf;
      body += file_bytes + crlf;
    } else {
      body += "--" + boundary + crlf;
      body += "Content-Disposition: form-data; name=\"" + key + "\"" + crlf + crlf;
      body += str(value) + crlf;
    }
  }
  body += "--" + boundary + "--" + crlf;
  return {body, "multipart/form-data; boundary=" + boundary};
}

Value HttpTransport::call(Value request) {
#if !defined(AXLLM_ENABLE_CURL)
  (void)request;
  throw Core::as_error(Core::ai_error_unsupported("C++ HTTP transport requires libcurl. Build with CMake and AXLLM_ENABLE_CURL=ON, or pass a custom Transport."));
#else
  static bool curl_global_initialized = []() {
    curl_global_init(CURL_GLOBAL_DEFAULT);
    return true;
  }();
  (void)curl_global_initialized;

  CURL* curl = curl_easy_init();
  if (curl == nullptr) {
    throw AxError("network", "curl_easy_init failed");
  }

  std::string response;
  Value response_headers = Value::object();
  char error_buffer[CURL_ERROR_SIZE] = {0};

  // Build the request body. Normal operations carry a JSON payload under "json";
  // multipart operations (e.g. OpenAI /audio/transcriptions) carry the payload
  // under "data" and must be encoded as multipart/form-data with the audio sent
  // as raw bytes. The body string is binary-safe (length comes from .size()).
  bool multipart = !has_key(request, "json") && has_key(request, "data");
  std::string payload;
  std::string multipart_content_type;
  if (multipart) {
    auto encoded = axir_encode_multipart(Core::get(request, "data", Value::object()));
    payload = std::move(encoded.first);
    multipart_content_type = std::move(encoded.second);
  } else {
    Value body = Core::get(request, "json", Core::get(request, "data", Value::object()));
    payload = stringify(body);
  }

  struct curl_slist* headers = nullptr;
  for (const auto& entry : object_ref(Core::get(request, "headers", Value::object()))) {
    if (entry.first == "__order") continue;
    // Override the JSON Content-Type for multipart requests.
    if (multipart && (entry.first == "Content-Type" || entry.first == "content-type")) continue;
    std::string header = entry.first + ": " + str(entry.second);
    headers = curl_slist_append(headers, header.c_str());
  }
  if (multipart) {
    std::string ct_header = "Content-Type: " + multipart_content_type;
    headers = curl_slist_append(headers, ct_header.c_str());
  }

  std::string method = str(Core::get(request, "method", "POST"));
  std::string url = str(Core::get(request, "url"));
  bool stream = Core::truthy(Core::get(request, "stream", false));
  // Binary operations (e.g. OpenAI /audio/speech) return raw bytes (mp3) that
  // must not be JSON-parsed or UTF-8 handled; they are returned as base64.
  bool binary_response = Core::truthy(Core::get(request, "binary", false));
  double timeout = num(Core::get(request, "timeout", 0));

  curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
  curl_easy_setopt(curl, CURLOPT_ERRORBUFFER, error_buffer);
  curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
  curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, +[](char* ptr, size_t size, size_t nmemb, void* userdata) -> size_t {
    auto* out = static_cast<std::string*>(userdata);
    out->append(ptr, size * nmemb);
    return size * nmemb;
  });
  curl_easy_setopt(curl, CURLOPT_WRITEDATA, &response);
  curl_easy_setopt(curl, CURLOPT_HEADERFUNCTION, +[](char* ptr, size_t size, size_t nmemb, void* userdata) -> size_t {
    auto* out = static_cast<Value*>(userdata);
    std::string line(ptr, size * nmemb);
    auto colon = line.find(':');
    if (colon != std::string::npos) {
      auto name = line.substr(0, colon);
      auto value = line.substr(colon + 1);
      auto begin = value.find_first_not_of(" \t");
      auto end = value.find_last_not_of(" \t\r\n");
      if (begin != std::string::npos) Core::set(*out, name, value.substr(begin, end - begin + 1));
    }
    return size * nmemb;
  });
  curl_easy_setopt(curl, CURLOPT_HEADERDATA, &response_headers);
  if (timeout > 0) curl_easy_setopt(curl, CURLOPT_TIMEOUT_MS, static_cast<long>(timeout * 1000.0));
  if (method == "POST") {
    curl_easy_setopt(curl, CURLOPT_POST, 1L);
    // POSTFIELDSIZE makes the body binary-safe: curl sends exactly this many
    // bytes from the buffer rather than scanning for a NUL terminator, which is
    // required for the raw audio bytes embedded in a multipart body.
    curl_easy_setopt(curl, CURLOPT_POSTFIELDS, payload.data());
    curl_easy_setopt(curl, CURLOPT_POSTFIELDSIZE, static_cast<long>(payload.size()));
  } else {
    curl_easy_setopt(curl, CURLOPT_CUSTOMREQUEST, method.c_str());
  }

  CURLcode rc = curl_easy_perform(curl);
  long status = 0;
  curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &status);
  // Capture the response Content-Type before cleanup so callers (e.g. the MCP
  // Streamable HTTP transport) can branch on text/event-stream vs JSON.
  char* response_content_type = nullptr;
  curl_easy_getinfo(curl, CURLINFO_CONTENT_TYPE, &response_content_type);
  std::string content_type = response_content_type != nullptr ? std::string(response_content_type) : std::string();
  curl_slist_free_all(headers);
  curl_easy_cleanup(curl);

  if (rc != CURLE_OK) {
    std::string message = error_buffer[0] ? error_buffer : curl_easy_strerror(rc);
    if (rc == CURLE_OPERATION_TIMEDOUT) {
      throw Core::as_error(Core::ai_error_timeout(message, Value(), Value(), Value(), request, false));
    }
    throw AxError("network", message);
  }

  Value out = Value::object();
  Core::set(out, "status", static_cast<double>(status));
  Core::set(out, "contentType", content_type);
  Core::set(out, "headers", response_headers);
  if (binary_response) {
    // Base64-encode the full (binary-safe) body; response may contain NULs, so
    // axir_base64_encode reads its whole .size() rather than a c_str().
    Core::set(out, "body", Value(axir_base64_encode(response)));
  } else if (stream) {
    Core::set(out, "body", response);
  } else {
    Core::set(out, "json", Core::json_parse(response));
  }
  return out;
#endif
}

bool Core::truthy(const Value& value) {
  if (value.is_null()) return false;
  if (auto p = std::get_if<bool>(&value.data)) return *p;
  if (auto p = std::get_if<double>(&value.data)) return *p != 0.0;
  if (auto p = std::get_if<std::string>(&value.data)) return !p->empty();
  if (auto p = std::get_if<std::shared_ptr<Array>>(&value.data)) return !(*p)->empty();
  if (value.is_object()) return !entries(value).empty();
  return true;
}


static void axir_coverage_mark(const char* name) {
  static const char* path = std::getenv("AXIR_COVERAGE_FILE");
  if (path == nullptr) {
    return;
  }
  static std::mutex axir_coverage_mutex;
  static std::set<std::string> seen;
  std::lock_guard<std::mutex> lock(axir_coverage_mutex);
  if (!seen.insert(name).second) {
    return;
  }
  std::ofstream out(path, std::ios::app);
  out << name << "\n";
}

Value Core::truthy_value(Value value) { return Value(truthy(value)); }
Value Core::not_(Value value) { return Value(!truthy(value)); }
Value Core::and_(Value left, Value right) { return Value(truthy(left) && truthy(right)); }
Value Core::or_(Value left, Value right) { return Value(truthy(left) || truthy(right)); }
Value Core::eq(Value left, Value right) { return Value(equal(left, right)); }
Value Core::ne(Value left, Value right) { return Value(!equal(left, right)); }
Value Core::lt(Value left, Value right) { return Value(num(left) < num(right)); }
Value Core::lte(Value left, Value right) { return Value(num(left) <= num(right)); }
Value Core::gt(Value left, Value right) { return Value(num(left) > num(right)); }
Value Core::gte(Value left, Value right) { return Value(num(left) >= num(right)); }
Value Core::add(Value left, Value right) {
  if (left.is_number() && right.is_number()) return Value(num(left) + num(right));
  return Value(str(left) + str(right));
}
Value Core::mul(Value left, Value right) { return Value(num(left) * num(right)); }
Value Core::div(Value left, Value right) {
  double denom = num(right);
  return Value(num(left) / (denom == 0.0 ? 1.0 : denom));
}
Value Core::math_abs(Value value) { return Value(std::abs(num(value))); }
Value Core::math_log(Value value) { return Value(std::log(num(value))); }
Value Core::math_exp(Value value) { return Value(std::exp(num(value))); }
Value Core::math_sqrt(Value value) { return Value(std::sqrt(num(value))); }
Value Core::math_cos(Value value) { return Value(std::cos(num(value))); }
Value Core::math_pow(Value left, Value right) { return Value(std::pow(num(left), num(right))); }
static thread_local std::vector<double> axir_math_random_values;
void Core::set_math_random_values(std::vector<double> values) { axir_math_random_values = std::move(values); }
Value Core::math_random() {
  if (!axir_math_random_values.empty()) {
    double value = axir_math_random_values.front();
    axir_math_random_values.erase(axir_math_random_values.begin());
    return Value(value);
  }
  return Value(static_cast<double>(std::rand()) / (static_cast<double>(RAND_MAX) + 1.0));
}

double Core::number(Value value) { return num(value); }
Value Core::contains(Value container, Value item) {
  if (container.is_object()) return Value(has_key(container, key_string(item)));
  if (container.is_array()) {
    for (const auto& value : array_ref(container)) if (equal(value, item)) return Value(true);
    return Value(false);
  }
  return Value(str(container).find(str(item)) != std::string::npos);
}
Value Core::len(Value value) {
  if (value.is_string()) return Value(static_cast<double>(str(value).size()));
  if (value.is_array()) return Value(static_cast<double>(array_ref(value).size()));
  if (value.is_object()) return Value(static_cast<double>(entries(value).size()));
  return Value(0);
}
Value Core::is_none(Value value) { return Value(value.is_null()); }
Value Core::is_not_none(Value value) { return Value(!value.is_null()); }
Value Core::none() { return Value(); }
Value Core::coalesce(Value value, Value fallback) { return value.is_null() ? fallback : value; }
Value Core::map_merge(Value left, Value right) {
  Value out(object_ref(left));
  return map_update(out, right);
}
Value Core::get(Value target, Value key, Value default_value) {
  if (target.is_object()) return get_key(target, key_string(key), default_value);
  if (target.is_array() && key.is_number()) {
    int idx = static_cast<int>(num(key));
    const auto& arr = array_ref(target);
    return idx >= 0 && static_cast<size_t>(idx) < arr.size() ? arr[idx] : default_value;
  }
  return default_value;
}
void Core::set(Value& target, Value key, Value value) {
  std::string k = key_string(key);
  Object& obj = object_mut(target);
  if (obj.count(k) == 0) {
    Array order = array_ref(obj["__order"]);
    order.emplace_back(k);
    obj["__order"] = order;
  }
  obj[k] = std::move(value);
}
void Core::append(Value& target, Value value) {
  array_mut(target).push_back(std::move(value));
}
Array Core::iter(Value value) {
  if (value.is_object()) {
    Array out;
    for (const auto& kv : entries(value)) out.emplace_back(kv.first);
    return out;
  }
  return array_ref(value);
}
Value Core::map_contains(Value values, Value key) { return Value(has_key(values, key_string(key))); }
Value Core::map_get(Value values, Value key) { return get(values, key); }
Value Core::map_delete(Value values, Value key) {
  std::string k = key_string(key);
  Object& out = object_mut(values);
  out.erase(k);
  Array order;
  for (const auto& item : array_ref(out["__order"])) {
    if (str(item) != k) order.push_back(item);
  }
  out["__order"] = order;
  return values;
}
Value Core::map_update(Value target, Value values) {
  auto out = object_ref(target);
  Array order = array_ref(out["__order"]);
  for (const auto& kv : entries(values)) {
    if (out.count(kv.first) == 0) order.emplace_back(kv.first);
    out[kv.first] = kv.second;
  }
  out["__order"] = order;
  return Value(out);
}
Value Core::map_values(Value values) {
  Array out;
  for (const auto& kv : entries(values)) out.push_back(kv.second);
  return Value(out);
}
Value Core::map_keys(Value values) {
  Array out;
  for (const auto& kv : entries(values)) out.emplace_back(kv.first);
  return Value(out);
}
Value Core::list_get(Value values, Value index, Value default_value) {
  int idx = static_cast<int>(num(index));
  const auto& arr = array_ref(values);
  return idx >= 0 && static_cast<size_t>(idx) < arr.size() ? arr[idx] : default_value;
}
Value Core::type_is(Value value, Value type_name) {
  std::string t = str(type_name);
  if (t == "object") return Value(value.is_object());
  if (t == "list") return Value(value.is_array());
  if (t == "string") return Value(value.is_string());
  if (t == "number") return Value(value.is_number());
  if (t == "boolean") return Value(value.is_bool());
  if (t == "null") return Value(value.is_null());
  if (t == "json") return Value(true);
  return Value(false);
}
Value Core::regex_match(Value pattern, Value value) {
  return Value(value.is_string() && std::regex_search(str(value), std::regex(str(pattern))));
}
Value Core::string_trim(Value value) {
  std::string s = str(value);
  auto start = s.find_first_not_of(" \t\n\r");
  if (start == std::string::npos) return Value("");
  auto end = s.find_last_not_of(" \t\n\r");
  return Value(s.substr(start, end - start + 1));
}
Value Core::string_join(Value sep, Value values) {
  std::string out;
  bool first = true;
  for (const auto& item : array_ref(values)) {
    if (!first) out += str(sep);
    first = false;
    out += str(item);
  }
  return Value(out);
}
Value Core::string_lower(Value value) {
  std::string out = str(value);
  std::transform(out.begin(), out.end(), out.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
  return Value(out);
}
Value Core::string_lower_camel(Value values) {
  const auto& items = array_ref(values);
  if (items.empty()) return Value("");
  std::string out = str(string_lower(items[0]));
  for (size_t i = 1; i < items.size(); ++i) {
    std::string part = str(string_lower(items[i]));
    if (!part.empty()) part[0] = static_cast<char>(std::toupper(static_cast<unsigned char>(part[0])));
    out += part;
  }
  return Value(out);
}
Value Core::string_title_from_camel(Value value) {
  std::string text = std::regex_replace(str(value), std::regex("Code$"), " Code");
  text = std::regex_replace(text, std::regex("([a-z0-9])([A-Z])"), "$1 $2");
  while (!text.empty() && std::isspace(static_cast<unsigned char>(text.front()))) text.erase(text.begin());
  while (!text.empty() && std::isspace(static_cast<unsigned char>(text.back()))) text.pop_back();
  if (!text.empty()) text[0] = static_cast<char>(std::toupper(static_cast<unsigned char>(text[0])));
  return Value(text);
}
Value Core::string_ends_with(Value value, Value suffix) {
  std::string s = str(value), suf = str(suffix);
  return Value(s.size() >= suf.size() && s.compare(s.size() - suf.size(), suf.size(), suf) == 0);
}
Value Core::string_starts_with(Value value, Value prefix) {
  std::string s = str(value), p = str(prefix);
  return Value(s.rfind(p, 0) == 0);
}
Value Core::string_replace(Value value, Value old_value, Value new_value) {
  std::string s = str(value), old = str(old_value), repl = str(new_value);
  size_t pos = 0;
  while (!old.empty() && (pos = s.find(old, pos)) != std::string::npos) {
    s.replace(pos, old.size(), repl);
    pos += repl.size();
  }
  return Value(s);
}
Value Core::string_slice(Value value, Value start, Value end) {
  std::string s = str(value);
  size_t a = static_cast<size_t>(std::max(0.0, num(start)));
  if (end.is_null()) return Value(a < s.size() ? s.substr(a) : "");
  size_t b = static_cast<size_t>(std::max(0.0, num(end)));
  if (a > s.size()) return Value("");
  return Value(s.substr(a, b > a ? b - a : 0));
}
Value Core::string_remove_suffix(Value value, Value suffix) {
  std::string s = str(value), suf = str(suffix);
  Object out;
  if (!suf.empty() && s.size() >= suf.size() && s.compare(s.size() - suf.size(), suf.size(), suf) == 0) {
    out["value"] = s.substr(0, s.size() - suf.size());
    out["removed"] = true;
  } else {
    out["value"] = s;
    out["removed"] = false;
  }
  return Value(out);
}
Value Core::string_words(Value value) {
  std::istringstream in(str(value));
  std::string word;
  Array out;
  while (in >> word) out.emplace_back(word);
  return Value(out);
}
Value Core::string_default_if_empty(Value value, Value fallback) {
  return truthy(string_trim(value)) ? string_trim(value) : fallback;
}
Value Core::string_format(Value templ, Value a, Value b, Value c) {
  std::string out = str(templ);
  for (const auto& arg : Array{a, b, c}) {
    if (arg.is_null()) continue;
    size_t pos = out.find("{}");
    if (pos == std::string::npos) break;
    out.replace(pos, 2, display(arg));
  }
  return Value(out);
}
Value Core::string_split(Value value, Value sep) {
  std::string s = str(value), delimiter = str(sep);
  Array out;
  size_t pos = 0;
  while (true) {
    size_t next = s.find(delimiter, pos);
    out.emplace_back(s.substr(pos, next == std::string::npos ? std::string::npos : next - pos));
    if (next == std::string::npos) break;
    pos = next + delimiter.size();
  }
  return Value(out);
}
Value Core::string_split_once(Value value, Value sep) {
  std::string s = str(value), delimiter = str(sep);
  size_t pos = s.find(delimiter);
  Object out;
  out["found"] = pos != std::string::npos;
  out["left"] = pos == std::string::npos ? s : s.substr(0, pos);
  out["right"] = pos == std::string::npos ? "" : s.substr(pos + delimiter.size());
  return Value(out);
}
Value Core::string_split_trim_nonempty(Value value, Value sep) {
  Array out;
  for (const auto& part : array_ref(string_split(value, sep))) {
    Value trimmed = string_trim(part);
    if (truthy(trimmed)) out.push_back(trimmed);
  }
  return Value(out);
}

static int find_outside_quotes_raw(const std::string& s, const std::string& needle) {
  char quote = 0;
  bool escaped = false;
  for (size_t i = 0; i < s.size(); ++i) {
    char ch = s[i];
    if (escaped) { escaped = false; continue; }
    if (ch == '\\') { escaped = true; continue; }
    if (quote != 0) { if (ch == quote) quote = 0; continue; }
    if (ch == '\'' || ch == '"') { quote = ch; continue; }
    if (s.compare(i, needle.size(), needle) == 0) return static_cast<int>(i);
  }
  if (quote != 0) throw AxError("signature", "Unterminated string");
  return -1;
}
Value Core::string_find_outside_quotes(Value text, Value needle) { return Value(find_outside_quotes_raw(str(text), str(needle))); }
Value Core::string_split_outside_quotes(Value text, Value sep) {
  std::string s = str(text);
  char separator = str(sep).empty() ? ',' : str(sep)[0];
  Array out;
  std::string cur;
  char quote = 0;
  bool escaped = false;
  for (char ch : s) {
    if (escaped) { cur.push_back(ch); escaped = false; continue; }
    if (ch == '\\') { cur.push_back(ch); escaped = true; continue; }
    if (quote != 0) { cur.push_back(ch); if (ch == quote) quote = 0; continue; }
    if (ch == '\'' || ch == '"') { cur.push_back(ch); quote = ch; continue; }
    if (ch == separator) {
      Value trimmed = string_trim(cur);
      if (truthy(trimmed)) out.push_back(trimmed);
      cur.clear();
      continue;
    }
    cur.push_back(ch);
  }
  if (quote != 0) throw AxError("signature", "Unterminated string");
  Value trimmed = string_trim(cur);
  if (truthy(trimmed)) out.push_back(trimmed);
  return Value(out);
}
Value Core::string_split_top_level(Value text, Value sep) {
  std::string s = str(text), delimiter = str(sep), cur;
  Array out;
  char quote = 0;
  bool escaped = false;
  int paren_depth = 0, brace_depth = 0;
  for (size_t i = 0; i < s.size();) {
    char ch = s[i];
    if (escaped) { cur.push_back(ch); escaped = false; ++i; continue; }
    if (ch == '\\') { cur.push_back(ch); escaped = true; ++i; continue; }
    if (quote != 0) { cur.push_back(ch); if (ch == quote) quote = 0; ++i; continue; }
    if (ch == '\'' || ch == '"') { cur.push_back(ch); quote = ch; ++i; continue; }
    if (ch == '(') ++paren_depth;
    else if (ch == ')' && paren_depth > 0) --paren_depth;
    else if (ch == '{') ++brace_depth;
    else if (ch == '}' && brace_depth > 0) --brace_depth;
    if (!delimiter.empty() && paren_depth == 0 && brace_depth == 0 && s.compare(i, delimiter.size(), delimiter) == 0) {
      out.push_back(string_trim(cur));
      cur.clear();
      i += delimiter.size();
      continue;
    }
    cur.push_back(ch);
    ++i;
  }
  if (quote != 0) throw AxError("signature", "Unterminated string");
  out.push_back(string_trim(cur));
  return Value(out);
}
Value Core::string_extract_leading_group(Value text, Value open, Value close) {
  std::string s = str(text), opening = str(open), closing = str(close);
  if (opening.empty() || closing.empty() || s.rfind(opening, 0) != 0) {
    return Value(Object{{"found", false}, {"balanced", true}, {"group", ""}, {"rest", s}});
  }
  char quote = 0;
  bool escaped = false;
  int depth = 0;
  for (size_t i = 0; i < s.size(); ++i) {
    char ch = s[i];
    if (escaped) { escaped = false; continue; }
    if (ch == '\\') { escaped = true; continue; }
    if (quote != 0) { if (ch == quote) quote = 0; continue; }
    if (ch == '\'' || ch == '"') { quote = ch; continue; }
    if (s.compare(i, opening.size(), opening) == 0) { ++depth; i += opening.size() - 1; continue; }
    if (s.compare(i, closing.size(), closing) == 0) {
      --depth;
      if (depth == 0) {
        return Value(Object{{"found", true}, {"balanced", true}, {"group", s.substr(opening.size(), i - opening.size())}, {"rest", s.substr(i + closing.size())}});
      }
      i += closing.size() - 1;
    }
  }
  if (quote != 0) throw AxError("signature", "Unterminated string");
  return Value(Object{{"found", true}, {"balanced", false}, {"group", s.substr(opening.size())}, {"rest", ""}});
}
Value Core::string_consume_optional_quoted_prefix(Value text) {
  std::string s = str(text);
  Object out;
  if (s.empty() || (s[0] != '\'' && s[0] != '"')) {
    out["value"] = Value();
    out["rest"] = s;
    out["found"] = false;
    return Value(out);
  }
  char quote = s[0];
  bool escaped = false;
  std::string val;
  for (size_t i = 1; i < s.size(); ++i) {
    char ch = s[i];
    if (escaped) { val.push_back(ch); escaped = false; }
    else if (ch == '\\') escaped = true;
    else if (ch == quote) {
      out["value"] = val;
      out["rest"] = s.substr(i + 1);
      out["found"] = true;
      return Value(out);
    } else val.push_back(ch);
  }
  throw AxError("signature", "Unterminated string");
}
Value Core::string_extract_quoted_suffix(Value text) {
  std::string s = str(text);
  bool escaped = false;
  for (size_t i = 0; i < s.size(); ++i) {
    char ch = s[i];
    if (escaped) { escaped = false; continue; }
    if (ch == '\\') { escaped = true; continue; }
    if (ch == '\'' || ch == '"') {
      Value consumed = string_consume_optional_quoted_prefix(s.substr(i));
      Object out = object_ref(consumed);
      out["index"] = static_cast<double>(i);
      out["head"] = s.substr(0, i);
      return Value(out);
    }
  }
  return Value(Object{{"value", Value()}, {"index", Value()}, {"rest", ""}, {"head", s}, {"found", false}});
}
Value Core::string_str(Value value) { return Value(display(value)); }
Value Core::regex_replace(Value pattern, Value repl, Value value) {
  return Value(std::regex_replace(str(value), std::regex(str(pattern)), str(repl)));
}
Value Core::sorted_strings(Value values) {
  Array out;
  for (const auto& item : array_ref(values)) out.emplace_back(str(item));
  std::sort(out.begin(), out.end(), [](const Value& a, const Value& b) { return str(a) < str(b); });
  return Value(out);
}
Value Core::json_parse(Value value) {
  std::string text = str(value);
  Value trimmed = string_trim(text);
  text = str(trimmed);
  std::string fence(3, static_cast<char>(96));
  if (text.rfind(fence, 0) == 0) {
    text.erase(std::remove(text.begin(), text.end(), static_cast<char>(96)), text.end());
    text = str(string_trim(text));
    if (text.rfind("json", 0) == 0) text = str(string_trim(text.substr(4)));
  }
  return parse_json(text);
}
Value Core::json_stringify(Value value) { return Value(stringify(value)); }
Value Core::json_stable_stringify(Value value) { return Value(stable_stringify(value)); }
Value Core::json_pretty(Value value) { return Value(stringify(value)); }
Value Core::signature_error(Value message) { return Value(Object{{"__error", "signature"}, {"message", str(message)}}); }
Value Core::validation_error(Value message) { return Value(Object{{"__error", "validation"}, {"message", str(message)}}); }
Value Core::runtime_error(Value message) { return Value(Object{{"__error", "runtime"}, {"message", str(message)}}); }
static Value ai_error_object(const std::string& type, Value message, Value status = Value(), Value code = Value(), Value response_body = Value(), Value request = Value(), Value retryable = Value(false)) {
  Object out;
  out["__error"] = "ai";
  out["__type"] = type;
  out["message"] = str(message);
  out["status"] = status;
  out["code"] = code;
  out["response_body"] = response_body;
  out["request"] = request;
  out["retryable"] = Core::truthy(retryable);
  return Value(out);
}
Value Core::ai_error_response(Value message, Value response_body) { return ai_error_object("AxAIServiceResponseError", message, Value(), Value(), response_body); }
Value Core::ai_error_refusal(Value message, Value response_body) { return ai_error_object("AxAIRefusalError", message, Value(), Value(), response_body); }
Value Core::ai_error_stream(Value message, Value response_body, Value retryable) { return ai_error_object("AxAIServiceStreamTerminatedError", message, Value(), Value(), response_body, Value(), retryable); }
Value Core::ai_error_unsupported(Value message) { return ai_error_object("AxUnsupportedCapabilityError", message); }
Value Core::ai_error_auth(Value message, Value status, Value code, Value response_body, Value request) { return ai_error_object("AxAIServiceAuthenticationError", message, status, code, response_body, request); }
Value Core::ai_error_timeout(Value message, Value status, Value code, Value response_body, Value request, Value retryable) { return ai_error_object("AxAIServiceTimeoutError", message, status, code, response_body, request, retryable); }
Value Core::ai_error_status(Value message, Value status, Value code, Value response_body, Value request, Value retryable) { return ai_error_object("AxAIServiceStatusError", message, status, code, response_body, request, retryable); }
Value Core::exception_value(const std::exception& error) {
  if (const auto* ax = dynamic_cast<const AxError*>(&error)) {
    Object out{{"__error", ax->category}, {"message", std::string(ax->what())}};
    if (!ax->type.empty()) out["__type"] = ax->type;
    if (ax->status != 0) out["status"] = ax->status;
    if (!ax->code.empty()) out["code"] = ax->code;
    out["retryable"] = ax->retryable;
    return Value(out);
  }
  return runtime_error(error.what());
}
Value Core::exception_message(Value error) {
  if (error.is_object() && has_key(error, "message")) return get_key(error, "message");
  return Value(str(error));
}
AxError Core::as_error(Value error) {
  if (error.is_object() && has_key(error, "__error")) {
    int status = get_key(error, "status").is_null() ? 0 : static_cast<int>(num(get_key(error, "status")));
    return AxError(str(get_key(error, "__error")), str(get_key(error, "message")), str(get_key(error, "__type")), status, str(get_key(error, "code")), truthy(get_key(error, "retryable")));
  }
  return AxError("runtime", str(error));
}
Value Core::coerce_chat_request(Value request) {
  if (has_key(request, "chat_prompt")) return Value(object_ref(request));
  if (has_key(request, "chatPrompt")) {
    Value out(object_ref(request));
    Core::set(out, "chat_prompt", get_key(request, "chatPrompt"));
    return out;
  }
  if (has_key(request, "messages")) {
    Value out = Value::object();
    Core::set(out, "chat_prompt", get_key(request, "messages"));
    Core::set(out, "functions", get_key(request, "functions", Value::array()));
    Core::set(out, "function_call", get_key(request, "function_call", get_key(request, "tool_choice")));
    Core::set(out, "response_format", get_key(request, "response_format"));
    Core::set(out, "model", get_key(request, "model"));
    Core::set(out, "model_config", get_key(request, "model_config", Value::object()));
    return out;
  }
  return Value(object_ref(request));
}
Value Core::client_ref(AIClient& client) {
  std::string id = pointer_id(&client);
  client_registry()[id] = &client;
  return Value(Object{{"__client_id", id}});
}
Value Core::agent_stage_ref(AxProgram& stage) {
  std::string id = pointer_id(&stage);
  agent_stage_registry()[id] = &stage;
  return Value(Object{{"__agent_stage_id", id}});
}
Value Core::code_runtime_ref(AxCodeRuntime& runtime) {
  std::string id = pointer_id(&runtime);
  code_runtime_registry()[id] = &runtime;
  return Value(Object{{"__code_runtime_id", id}, {"language", runtime.language()}, {"usageInstructions", runtime.usage_instructions()}});
}
Value Core::legacy_response_to_chat_response(Value raw) {
  if (!get_key(raw, "results").is_null()) return raw;
  Array calls;
  for (const auto& item : array_ref(get_key(raw, "function_calls"))) {
    Object call = object_ref(item);
    Object fn;
    fn["name"] = get_key(item, "name");
    fn["params"] = get_key(item, "params");
    Object out;
    out["id"] = get_key(item, "id");
    out["type"] = "function";
    out["function"] = Value(fn);
    calls.emplace_back(out);
  }
  Object result;
  result["index"] = 0;
  result["content"] = get_key(raw, "content", "");
  result["function_calls"] = Value(calls);
  result["finish_reason"] = get_key(raw, "finish_reason", "stop");
  Object out;
  out["results"] = Value(Array{Value(result)});
  Value usage = get_key(raw, "usage");
  if (!usage.is_null()) out["model_usage"] = Value(Object{{"tokens", usage}});
  return Value(out);
}
Value Core::object_call_method(Value target, Value method_name, Value arg) {
  if (str(method_name) == "render" && str(get_key(target, "__kind")) == "PromptTemplate") {
    return render_prompt(get_key(target, "signature"), arg, get_key(target, "functions", Value::array()), get_key(target, "options", Value::object()));
  }
  if (str(method_name) == "call") {
    std::string mapper_id = str(get_key(target, "__flow_mapper_id"));
    auto it = flow_mapper_registry().find(mapper_id);
    if (it != flow_mapper_registry().end()) return it->second(arg);
  }
  throw AxError("runtime", "unsupported method call: " + str(method_name));
}
Value Core::program_components(Value program) {
  std::string stage_id = str(get_key(program, "__agent_stage_id"));
  auto it = agent_stage_registry().find(stage_id);
  if (it == agent_stage_registry().end() || it->second == nullptr) return Value::array();
  return it->second->get_optimizable_components();
}
Value Core::program_apply_components(Value program, Value component_map) {
  std::string stage_id = str(get_key(program, "__agent_stage_id"));
  auto it = agent_stage_registry().find(stage_id);
  if (it != agent_stage_registry().end() && it->second != nullptr) it->second->apply_optimized_components(std::move(component_map));
  return Value::object();
}
Value Core::ai_complete_once(Value client, Value request) {
  std::string id = str(get_key(client, "__client_id"));
  auto it = client_registry().find(id);
  if (it == client_registry().end() || it->second == nullptr) throw AxError("runtime", "client does not implement AIClient");
  return chat_response_to_completion(it->second->chat(request));
}
Value Core::agent_transcribe(Value client, Value request, Value options) {
  // Backs intrinsic.agent.transcribe: call the AI client's transcribe so audio inputs become
  // text before the agent loop (the client passes through @agent_forward as a real client).
  std::string id = str(get_key(client, "__client_id"));
  auto it = client_registry().find(id);
  if (it == client_registry().end() || it->second == nullptr) return object({{"text", std::string("")}});
  return it->second->transcribe(request, options);
}
Value Core::retry_sleep(Value) { return Value(); }
Value Core::tool_invoke(Value fn, Value params) {
  Value args = get_key(fn, "args", Value::array());
  if (truthy(args)) validate_fields(args, params, "tool." + str(get_key(fn, "name")) + ".args");
  std::string id = str(get_key(fn, "__tool_id"));
  auto it = tool_registry().find(id);
  if (it == tool_registry().end()) throw AxError("runtime", "unknown tool");
  Value result = it->second(params.is_null() ? Value::object() : params);
  Value returns = get_key(fn, "returns", Value::array());
  if (truthy(returns) && result.is_object()) validate_fields(returns, result, "tool." + str(get_key(fn, "name")) + ".return");
  return result;
}
Value Core::agent_stage_forward(Value stage, Value client, Value values, Value options) {
  std::string stage_id = str(get_key(stage, "__agent_stage_id"));
  auto stage_it = agent_stage_registry().find(stage_id);
  if (stage_it == agent_stage_registry().end() || stage_it->second == nullptr) {
    throw AxError("runtime", "agent stage is not AxProgram");
  }
  std::string client_id = str(get_key(client, "__client_id"));
  auto client_it = client_registry().find(client_id);
  if (client_it == client_registry().end() || client_it->second == nullptr) {
    throw AxError("runtime", "client does not implement AIClient");
  }
  return stage_it->second->forward(*client_it->second, values, options);
}
Value Core::agent_stage_chat_log(Value stage) {
  std::string stage_id = str(get_key(stage, "__agent_stage_id"));
  auto it = agent_stage_registry().find(stage_id);
  if (it == agent_stage_registry().end() || it->second == nullptr) return Value::array();
  return it->second->get_chat_log();
}
Value Core::agent_stage_usage(Value stage) {
  std::string stage_id = str(get_key(stage, "__agent_stage_id"));
  auto it = agent_stage_registry().find(stage_id);
  if (it == agent_stage_registry().end() || it->second == nullptr) return Value::array();
  Value usage = it->second->get_usage();
  if (truthy(usage)) return usage;
  Value items = Value::array();
  for (const auto& raw_entry : array_ref(it->second->get_chat_log())) {
    Value item = get_key(raw_entry, "usage");
    if (truthy(item)) append(items, item);
  }
  return items;
}
Value Core::agent_stage_traces(Value stage) {
  std::string stage_id = str(get_key(stage, "__agent_stage_id"));
  auto it = agent_stage_registry().find(stage_id);
  if (it == agent_stage_registry().end() || it->second == nullptr) return Value::array();
  return it->second->get_traces();
}
Value Core::agent_clarification_error(Value payload, Value state) {
  Value args = get_key(payload, "args", Value::array());
  Value clarification = array_ref(args).empty() ? payload : array_ref(args)[0];
  std::string message = str(get_key(clarification, "question", get_key(clarification, "message", clarification)));
  return Value(Object{
      {"__error", "AxAgentClarificationError"},
      {"message", message},
      {"clarification", clarification},
      {"state", get_key(state, "runtime_state", Value::object())},
      {"payload", payload},
  });
}
Value Core::agent_runtime_create_session(Value runtime, Value globals, Value options) {
  std::string runtime_id = str(get_key(runtime, "__code_runtime_id"));
  auto it = code_runtime_registry().find(runtime_id);
  if (it == code_runtime_registry().end() || it->second == nullptr) {
    throw AxError("runtime", "agent runtime does not implement AxCodeRuntime");
  }
  AxCodeSession* session = it->second->create_session(globals, options);
  if (session == nullptr) throw AxError("runtime", "agent runtime returned no session");
  std::string session_id = pointer_id(session);
  code_session_registry()[session_id] = session;
  return Value(Object{{"__code_session_id", session_id}});
}
Value Core::agent_runtime_execute(Value session, Value code, Value options) {
  std::string session_id = str(get_key(session, "__code_session_id"));
  auto it = code_session_registry().find(session_id);
  if (it == code_session_registry().end() || it->second == nullptr) throw AxError("runtime", "agent code session is not active");
  return it->second->execute(code, options);
}
Value Core::agent_runtime_inspect(Value session, Value options) {
  std::string session_id = str(get_key(session, "__code_session_id"));
  auto it = code_session_registry().find(session_id);
  if (it == code_session_registry().end() || it->second == nullptr) throw AxError("runtime", "agent code session is not active");
  return it->second->inspect(options);
}
Value Core::agent_runtime_export_state(Value session, Value options) {
  std::string session_id = str(get_key(session, "__code_session_id"));
  auto it = code_session_registry().find(session_id);
  if (it == code_session_registry().end() || it->second == nullptr) throw AxError("runtime", "agent code session is not active");
  return it->second->export_state(options);
}
Value Core::agent_runtime_restore_state(Value session, Value snapshot, Value options) {
  std::string session_id = str(get_key(session, "__code_session_id"));
  auto it = code_session_registry().find(session_id);
  if (it == code_session_registry().end() || it->second == nullptr) throw AxError("runtime", "agent code session is not active");
  return it->second->restore_state(snapshot, options);
}
Value Core::agent_runtime_close(Value session) {
  std::string session_id = str(get_key(session, "__code_session_id"));
  auto it = code_session_registry().find(session_id);
  if (it == code_session_registry().end() || it->second == nullptr) return Value(Object{{"closed", true}});
  Value result = it->second->close();
  code_session_registry().erase(it);
  return result.is_null() ? Value(Object{{"closed", true}}) : result;
}
Value Core::agent_memory_search(Value state, Value searches, Value already_loaded) {
  Value options = get_key(state, "options", Value::object());
  // Native host callback: a closure registered via register_memories_search, referenced by a
  // marker under "onMemoriesSearch" -- receives the actor's recall() searches + already-loaded ids.
  Value callback = get_key(options, "on_memories_search", get_key(options, "onMemoriesSearch", Value()));
  if (callback.is_object()) {
    std::string mid = str(get_key(callback, "__memories_search_id", Value("")));
    if (!mid.empty()) {
      auto& reg = memories_search_registry();
      auto it = reg.find(mid);
      if (it != reg.end() && it->second) {
        Value r = it->second(searches, already_loaded);
        return r.is_null() ? Value::array() : r;
      }
    }
  }
  Value scripted = get_key(options, "memory_search_results", get_key(options, "memorySearchResults", Value::object()));
  if (scripted.is_object()) {
    std::vector<std::string> parts;
    for (const auto& item : array_ref(searches)) parts.push_back(str(item));
    std::string joined;
    for (size_t i = 0; i < parts.size(); ++i) {
      if (i > 0) joined += "|";
      joined += parts[i];
    }
    Value exact = get_key(scripted, joined, Value());
    if (!exact.is_null()) return exact;
    for (const auto& item : parts) {
      Value hit = get_key(scripted, item, Value());
      if (!hit.is_null()) return hit;
    }
    return get_key(scripted, "*", Value::array());
  }
  if (scripted.is_array()) return scripted;
  return Value::array();
}
Value Core::agent_skill_search(Value state, Value searches) {
  Value options = get_key(state, "options", Value::object());
  // Native host callback: a closure registered via register_skills_search, referenced by a
  // marker under "onSkillsSearch" -- receives the actor's discover() searches.
  Value callback = get_key(options, "on_skills_search", get_key(options, "onSkillsSearch", Value()));
  if (callback.is_object()) {
    std::string mid = str(get_key(callback, "__skills_search_id", Value("")));
    if (!mid.empty()) {
      auto& reg = skills_search_registry();
      auto it = reg.find(mid);
      if (it != reg.end() && it->second) {
        Value r = it->second(searches);
        return r.is_null() ? Value::array() : r;
      }
    }
  }
  Value scripted = get_key(options, "skill_search_results", get_key(options, "skillSearchResults", Value::object()));
  if (scripted.is_object()) {
    std::vector<std::string> parts;
    for (const auto& item : array_ref(searches)) parts.push_back(str(item));
    std::string joined;
    for (size_t i = 0; i < parts.size(); ++i) {
      if (i > 0) joined += "|";
      joined += parts[i];
    }
    Value exact = get_key(scripted, joined, Value());
    if (!exact.is_null()) return exact;
    Value out = Value::array();
    for (const auto& item : parts) {
      for (const auto& match : array_ref(get_key(scripted, item, Value::array()))) append(out, match);
    }
    if (!array_ref(out).empty()) return out;
    return get_key(scripted, "*", Value::array());
  }
  if (scripted.is_array()) return scripted;
  return Value::array();
}
Value Core::agent_callable_invoke(Value state, Value request, Value options_arg) {
  Value options = get_key(state, "options", Value::object());
  std::string qualified = str(get_key(request, "qualified_name", get_key(request, "name", Value(""))));
  std::string name = str(get_key(request, "name", Value("")));
  Value scripted = get_key(options, "callable_results", get_key(options, "callableResults", Value::object()));
  if (scripted.is_object()) {
    Value result = get_key(scripted, qualified, Value());
    if (result.is_null() && !name.empty()) result = get_key(scripted, name, Value());
    if (result.is_null()) result = get_key(scripted, "*", Value());
    if (!result.is_null()) {
      if (result.is_object()) {
        Value out = result;
        if (!get_key(out, "error", Value()).is_null()) {
          Value err = Value::object();
          set(err, "status", "error");
          set(err, "error", get_key(out, "error"));
          return err;
        }
        if (get_key(out, "status", Value()).is_null()) set(out, "status", "ok");
        return out;
      }
      return object({{"status", "ok"}, {"value", result}});
    }
  }
  return object({{"status", "error"}, {"error", std::string("unknown callable: ") + qualified}});
}

static std::string titleize(const std::string& name) {
  std::string spaced;
  for (size_t i = 0; i < name.size(); ++i) {
    char ch = name[i] == '_' ? ' ' : name[i];
    if (i > 0 && (std::isupper(static_cast<unsigned char>(ch)) || std::isdigit(static_cast<unsigned char>(ch)))) spaced.push_back(' ');
    spaced.push_back(ch);
  }
  Value trimmed = Core::string_trim(spaced);
  std::string out = str(trimmed);
  if (!out.empty()) out[0] = static_cast<char>(std::toupper(static_cast<unsigned char>(out[0])));
  return out;
}

Value Core::record_new(Value name, Value values) {
  std::string type = str(name);
  Object in = object_ref(values);
  if (type == "FieldType") {
    Object out;
    out["name"] = in.count("name") ? in["name"] : Value("string");
    out["isArray"] = get_key(values, "is_array", false);
    for (const auto& key : {"options", "fields", "minimum", "maximum", "pattern", "format", "language", "description"}) {
      if (in.count(key)) out[key] = in[key];
    }
    for (const auto& keys : {std::pair{"minLength", "min_length"}, std::pair{"maxLength", "max_length"}, std::pair{"patternDescription", "pattern_description"}}) {
      auto value = get_key(values, keys.second);
      if (!value.is_null()) out[keys.first] = value;
    }
    for (const auto& kv : in) {
      if (!out.count(kv.first) && kv.first != "is_array" && kv.first != "min_length" && kv.first != "max_length" && kv.first != "pattern_description") out[kv.first] = kv.second;
    }
    return Value(out);
  }
  if (type == "Field") {
    std::string field_name = str(in["name"]);
    Object out;
    out["name"] = field_name;
    out["title"] = in.count("title") ? in["title"] : Value(titleize(field_name));
    out["type"] = in.count("type") ? in["type"] : record_new("FieldType", Object{{"name", "string"}});
    if (in.count("description") && !in["description"].is_null()) out["description"] = in["description"];
    out["isOptional"] = get_key(values, "is_optional", false);
    out["isInternal"] = get_key(values, "is_internal", false);
    out["isCached"] = get_key(values, "is_cached", false);
    return Value(out);
  }
  if (type == "AxSignature") {
    Object out;
    out["description"] = in.count("description") ? in["description"] : Value();
    out["inputs"] = in.count("inputs") ? in["inputs"] : Value::array();
    out["outputs"] = in.count("outputs") ? in["outputs"] : Value::array();
    return Value(out);
  }
  return values;
}
Value Core::field_item(Value field) {
  Object f = object_ref(field);
  Object t = object_ref(get_key(field, "type"));
  t["isArray"] = false;
  f["type"] = Value(t);
  return Value(f);
}
Value Core::fields_from_map(Value fields) {
  Array out;
  for (const auto& kv : entries(fields)) {
    Value item = kv.second;
    if (item.is_object() && has_key(item, "type")) {
      Object f = object_ref(item);
      if (!f.count("name") || str(f["name"]).empty()) f["name"] = kv.first;
      out.emplace_back(record_new("Field", Value(f)));
    } else {
      out.emplace_back(record_new("Field", Object{{"name", kv.first}, {"type", item}}));
    }
  }
  return Value(out);
}
Value Core::description_append(Value base, Value hint) {
  std::string h = str(string_trim(hint));
  if (h.empty()) return base;
  std::string b = str(string_trim(base));
  if (b.empty()) return Value(h);
  if (b.back() != '.') b.push_back('.');
  return Value(b + " " + h);
}
Value Core::url_valid(Value value) {
  return Value(value.is_string() && std::regex_search(str(value), std::regex("^[a-zA-Z][a-zA-Z0-9+.-]*://")));
}
Value Core::valid_image(Value value) { return Value(value.is_object() && has_key(value, "mimeType") && has_key(value, "data")); }
Value Core::valid_audio(Value value) { return Value(value.is_string() || (value.is_object() && (has_key(value, "data") || has_key(value, "id")))); }
Value Core::valid_file(Value value) { return Value(value.is_object() && has_key(value, "mimeType") && (has_key(value, "data") != has_key(value, "fileUri"))); }
Value Core::valid_url_shape(Value value) { return Value(value.is_string() || (value.is_object() && has_key(value, "url"))); }

struct TemplateRuntime {
  static Value parse(const std::string& source, const std::string& context);
  static std::string render(Value nodes, Value vars, const std::string& source, const std::string& context);
  static Value collect(Value nodes);
  static Value validate(const std::string& source, const std::string& context, Value required);
  static Object parse_range(const Array& tokens, const std::string& source, const std::string& context, size_t start, const std::set<std::string>& terms);
  static Object node(std::string type, Value value = Value()) { Object out; out["type"] = type; if (!value.is_null()) out["value"] = value; return out; }
  static Value resolve(Value vars, const std::string& path, const std::string& source, const std::string& context, int index);
  static void collect_into(Value nodes, std::set<std::string>& out);
  static std::string error(const std::string& context, const std::string& source, int index, const std::string& message);
};

Value Core::template_parse(Value source, Value context) { return TemplateRuntime::parse(str(source), str(context)); }
Value Core::template_render_tree(Value nodes, Value vars, Value source, Value context) { return Value(TemplateRuntime::render(nodes, vars, str(source), str(context))); }
Value Core::template_collect_vars(Value nodes) { return TemplateRuntime::collect(nodes); }
Value Core::template_validate(Value source, Value context, Value required) { return TemplateRuntime::validate(str(source), str(context), required); }

Value TemplateRuntime::parse(const std::string& source, const std::string& context) {
  std::regex tag_re("\\{\\{\\s*([^}]+?)\\s*\\}\\}");
  Array tokens;
  size_t last = 0;
  for (auto it = std::sregex_iterator(source.begin(), source.end(), tag_re); it != std::sregex_iterator(); ++it) {
    size_t start = static_cast<size_t>(it->position());
    if (start > last) tokens.emplace_back(Object{{"type", "text"}, {"value", source.substr(last, start - last)}});
    tokens.emplace_back(Object{{"type", "tag"}, {"value", str(Core::string_trim((*it)[1].str()))}, {"index", static_cast<double>(start)}});
    last = start + static_cast<size_t>(it->length());
  }
  if (last < source.size()) tokens.emplace_back(Object{{"type", "text"}, {"value", source.substr(last)}});
  Object result = parse_range(tokens, source, context, 0, {});
  if (!result["terminator"].is_null()) throw AxError("template", "Unexpected template terminator '" + str(result["terminator"]) + "' in " + context);
  return result["nodes"];
}

Object TemplateRuntime::parse_range(const Array& tokens, const std::string& source, const std::string& context, size_t start, const std::set<std::string>& terms) {
  Array nodes;
  size_t i = start;
  std::regex ident("^[A-Za-z_][A-Za-z0-9_]*(\\.[A-Za-z_][A-Za-z0-9_]*)*$");
  std::regex eq("^[A-Za-z_][A-Za-z0-9_]*(\\.[A-Za-z_][A-Za-z0-9_]*)*\\s*===\\s*('([^']*)'|\\\"([^\\\"]*)\\\")$");
  while (i < tokens.size()) {
    Object tok = object_ref(tokens[i]);
    if (str(tok["type"]) == "text") { nodes.emplace_back(Object{{"type", "text"}, {"value", tok["value"]}}); ++i; continue; }
    std::string tag = str(tok["value"]);
    if (terms.count(tag)) return Object{{"nodes", nodes}, {"index", static_cast<double>(i)}, {"terminator", tag}};
    int index = static_cast<int>(num(tok["index"]));
    if (tag.rfind("if ", 0) == 0) {
      std::string condition = str(Core::string_trim(tag.substr(3)));
      if (!std::regex_match(condition, ident) && !std::regex_match(condition, eq)) throw AxError("template", error(context, source, index, "Invalid if condition '" + condition + "'"));
      Object then_result = parse_range(tokens, source, context, i + 1, {"else", "/if"});
      if (then_result["terminator"].is_null()) throw AxError("template", error(context, source, index, "Unclosed 'if' block"));
      Array else_nodes;
      size_t next = static_cast<size_t>(num(then_result["index"]));
      if (str(then_result["terminator"]) == "else") {
        Object else_result = parse_range(tokens, source, context, next + 1, {"/if"});
        if (str(else_result["terminator"]) != "/if") throw AxError("template", error(context, source, index, "Unclosed 'if' block"));
        else_nodes = array_ref(else_result["nodes"]);
        next = static_cast<size_t>(num(else_result["index"]));
      }
      nodes.emplace_back(Object{{"type", "if"}, {"condition", condition}, {"then", then_result["nodes"]}, {"else", else_nodes}, {"index", static_cast<double>(index)}});
      i = next + 1;
      continue;
    }
    if (tag == "else") throw AxError("template", error(context, source, index, "Unexpected 'else'"));
    if (tag == "/if") throw AxError("template", error(context, source, index, "Unexpected '/if'"));
    if (!tag.empty() && tag[0] == '!') { ++i; continue; }
    if (tag.rfind("include ", 0) == 0) throw AxError("template", error(context, source, index, "Unexpected 'include' directive at runtime (includes must be compiled)"));
    if (!std::regex_match(tag, ident)) throw AxError("template", error(context, source, index, "Invalid tag '" + tag + "'"));
    nodes.emplace_back(Object{{"type", "var"}, {"name", tag}, {"index", static_cast<double>(index)}});
    ++i;
  }
  return Object{{"nodes", nodes}, {"index", static_cast<double>(i)}, {"terminator", Value()}};
}

std::string TemplateRuntime::render(Value nodes, Value vars, const std::string& source, const std::string& context) {
  std::ostringstream out;
  std::regex eq("^([A-Za-z_][A-Za-z0-9_]*(?:\\.[A-Za-z_][A-Za-z0-9_]*)*)\\s*===\\s*(?:'([^']*)'|\\\"([^\\\"]*)\\\")$");
  for (const auto& item : array_ref(nodes)) {
    Object node = object_ref(item);
    std::string type = str(node["type"]);
    if (type == "text") out << str(node["value"]);
    else if (type == "var") {
      Value value = resolve(vars, str(node["name"]), source, context, static_cast<int>(num(node["index"])));
      if (!(value.is_string() || value.is_number() || value.is_bool())) throw AxError("template", error(context, source, static_cast<int>(num(node["index"])), "Variable '" + str(node["name"]) + "' must be string, number, or boolean"));
      out << display(value);
    } else if (type == "if") {
      std::smatch m;
      std::string condition = str(node["condition"]);
      bool ok = false;
      if (std::regex_match(condition, m, eq)) {
        std::string expected = m[2].matched ? m[2].str() : m[3].str();
        ok = equal(resolve(vars, m[1].str(), source, context, static_cast<int>(num(node["index"]))), Value(expected));
      } else {
        Value resolved = resolve(vars, condition, source, context, static_cast<int>(num(node["index"])));
        if (!resolved.is_bool()) throw AxError("template", error(context, source, static_cast<int>(num(node["index"])), "Condition '" + condition + "' must be boolean"));
        ok = Core::truthy(resolved);
      }
      out << render(ok ? node["then"] : node["else"], vars, source, context);
    }
  }
  return out.str();
}

Value TemplateRuntime::resolve(Value vars, const std::string& path, const std::string& source, const std::string& context, int index) {
  Value current = vars;
  std::stringstream ss(path);
  std::string part;
  while (std::getline(ss, part, '.')) {
    if (!current.is_object() || !has_key(current, part)) throw AxError("template", error(context, source, index, "Missing template variable '" + path + "'"));
    current = get_key(current, part);
  }
  return current;
}

void TemplateRuntime::collect_into(Value nodes, std::set<std::string>& out) {
  std::regex eq("^([A-Za-z_][A-Za-z0-9_]*(?:\\.[A-Za-z_][A-Za-z0-9_]*)*)\\s*===");
  for (const auto& item : array_ref(nodes)) {
    Object node = object_ref(item);
    if (str(node["type"]) == "var") out.insert(str(node["name"]));
    else if (str(node["type"]) == "if") {
      std::smatch m;
      std::string condition = str(node["condition"]);
      if (std::regex_search(condition, m, eq)) out.insert(m[1].str());
      else out.insert(condition);
      collect_into(node["then"], out);
      collect_into(node["else"], out);
    }
  }
}
Value TemplateRuntime::collect(Value nodes) {
  std::set<std::string> names;
  collect_into(nodes, names);
  Array out;
  for (const auto& name : names) out.emplace_back(name);
  return Value(out);
}
Value TemplateRuntime::validate(const std::string& source, const std::string& context, Value required) {
  try {
    std::set<std::string> present;
    collect_into(parse(source, context), present);
    for (const auto& item : array_ref(required)) if (!present.count(str(item))) return Value("must preserve template variable {{" + str(item) + "}}");
    return Value(true);
  } catch (const std::exception& e) {
    return Value(std::string(e.what()));
  }
}
std::string TemplateRuntime::error(const std::string& context, const std::string& source, int index, const std::string& message) {
  int line = 1, col = 1;
  for (int i = 0; i < index && i < static_cast<int>(source.size()); ++i) {
    if (source[static_cast<size_t>(i)] == '\n') { ++line; col = 1; } else ++col;
  }
  return context + ":" + std::to_string(line) + ":" + std::to_string(col) + " " + message;
}

static std::string prompt_format_description(const std::string& text) {
  std::string v = str(Core::string_trim(text));
  if (v.empty()) return "";
  v[0] = static_cast<char>(std::toupper(static_cast<unsigned char>(v[0])));
  if (v.back() != '.') v.push_back('.');
  return v;
}
static bool prompt_provided(Value value) {
  return !value.is_null() && !(value.is_string() && str(value).empty()) && !(value.is_array() && array_ref(value).empty());
}
static Array prompt_inputs_for_values(Value sig, Value values) {
  Array fields = array_ref(get_key(sig, "inputs"));
  std::stable_sort(fields.begin(), fields.end(), [](const Value& a, const Value& b) { return Core::truthy(get_key(a, "isCached")) && !Core::truthy(get_key(b, "isCached")); });
  Array out;
  for (const auto& field : fields) if (!Core::truthy(get_key(field, "isOptional")) || prompt_provided(get_key(values, str(get_key(field, "name"))))) out.push_back(field);
  return out;
}
static std::string prompt_desc_fields(const Array& fields) {
  std::vector<std::string> out;
  for (const auto& f : fields) out.push_back(std::string(1, static_cast<char>(96)) + str(get_key(f, "title")) + static_cast<char>(96));
  std::string joined;
  for (size_t i = 0; i < out.size(); ++i) { if (i) joined += ", "; joined += out[i]; }
  return joined;
}
static Object prompt_field_map(Value sig) {
  Object out;
  for (const auto& f : array_ref(get_key(sig, "inputs"))) out[str(get_key(f, "name"))] = get_key(f, "title");
  for (const auto& f : array_ref(get_key(sig, "outputs"))) out[str(get_key(f, "name"))] = get_key(f, "title");
  return out;
}
static std::string prompt_format_refs(std::string desc, const Object& names) {
  std::vector<std::string> keys;
  for (const auto& kv : names) keys.push_back(kv.first);
  std::sort(keys.begin(), keys.end(), [](const std::string& a, const std::string& b) { return a.size() > b.size(); });
  for (const auto& key : keys) {
    std::string title = str(names.at(key));
    desc = str(Core::string_replace(desc, std::string(1, static_cast<char>(96)) + key + static_cast<char>(96), std::string(1, static_cast<char>(96)) + title + static_cast<char>(96)));
    desc = str(Core::string_replace(desc, "\"" + key + "\"", "\"" + title + "\""));
    desc = str(Core::string_replace(desc, "'" + key + "'", "'" + title + "'"));
    desc = str(Core::string_replace(desc, "[" + key + "]", "[" + title + "]"));
    desc = str(Core::string_replace(desc, "(" + key + ")", "(" + title + ")"));
    desc = std::regex_replace(desc, std::regex("\\$" + key + "\\b"), std::string(1, static_cast<char>(96)) + title + static_cast<char>(96));
  }
  return desc;
}
static std::string prompt_field_type_text(Value typ);
static std::string prompt_object_structure(Value fields) {
  std::vector<std::string> out;
  for (const auto& kv : entries(fields)) {
    Value f = kv.second;
    if (!has_key(f, "type")) f = Core::record_new("Field", Object{{"name", kv.first}, {"type", f}});
    out.push_back(kv.first + (Core::truthy(get_key(f, "isOptional")) ? "?" : "") + ": " + prompt_field_type_text(get_key(f, "type")));
  }
  std::string joined;
  for (size_t i = 0; i < out.size(); ++i) { if (i) joined += ", "; joined += out[i]; }
  return "{ " + joined + " }";
}
static std::string prompt_field_type_text(Value typ) {
  std::string name = str(get_key(typ, "name"));
  std::string base = "string";
  if (name == "number") base = "number";
  else if (name == "boolean") base = "boolean (true or false)";
  else if (name == "date") base = "date (YYYY-MM-DD, e.g. 2024-05-09)";
  else if (name == "dateRange") base = "date range ({ \"start\": \"YYYY-MM-DD\", \"end\": \"YYYY-MM-DD\" }, e.g. {\"start\":\"2024-05-09\",\"end\":\"2024-05-12\"})";
  else if (name == "datetime") base = "datetime (ISO 8601 with timezone, e.g. 2024-05-09T14:30:00Z or 2024-05-09T14:30:00-07:00)";
  else if (name == "datetimeRange") base = "datetime range ({ \"start\": ISO datetime, \"end\": ISO datetime }, e.g. {\"start\":\"2024-05-09T14:30:00Z\",\"end\":\"2024-05-09T15:30:00Z\"})";
  else if (name == "json") base = "JSON object";
  else if (name == "class") base = "classification class";
  else if (name == "code") base = "code";
  else if (name == "file") base = "file (with filename, mimeType, and data)";
  else if (name == "audio") base = "speech script (plain text to synthesize as audio)";
  else if (name == "url") base = "URL (string or object with url, title, description)";
  else if (name == "object") base = object_ref(get_key(typ, "fields")).empty() ? "object" : "object " + prompt_object_structure(get_key(typ, "fields"));
  return Core::truthy(get_key(typ, "isArray")) ? "json array of " + base + " items" : base;
}
static bool prompt_complex(Value sig) {
  for (const auto& field : array_ref(get_key(sig, "outputs"))) {
    Value typ = get_key(field, "type");
    if (str(get_key(typ, "name")) == "object" || !object_ref(get_key(typ, "fields")).empty()) return true;
  }
  return false;
}
static std::string prompt_render_input_fields(const Array& fields, const Object& names) {
  std::vector<std::string> rows;
  for (const auto& f : fields) {
    std::string row = str(get_key(f, "title")) + ":";
    if (!get_key(f, "description").is_null()) row += " " + prompt_format_refs(prompt_format_description(str(get_key(f, "description"))), names);
    rows.push_back(str(Core::string_trim(row)));
  }
  std::string joined;
  for (size_t i = 0; i < rows.size(); ++i) { if (i) joined += "\n"; joined += rows[i]; }
  return joined;
}
static std::string prompt_render_output_fields(const Array& fields, const Object& names) {
  std::vector<std::string> rows;
  for (const auto& f : fields) {
    Value typ = get_key(f, "type");
    std::string type_text = prompt_field_type_text(typ);
    std::string req = Core::truthy(get_key(f, "isOptional")) ? "Only include this " + type_text + " field if its value is available" : "This " + type_text + " field must be included";
    std::string desc;
    if (!get_key(f, "description").is_null()) desc = " " + prompt_format_refs(str(get_key(typ, "name")) == "class" ? str(get_key(f, "description")) : prompt_format_description(str(get_key(f, "description"))), names);
    if (!array_ref(get_key(typ, "options")).empty()) {
      std::vector<std::string> opts;
      for (const auto& option : array_ref(get_key(typ, "options"))) opts.push_back(str(option));
      std::string joined;
      for (size_t i = 0; i < opts.size(); ++i) { if (i) joined += ", "; joined += opts[i]; }
      desc += std::string(desc.empty() ? "" : ". ") + "Allowed values: " + joined;
    }
    rows.push_back(str(Core::string_trim(str(get_key(f, "title")) + ": (" + req + ")" + desc)));
  }
  std::string joined;
  for (size_t i = 0; i < rows.size(); ++i) { if (i) joined += "\n"; joined += rows[i]; }
  return joined;
}
static std::string prompt_task(Value sig) {
  Value desc = get_key(sig, "description");
  if (desc.is_null() || str(Core::string_trim(desc)).empty()) return "";
  return prompt_format_refs(prompt_format_description(str(desc)), prompt_field_map(sig));
}
static std::string prompt_render_functions(Value functions) {
  std::vector<std::string> rows;
  for (const auto& fn : array_ref(functions)) {
    rows.push_back("- " + std::string(1, static_cast<char>(96)) + str(get_key(fn, "name")) + static_cast<char>(96) + ": " + prompt_format_description(str(get_key(fn, "description", ""))));
  }
  std::string joined;
  for (size_t i = 0; i < rows.size(); ++i) { if (i) joined += "\n"; joined += rows[i]; }
  return joined;
}
Value Core::prompt_structured(Value signature, Value values, Value functions, Value options) {
  bool complex = prompt_complex(signature);
  std::string task = prompt_task(signature);
  Object vars;
  vars["hasFunctions"] = !array_ref(functions).empty();
  vars["hasTaskDefinition"] = !task.empty();
  vars["hasExampleDemonstrations"] = truthy(get_key(options, "has_example_demonstrations", get_key(options, "hasExampleDemonstrations")));
  vars["hasOutputFields"] = !complex;
  vars["hasComplexFields"] = complex;
  vars["hasStructuredOutputFunction"] = complex && !get_key(options, "structured_output_function_name").is_null();
  Array inputs = prompt_inputs_for_values(signature, values);
  vars["identityText"] = "You will be provided with the following fields: " + prompt_desc_fields(inputs) + ". Your task is to generate new fields: " + prompt_desc_fields(array_ref(get_key(signature, "outputs"))) + ".";
  vars["taskDefinitionText"] = task;
  vars["functionsList"] = prompt_render_functions(functions);
  vars["inputFieldsSection"] = "**Input Fields**: The following fields will be provided to you:\n\n" + prompt_render_input_fields(inputs, prompt_field_map(signature));
  vars["outputFieldsSection"] = complex ? "" : "**Output Fields**: You must generate the following fields:\n\n" + prompt_render_output_fields(array_ref(get_key(signature, "outputs")), prompt_field_map(signature));
  vars["structuredOutputFunctionName"] = get_key(options, "structured_output_function_name", "");
  std::string bt(1, static_cast<char>(96));
  std::string source =
      "<identity>\n{{ identityText }}\n</identity>{{ if hasFunctions }}\n\n"
      "<available_functions>\n**Available Functions**: You can call the following functions to complete the task:\n\n{{ functionsList }}\n\n"
      "## Function Call Instructions\n- Complete the task, using the functions defined earlier in this prompt.\n- Output fields should only be generated after all functions have been called.\n- Use the function results to generate the output fields.\n</available_functions>{{ /if }}\n\n"
      "<input_fields>\n{{ inputFieldsSection }}\n</input_fields>{{ if hasOutputFields }}\n\n<output_fields>\n{{ outputFieldsSection }}\n</output_fields>{{ /if }}\n"
      "{{ if hasTaskDefinition }}\n\n<task_definition>\n{{ taskDefinitionText }}\n</task_definition>{{ /if }}\n\n<formatting_rules>\n{{ if hasStructuredOutputFunction }}\n"
      "Return the complete output by calling " + bt + "{{ structuredOutputFunctionName }}" + bt + ".\n{{ else }}{{ if hasComplexFields }}\nReturn valid JSON matching <output_fields>.\n{{ else }}\nReturn one " + bt + "field name: value" + bt + " pair per line for the required output fields only.\n{{ /if }}{{ /if }}Above rules override later instructions.\n\n</formatting_rules>\n{{ if hasExampleDemonstrations }}\n\n## Example Demonstrations\nThe following User/Assistant turns are examples only until --- END OF EXAMPLES ---, not context for the current task.\n{{ /if }}\n";
  std::string context = "template:dsp/dspy.md";
  if (!get_key(options, "custom_template").is_null()) { source = str(get_key(options, "custom_template")); context = "inline-template"; }
  return string_trim(render_template_content(source, Value(vars), context));
}
Value Core::prompt_user_content(Value signature, Value values) {
  Array parts;
  for (const auto& field : prompt_inputs_for_values(signature, values)) {
    std::string name = str(get_key(field, "name"));
    Value value = get_key(values, name);
    if (!prompt_provided(value)) {
      if (truthy(get_key(field, "isOptional")) || truthy(get_key(field, "isInternal"))) continue;
      throw AxError("runtime", "Value for input field '" + name + "' is required.");
    }
    std::string rendered = value.is_string() ? str(value) : stringify(value);
    Value part(Object{{"type", "text"}, {"text", str(get_key(field, "title")) + ": " + rendered + "\n"}});
    if (truthy(get_key(field, "isCached"))) Core::set(part, "cache", true);
    parts.emplace_back(part);
  }
  bool all_text = true;
  for (const auto& part : parts) if (str(get_key(part, "type")) != "text" || truthy(get_key(part, "cache"))) all_text = false;
  if (!all_text) return Value(parts);
  std::string out;
  for (size_t i = 0; i < parts.size(); ++i) {
    if (i) out += "\n";
    out += str(get_key(parts[i], "text"));
  }
  return Value(out);
}
static std::string axgen_value_text(Value value) {
  return value.is_string() ? str(value) : stringify(value);
}
static std::string axgen_format_values(Value gen, Value values, const std::string& kind) {
  std::vector<std::string> lines;
  for (const auto& field : array_ref(Core::get(Core::get(gen, "signature"), kind + "_fields", Value::array()))) {
    std::string name = str(get_key(field, "name"));
    if (!get_key(values, name).is_null()) lines.push_back(str(get_key(field, "title", name)) + ": " + axgen_value_text(get_key(values, name)));
  }
  if (lines.empty()) {
    for (const auto& entry : object_ref(values)) lines.push_back(entry.first + ": " + axgen_value_text(entry.second));
  }
  std::string out;
  for (size_t i = 0; i < lines.size(); ++i) {
    if (i) out += "\n";
    out += lines[i];
  }
  return out;
}
static Value axgen_render_turns(Value gen, Value turns, const std::string& label) {
  Array out;
  for (const auto& item : array_ref(turns)) {
    if (label == "Demo" && get_key(item, "input", get_key(item, "values")).is_null()) continue;
    Value input = get_key(item, "input", get_key(item, "values", Value::object()));
    Value output = get_key(item, "output", get_key(item, "expected_output", Value::object()));
    Value user = Value::object();
    Core::set(user, "role", "user");
    Core::set(user, "content", label + " Input:\n" + axgen_format_values(gen, input, "input"));
    out.push_back(user);
    Value assistant = Value::object();
    Core::set(assistant, "role", "assistant");
    Core::set(assistant, "content", label + " Output:\n" + axgen_format_values(gen, output, "output"));
    out.push_back(assistant);
  }
  return Value(out);
}
Value Core::axgen_render_examples(Value gen) {
  if (truthy(get(get(gen, "options", Value::object()), "examplesInSystem"))) return Value::array();
  return axgen_render_turns(gen, get(gen, "examples", Value::array()), "Example");
}
Value Core::axgen_render_demos(Value gen) {
  if (truthy(get(get(gen, "options", Value::object()), "examplesInSystem"))) return Value::array();
  return axgen_render_turns(gen, get(gen, "demos", Value::array()), "Demo");
}
Value Core::axgen_apply_context_cache(Value gen, Value raw_messages, Value runtime_options) {
  Value messages = Value::array();
  for (const auto& raw : array_ref(raw_messages)) append(messages, Value(object_ref(raw)));
  Value options = map_merge(get(gen, "options", Value::object()), runtime_options);
  if (truthy(get_key(options, "examplesInSystem")) && !array_ref(messages).empty()) {
    std::vector<std::string> blocks;
    for (const auto& message : array_ref(axgen_render_turns(gen, get(gen, "examples", Value::array()), "Example"))) blocks.push_back(str(get_key(message, "content", "")));
    for (const auto& message : array_ref(axgen_render_turns(gen, get(gen, "demos", Value::array()), "Demo"))) blocks.push_back(str(get_key(message, "content", "")));
    if (!blocks.empty()) {
      std::string joined;
      for (size_t i = 0; i < blocks.size(); ++i) { if (i) joined += "\n\n"; joined += blocks[i]; }
      Value first = list_get(messages, 0, Value::object());
      set(first, "content", str(get_key(first, "content", "")) + "\n\n--- EXAMPLES ---\n" + joined + "\n--- END OF EXAMPLES ---");
      Array arr = array_ref(messages);
      if (!arr.empty()) {
        arr[0] = first;
        messages = Value(arr);
      }
    }
  }
  Value context_cache = get_key(options, "context_cache", get_key(options, "contextCache"));
  if (!truthy(context_cache) || truthy(get_key(options, "ignore_cache_breakpoints"))) return messages;
  if (!array_ref(messages).empty()) {
    Value first = list_get(messages, 0, Value::object());
    set(first, "cache", true);
    Array arr = array_ref(messages);
    if (!arr.empty()) {
      arr[0] = first;
      messages = Value(arr);
    }
  }
  std::string breakpoint = context_cache.is_object() ? str(get_key(context_cache, "breakpoint", get_key(context_cache, "cache_breakpoint", get_key(context_cache, "cacheBreakpoint", "after_examples")))) : "after_examples";
  if (breakpoint.empty() || breakpoint == "after_examples" || breakpoint == "afterExamples") {
    Array arr = array_ref(messages);
    for (int i = static_cast<int>(arr.size()) - 2; i >= 0; --i) {
      if (str(get_key(arr[i], "role")) == "assistant" || str(get_key(arr[i], "role")) == "tool") {
        Value item = arr[static_cast<size_t>(i)];
        set(item, "cache", true);
        arr[static_cast<size_t>(i)] = item;
        messages = Value(arr);
        break;
      }
    }
  }
  return messages;
}
Value Core::axgen_apply_field_processors(Value gen, Value output) {
  Value result(object_ref(output));
  bool changed = false;
  for (const auto& raw : array_ref(get(gen, "field_processors", Value::array()))) {
    std::string field = str(get_key(raw, "field", get_key(raw, "name")));
    if (field.empty() || get_key(result, field).is_null()) continue;
    Value processor = get_key(raw, "processor", get_key(raw, "op"));
    std::string processor_id = str(get_key(raw, "__processor_id"));
    if (!processor_id.empty()) {
      auto it = processor_registry().find(processor_id);
      if (it != processor_registry().end()) {
        set(result, field, it->second(get_key(result, field)));
        changed = true;
        continue;
      }
    }
    std::string op = str(processor);
    std::string value = str(get_key(result, field));
    if (op == "uppercase") {
      std::transform(value.begin(), value.end(), value.begin(), [](unsigned char c) { return static_cast<char>(std::toupper(c)); });
      set(result, field, value);
      changed = true;
    } else if (op == "lowercase") {
      std::transform(value.begin(), value.end(), value.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
      set(result, field, value);
      changed = true;
    } else if (op == "trim") {
      set(result, field, str(string_trim(value)));
      changed = true;
    } else if (op.rfind("prefix:", 0) == 0) {
      set(result, field, op.substr(7) + value);
      changed = true;
    } else if (op.rfind("suffix:", 0) == 0) {
      set(result, field, value + op.substr(7));
      changed = true;
    }
  }
  if (changed) {
    Value memory = get(gen, "memory", Value::object());
    Value items = get_key(memory, "items", Value::array());
    Value item(Object{{"role", "processor"}, {"output", result}, {"tags", Value(Array{Value("processor")})}});
    append(items, item);
    set(memory, "items", items);
    set(gen, "memory", memory);
  }
  return result;
}
Value Core::axgen_run_assertions(Value gen, Value output) {
  for (const auto& raw : array_ref(get(gen, "assertions", Value::array()))) {
    std::string assertion_id = str(get_key(raw, "__assertion_id"));
    if (!assertion_id.empty()) {
      auto it = assertion_registry().find(assertion_id);
      if (it != assertion_registry().end()) {
        Value returned = it->second(output);
        if (returned.is_string()) throw AxError("runtime", str(returned));
        if (returned.is_bool() && !truthy(returned)) throw AxError("runtime", "assertion failed");
      }
      continue;
    }
    std::string field = str(get_key(raw, "field"));
    Value value = field.empty() ? output : get_key(output, field);
    std::string message = str(get_key(raw, "message", "assertion failed"));
    Value returned = get_key(raw, "return");
    if (!returned.is_null()) {
      if (returned.is_bool() && !truthy(returned) && get_key(raw, "message").is_null()) throw AxError("runtime", "assertion failed without message");
      if (returned.is_bool() && !truthy(returned)) throw AxError("runtime", message);
      if (returned.is_string()) throw AxError("runtime", str(returned));
    }
    Value contains = get_key(raw, "contains");
    if (!contains.is_null() && str(value).find(str(contains)) == std::string::npos) throw AxError("runtime", message);
    Value equals = get_key(raw, "equals");
    if (!equals.is_null() && !equal(value, equals)) throw AxError("runtime", message);
  }
  return Value();
}
Value Core::axgen_record_trace(Value gen, Value input, Value output, Value status) {
  Value traces = get(gen, "traces", Value::array());
  Value trace = Value::object();
  set(trace, "status", status);
  set(trace, "input", input);
  set(trace, "output", output);
  set(trace, "chat_log", get(gen, "chat_log", Value::array()));
  set(trace, "function_calls", get(gen, "function_call_traces", Value::array()));
  append(traces, trace);
  set(gen, "traces", traces);
  return Value();
}
Value Core::axgen_memory_add_request(Value gen, Value messages) {
  Value memory = get(gen, "memory", Value::object());
  Value items = get_key(memory, "items", Value::array());
  append(items, Value(Object{{"role", "request"}, {"messages", messages}, {"tags", Value::array()}}));
  set(memory, "items", items);
  set(gen, "memory", memory);
  return Value();
}
static bool ax_memory_response_meaningful(const Value& response) {
  if (response.is_array()) {
    for (const auto& item : array_ref(response)) {
      if (ax_memory_response_meaningful(item)) return true;
    }
    return false;
  }
  if (!response.is_object()) return Core::truthy(response);
  Value content = get_key(response, "content");
  if (content.is_string() && !str(Core::string_trim(content)).empty()) return true;
  for (const auto& key : {"function_calls", "functionCalls", "tool_calls", "toolCalls", "thought_blocks", "thoughtBlocks"}) {
    Value value = get_key(response, key);
    if (value.is_array() && !array_ref(value).empty()) return true;
  }
  return has_key(response, "audio") && !get_key(response, "audio").is_null();
}
Value Core::axgen_memory_add_response(Value gen, Value request, Value response) {
  if (!ax_memory_response_meaningful(response)) return Value();
  Value memory = get(gen, "memory", Value::object());
  Value items = get_key(memory, "items", Value::array());
  append(items, Value(Object{{"role", "assistant"}, {"response", response}, {"tags", Value::array()}}));
  set(memory, "items", items);
  set(gen, "memory", memory);
  return Value();
}
Value Core::axgen_memory_add_function_result(Value gen, Value call, Value result, Value ok) {
  Value memory = get(gen, "memory", Value::object());
  Value items = get_key(memory, "items", Value::array());
  append(items, Value(Object{{"role", "function"}, {"results", Value(Array{Value(Object{{"call", call}, {"result", result}, {"ok", Value(truthy(ok))}})})}, {"tags", Value::array()}}));
  set(memory, "items", items);
  set(gen, "memory", memory);
  return Value();
}
Value Core::axgen_memory_add_correction(Value gen, Value response, Value error) {
  Value memory = get(gen, "memory", Value::object());
  Value items = get_key(memory, "items", Value::array());
  append(items, Value(Object{{"role", "user"}, {"content", std::string("Correction: ") + str(exception_message(error))}, {"response", response}, {"tags", Value(Array{Value("correction")})}}));
  set(memory, "items", items);
  set(gen, "memory", memory);
  return Value();
}
Value Core::axgen_memory_cleanup_corrections(Value gen) {
  Value memory = get(gen, "memory", Value::object());
  Array kept;
  for (const auto& item : array_ref(get_key(memory, "items", Value::array()))) {
    bool has = false;
    for (const auto& tag : array_ref(get_key(item, "tags", Value::array()))) if (str(tag) == "correction") has = true;
    if (!has) kept.push_back(item);
  }
  set(memory, "items", Value(kept));
  set(gen, "memory", memory);
  return Value();
}
Value Core::axgen_record_chat_log(Value gen, Value request, Value response) {
  Value chat_log = get(gen, "chat_log", Value::array());
  Value entry(Object{
      {"model", get_key(request, "model")},
      {"messages", get_key(request, "chat_prompt", Value::array())},
      {"response", response},
      {"remote_id", get_key(response, "remote_id", get_key(response, "id"))},
      {"session_id", get_key(response, "session_id")},
      {"usage", get_key(response, "usage", get_key(response, "model_usage"))},
      {"function_calls", get_key(response, "function_calls", Value::array())},
  });
  append(chat_log, entry);
  set(gen, "chat_log", chat_log);
  return Value();
}
Value Core::axgen_record_function_call(Value gen, Value call, Value result, Value status) {
  Value traces = get(gen, "function_call_traces", Value::array());
  Value fn = get_key(call, "function");
  Value record(Object{
      {"name", fn.is_object() ? get_key(fn, "name") : get_key(call, "name")},
      {"id", get_key(call, "id")},
      {"args", get_key(call, "params", get_key(call, "args", Value::object()))},
      {"status", status},
      {"result", result},
  });
  append(traces, record);
  set(gen, "function_call_traces", traces);
  std::string hook_id = str(get_key(get(gen, "options", Value::object()), "__function_hook_id"));
  if (!hook_id.empty()) {
    auto it = function_hook_registry().find(hook_id);
    if (it != function_hook_registry().end()) {
      try { it->second(record); } catch (...) {}
    }
  }
  return Value();
}
Value Core::axgen_should_continue_steps(Value gen, Value calls) {
  std::set<std::string> stops;
  for (const auto& item : array_ref(get(gen, "stop_functions", Value::array()))) stops.insert(str(item));
  if (stops.empty()) return Value(true);
  for (const auto& call : array_ref(calls)) {
    Value fn = get_key(call, "function");
    std::string name = fn.is_object() ? str(get_key(fn, "name")) : str(get_key(call, "name"));
    if (stops.count(name) > 0) return Value(false);
  }
  return Value(true);
}
Value Core::stream_event_content_parts(Value event) {
  if (event.is_string()) return Value(Array{event});
  Value data = event;
  Value nested = get_key(data, "data");
  if (nested.is_object()) data = nested;
  std::string type = str(get_key(data, "type"));
  if (type == "done" || type == "message_stop") return Value::array();
  if (!get_key(data, "results").is_null()) {
    Array out;
    for (const auto& result : array_ref(get_key(data, "results"))) out.emplace_back(str(get_key(result, "content", "")));
    return Value(out);
  }
  return Value(Array{get_key(data, "delta", get_key(data, "content_delta", get_key(data, "contentDelta", get_key(data, "text", get_key(data, "content", "")))) )});
}

Value Core::openai_normalize_chat_response(Value raw) { return openai_normalize_chat_response(std::move(raw), "openai", Value()); }
Value Core::openai_normalize_stream_delta(Value raw, Value state) { return openai_normalize_stream_delta(std::move(raw), std::move(state), "openai", Value()); }
Value Core::openai_normalize_embed_response(Value raw) { return openai_normalize_embed_response(std::move(raw), "openai", Value()); }

// AXIR_CORE_CPP_FUNCTIONS

Value parse_json(const std::string& source) {
  struct Parser {
    std::string s;
    size_t pos = 0;
    explicit Parser(std::string src) : s(std::move(src)) {}
    void skip() { while (pos < s.size() && std::isspace(static_cast<unsigned char>(s[pos]))) ++pos; }
    char peek() { skip(); return pos < s.size() ? s[pos] : '\0'; }
    bool match(char c) { skip(); if (pos < s.size() && s[pos] == c) { ++pos; return true; } return false; }
    void expect(char c) { skip(); if (pos >= s.size() || s[pos] != c) throw AxError("json", std::string("expected ") + c); ++pos; }
    Value value() {
      skip();
      if (match('{')) return object();
      if (match('[')) return array();
      if (peek() == '"') return string();
      if (s.compare(pos, 4, "true") == 0) { pos += 4; return Value(true); }
      if (s.compare(pos, 5, "false") == 0) { pos += 5; return Value(false); }
      if (s.compare(pos, 4, "null") == 0) { pos += 4; return Value(); }
      return number();
    }
    Value object() {
      Object out;
      Array order;
      skip(); if (match('}')) return Value(out);
      while (true) {
        std::string k = str(string());
        expect(':');
        order.emplace_back(k);
        out[k] = value();
        out["__order"] = order;
        skip();
        if (match('}')) return Value(out);
        expect(',');
      }
    }
    Value array() {
      Array out;
      skip(); if (match(']')) return Value(out);
      while (true) {
        out.push_back(value());
        skip();
        if (match(']')) return Value(out);
        expect(',');
      }
    }
    static unsigned read_hex4(const std::string& s, size_t& pos) {
      unsigned value = 0;
      for (int i = 0; i < 4 && pos < s.size(); ++i) {
        char h = s[pos++];
        value <<= 4;
        if (h >= '0' && h <= '9') value |= static_cast<unsigned>(h - '0');
        else if (h >= 'a' && h <= 'f') value |= static_cast<unsigned>(h - 'a' + 10);
        else if (h >= 'A' && h <= 'F') value |= static_cast<unsigned>(h - 'A' + 10);
      }
      return value;
    }
    static void append_utf8(std::string& out, unsigned cp) {
      if (cp <= 0x7F) {
        out.push_back(static_cast<char>(cp));
      } else if (cp <= 0x7FF) {
        out.push_back(static_cast<char>(0xC0 | (cp >> 6)));
        out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
      } else if (cp <= 0xFFFF) {
        out.push_back(static_cast<char>(0xE0 | (cp >> 12)));
        out.push_back(static_cast<char>(0x80 | ((cp >> 6) & 0x3F)));
        out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
      } else {
        out.push_back(static_cast<char>(0xF0 | (cp >> 18)));
        out.push_back(static_cast<char>(0x80 | ((cp >> 12) & 0x3F)));
        out.push_back(static_cast<char>(0x80 | ((cp >> 6) & 0x3F)));
        out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
      }
    }
    Value string() {
      expect('"');
      std::string out;
      while (pos < s.size()) {
        char c = s[pos++];
        if (c == '"') break;
        if (c == '\\' && pos < s.size()) {
          char e = s[pos++];
          if (e == 'n') { out.push_back('\n'); continue; }
          if (e == 't') { out.push_back('\t'); continue; }
          if (e == 'r') { out.push_back('\r'); continue; }
          if (e == 'b') { out.push_back('\b'); continue; }
          if (e == 'f') { out.push_back('\f'); continue; }
          if (e == 'u') {
            unsigned cp = read_hex4(s, pos);
            // Combine UTF-16 surrogate pairs into a single code point.
            if (cp >= 0xD800 && cp <= 0xDBFF && pos + 1 < s.size() && s[pos] == '\\' && s[pos + 1] == 'u') {
              pos += 2;
              unsigned low = read_hex4(s, pos);
              if (low >= 0xDC00 && low <= 0xDFFF) {
                cp = 0x10000 + ((cp - 0xD800) << 10) + (low - 0xDC00);
              }
            }
            append_utf8(out, cp);
            continue;
          }
          out.push_back(e);
          continue;
        }
        out.push_back(c);
      }
      return Value(out);
    }
    Value number() {
      size_t start = pos;
      if (pos < s.size() && s[pos] == '-') ++pos;
      while (pos < s.size() && std::isdigit(static_cast<unsigned char>(s[pos]))) ++pos;
      if (pos < s.size() && s[pos] == '.') { ++pos; while (pos < s.size() && std::isdigit(static_cast<unsigned char>(s[pos]))) ++pos; }
      if (pos < s.size() && (s[pos] == 'e' || s[pos] == 'E')) { ++pos; if (pos < s.size() && (s[pos] == '+' || s[pos] == '-')) ++pos; while (pos < s.size() && std::isdigit(static_cast<unsigned char>(s[pos]))) ++pos; }
      std::string token = s.substr(start, pos - start);
      // Tolerate malformed/empty numeric tokens (e.g. a model emitting a bare `-` or an
      // empty value for a number field) instead of throwing std::stod's "no conversion".
      try {
        return Value(std::stod(token));
      } catch (const std::exception&) {
        if (pos == start && pos < s.size()) ++pos;  // ensure forward progress
        return Value();
      }
    }
  };
  Parser p(source);
  return p.value();
}

std::string display(const Value& value) {
  if (auto p = std::get_if<double>(&value.data)) {
    if (std::floor(*p) == *p) return std::to_string(static_cast<long long>(*p));
    std::ostringstream ss; ss << *p; return ss.str();
  }
  return str(value);
}

static std::string escape_json(const std::string& in) {
  std::string out;
  for (char c : in) {
    if (c == '"') out += "\\\"";
    else if (c == '\\') out += "\\\\";
    else if (c == '\n') out += "\\n";
    else out.push_back(c);
  }
  return out;
}

std::string stringify(const Value& value) {
  if (value.is_null()) return "null";
  if (auto p = std::get_if<bool>(&value.data)) return *p ? "true" : "false";
  if (value.is_number()) return display(value);
  if (auto p = std::get_if<std::string>(&value.data)) return "\"" + escape_json(*p) + "\"";
  if (auto p = std::get_if<std::shared_ptr<Array>>(&value.data)) {
    std::string out = "[";
    for (size_t i = 0; i < (*p)->size(); ++i) { if (i) out += ","; out += stringify((**p)[i]); }
    return out + "]";
  }
  std::string out = "{";
  size_t i = 0;
  for (const auto& kv : entries(value)) { if (i++) out += ","; out += "\"" + escape_json(kv.first) + "\":" + stringify(kv.second); }
  return out + "}";
}

static std::string stable_stringify(const Value& value) {
  if (value.is_null()) return "null";
  if (auto p = std::get_if<bool>(&value.data)) return *p ? "true" : "false";
  if (value.is_number()) return display(value);
  if (auto p = std::get_if<std::string>(&value.data)) return "\"" + escape_json(*p) + "\"";
  if (auto p = std::get_if<std::shared_ptr<Array>>(&value.data)) {
    std::string out = "[";
    for (size_t i = 0; i < (*p)->size(); ++i) { if (i) out += ","; out += stable_stringify((**p)[i]); }
    return out + "]";
  }
  std::string out = "{";
  size_t i = 0;
  for (const auto& kv : object_ref(value)) {
    if (kv.first == "__order") continue;
    if (i++) out += ",";
    out += "\"" + escape_json(kv.first) + "\":" + stable_stringify(kv.second);
  }
  return out + "}";
}

bool equal(const Value& left, const Value& right) {
  if (left.is_number() && right.is_number()) return std::fabs(num(left) - num(right)) < 0.0000001;
  if (left.data.index() != right.data.index()) return false;
  if (left.is_null()) return true;
  if (left.is_bool()) return std::get<bool>(left.data) == std::get<bool>(right.data);
  if (left.is_string()) return std::get<std::string>(left.data) == std::get<std::string>(right.data);
  if (left.is_array()) {
    const auto& a = array_ref(left); const auto& b = array_ref(right);
    if (a.size() != b.size()) return false;
    for (size_t i = 0; i < a.size(); ++i) if (!equal(a[i], b[i])) return false;
    return true;
  }
  auto a = object_ref(left); auto b = object_ref(right);
  a.erase("__order"); b.erase("__order");
  if (a.size() != b.size()) return false;
  for (const auto& kv : a) { auto it = b.find(kv.first); if (it == b.end() || !equal(kv.second, it->second)) return false; }
  return true;
}

Value AIClient::chat(Value request) {
  return Core::legacy_response_to_chat_response(complete(std::move(request)));
}

std::string AxAIService::get_id() { return get_name() + "-id"; }
std::string AxAIService::get_name() { return "ai"; }
Value AxAIService::chat(Value request) { return AIClient::chat(std::move(request)); }
Value AxAIService::chat(Value request, Value) { return chat(std::move(request)); }
std::vector<Value> AxAIService::stream(Value request) { return {chat(std::move(request))}; }
Value AxAIService::embed(Value request, Value) { return embed(std::move(request)); }
Value AxAIService::transcribe(Value request, Value) { return transcribe(std::move(request)); }
Value AxAIService::speak(Value request, Value) { return speak(std::move(request)); }
Value AxAIService::get_features(Value) {
  return Value(Object{{"functions", true}, {"streaming", true}, {"structured_outputs", true}, {"multi_turn", true}});
}
Value AxAIService::get_model_list() { return Value::array(); }
Value AxAIService::get_metrics() { return Value::object(); }
std::function<void(std::string)> AxAIService::get_logger() { return [](std::string) {}; }
double AxAIService::get_estimated_cost(Value) { return 0.0; }
Value AxAIService::get_options() { return Value::object(); }
void AxAIService::set_options(Value) {}
Value AxAIService::get_last_used_chat_model() { return Value(); }
Value AxAIService::get_last_used_embed_model() { return Value(); }
Value AxAIService::get_last_used_model_config() { return Value(); }

AxBaseAI::AxBaseAI(std::string name, std::string model, std::string embed_model, Value model_config, Value options)
    : name_(std::move(name)),
      model_(std::move(model)),
      embed_model_(std::move(embed_model)),
      model_config_(Value(Object{{"temperature", 0}})),
      options_(std::move(options)) {
  if (model_.empty()) throw AxError("runtime", "No model defined");
  model_config_ = Core::map_merge(model_config_, std::move(model_config));
}

Value AxBaseAI::chat(Value request) {
  return chat(std::move(request), options_);
}

Value AxBaseAI::chat(Value request, Value call_options) {
  Value req = Core::coerce_chat_request(std::move(request));
  Core::validate_chat_request(req);
  Value merged_options = Core::map_merge(options_, std::move(call_options));
  Value selected_model = Core::coalesce(Core::get(req, "model"), model_);
  Value merged_config = Core::merge_model_config(model_config_, Core::get(req, "model_config"), merged_options);
  Core::set(req, "model", selected_model);
  Core::set(req, "model_config", merged_config);
  last_used_chat_model_ = selected_model;
  last_used_model_config_ = merged_config;
  return do_chat(req, merged_options);
}

Value AxBaseAI::complete(Value request) {
  return Core::chat_response_to_completion(chat(Core::coerce_chat_request(std::move(request))));
}

Value AxBaseAI::embed(Value request) {
  return embed(std::move(request), options_);
}

Value AxBaseAI::embed(Value request, Value call_options) {
  Value texts = Core::get(request, "texts");
  if (!texts.is_array() || array_ref(texts).empty()) throw Core::as_error(Core::ai_error_response("Embed texts is empty"));
  Value selected = Core::get(request, "embed_model", Core::get(request, "embedModel", embed_model_));
  if (!Core::truthy(selected)) throw Core::as_error(Core::ai_error_response("Embed model not set"));
  Value req(object_ref(request));
  Core::set(req, "embed_model", selected);
  last_used_embed_model_ = selected;
  Value merged_options = Core::map_merge(options_, std::move(call_options));
  return do_embed(req, merged_options);
}

Value AxBaseAI::get_features(Value) { return AxAIService::get_features(Value()); }
std::string AxBaseAI::get_id() { return name_ + "-id"; }
std::string AxBaseAI::get_name() { return name_; }
Value AxBaseAI::get_model_list() {
  Value out = Value::array();
  if (!model_.empty()) Core::append(out, object({{"key", model_}, {"description", name_ + " chat model"}, {"model", model_}}));
  if (!embed_model_.empty()) Core::append(out, object({{"key", embed_model_}, {"description", name_ + " embed model"}, {"embedModel", embed_model_}}));
  return out;
}
Value AxBaseAI::get_metrics() { return Value::object(); }
Value AxBaseAI::get_options() { return options_; }
void AxBaseAI::set_options(Value options) { options_ = std::move(options); }
Value AxBaseAI::get_last_used_chat_model() { return last_used_chat_model_; }
Value AxBaseAI::get_last_used_embed_model() { return last_used_embed_model_; }
Value AxBaseAI::get_last_used_model_config() { return last_used_model_config_; }

static std::string option_string(Value options, const std::string& snake, const std::string& camel, const std::string& fallback) {
  Value value = Core::get(options, snake, Core::get(options, camel));
  return value.is_null() ? fallback : display(value);
}

static std::string env_or_default(const char* name, const std::string& fallback) {
  const char* value = std::getenv(name);
  return value == nullptr ? fallback : std::string(value);
}

static std::string strip_trailing_slashes(std::string value) {
  while (!value.empty() && value.back() == '/') value.pop_back();
  return value;
}

static std::string url_component(std::string value) {
  std::ostringstream out;
  for (unsigned char ch : value) {
    if (std::isalnum(ch) || ch == '-' || ch == '_' || ch == '.' || ch == '~') {
      out << static_cast<char>(ch);
    } else {
      out << '%' << std::uppercase << std::hex << std::setw(2) << std::setfill('0') << static_cast<int>(ch) << std::nouppercase << std::dec;
    }
  }
  return out.str();
}

OpenAICompatibleClient::OpenAICompatibleClient(Value options, Transport* transport)
    : OpenAICompatibleClient("openai-compatible", "openai", std::move(options), transport, "gpt-4.1-mini", "text-embedding-3-small") {}

OpenAICompatibleClient::OpenAICompatibleClient(std::string profile, std::string name, Value options, Transport* transport, std::string default_model, std::string default_embed_model)
    : AxBaseAI(
          std::move(name),
          option_string(options, "model", "model", default_model),
          option_string(options, "embed_model", "embedModel", default_embed_model),
          Core::get(options, "model_config", Value::object()),
          Core::get(options, "options", Value::object())),
      profile_(std::move(profile)),
      descriptor_(Core::provider_descriptor(profile_)),
      base_url_(strip_trailing_slashes(option_string(options, "base_url", "baseUrl", env_or_default("OPENAI_BASE_URL", str(Core::get(Core::provider_descriptor(profile_), "baseUrl", "https://api.openai.com/v1")))))),
      api_key_(option_string(options, "api_key", "apiKey", env_or_default("OPENAI_API_KEY", ""))),
      api_version_(option_string(options, "api_version", "apiVersion", str(Core::get(descriptor_, "apiVersion", "")))),
      timeout_seconds_(Core::get(options, "timeout", 60).is_number() ? num(Core::get(options, "timeout", 60)) : 60.0),
      transport_(transport) {
  if (transport_ == nullptr) {
    owned_transport_ = std::make_unique<HttpTransport>();
    transport_ = owned_transport_.get();
  }
}

OpenAIResponsesClient::OpenAIResponsesClient(Value options, Transport* transport)
    : OpenAICompatibleClient("openai-responses", "openai-responses", std::move(options), transport, "gpt-4o", "text-embedding-ada-002") {}

GoogleGeminiClient::GoogleGeminiClient(Value options, Transport* transport)
    : OpenAICompatibleClient("google-gemini", "GoogleGeminiAI", [&]() {
        Value out = std::move(options);
        if (Core::get(out, "api_key").is_null() && Core::get(out, "apiKey").is_null()) Core::set(out, "api_key", env_or_default("GOOGLE_API_KEY", env_or_default("GEMINI_API_KEY", "")));
        if (Core::get(out, "base_url").is_null() && Core::get(out, "baseUrl").is_null()) Core::set(out, "base_url", env_or_default("GOOGLE_GEMINI_BASE_URL", "https://generativelanguage.googleapis.com/v1beta"));
        return out;
      }(), transport, "gemini-2.5-flash", "gemini-embedding-2") {}

AnthropicClient::AnthropicClient(Value options, Transport* transport)
    : OpenAICompatibleClient("anthropic", "anthropic", [&]() {
        Value out = std::move(options);
        if (Core::get(out, "api_key").is_null() && Core::get(out, "apiKey").is_null()) Core::set(out, "api_key", env_or_default("ANTHROPIC_API_KEY", ""));
        if (Core::get(out, "base_url").is_null() && Core::get(out, "baseUrl").is_null()) Core::set(out, "base_url", env_or_default("ANTHROPIC_BASE_URL", "https://api.anthropic.com"));
        return out;
      }(), transport, "claude-3-7-sonnet-latest", "") {}

AzureOpenAIClient::AzureOpenAIClient(Value options, Transport* transport)
    : OpenAICompatibleClient("azure-openai", "Azure OpenAI", [&]() {
        Value out = std::move(options);
        if (Core::get(out, "api_key").is_null() && Core::get(out, "apiKey").is_null()) Core::set(out, "api_key", env_or_default("AZURE_OPENAI_API_KEY", ""));
        std::string version = option_string(out, "api_version", "apiVersion", option_string(out, "version", "version", "2024-02-15-preview"));
        std::string marker = "api-version=";
        auto idx = version.find(marker);
        if (idx != std::string::npos) {
          version = version.substr(idx + marker.size());
          auto amp = version.find('&');
          if (amp != std::string::npos) version = version.substr(0, amp);
        }
        Core::set(out, "api_version", version);
        if (Core::get(out, "base_url").is_null() && Core::get(out, "baseUrl").is_null()) {
          std::string env_base = env_or_default("AZURE_OPENAI_BASE_URL", "");
          if (!env_base.empty()) {
            Core::set(out, "base_url", env_base);
          } else {
            std::string resource = option_string(out, "resource_name", "resourceName", env_or_default("AZURE_OPENAI_RESOURCE_NAME", ""));
            std::string deployment = option_string(out, "deployment_name", "deploymentName", env_or_default("AZURE_OPENAI_DEPLOYMENT_NAME", ""));
            if (!resource.empty() && !deployment.empty()) {
              std::string host = resource.find("://") == std::string::npos ? "https://" + resource + ".openai.azure.com" : resource;
              Core::set(out, "base_url", strip_trailing_slashes(host) + "/openai/deployments/" + url_component(deployment));
            }
          }
        }
        return out;
      }(), transport, "gpt-5-mini", "text-embedding-3-small") {}

DeepSeekClient::DeepSeekClient(Value options, Transport* transport)
    : OpenAICompatibleClient("deepseek", "DeepSeek", [&]() {
        Value out = std::move(options);
        if (Core::get(out, "api_key").is_null() && Core::get(out, "apiKey").is_null()) Core::set(out, "api_key", env_or_default("DEEPSEEK_API_KEY", ""));
        if (Core::get(out, "base_url").is_null() && Core::get(out, "baseUrl").is_null()) Core::set(out, "base_url", env_or_default("DEEPSEEK_BASE_URL", "https://api.deepseek.com"));
        return out;
      }(), transport, "deepseek-v4-flash", "") {}

MistralClient::MistralClient(Value options, Transport* transport)
    : OpenAICompatibleClient("mistral", "Mistral", [&]() {
        Value out = std::move(options);
        if (Core::get(out, "api_key").is_null() && Core::get(out, "apiKey").is_null()) Core::set(out, "api_key", env_or_default("MISTRAL_API_KEY", ""));
        if (Core::get(out, "base_url").is_null() && Core::get(out, "baseUrl").is_null()) Core::set(out, "base_url", env_or_default("MISTRAL_BASE_URL", "https://api.mistral.ai/v1"));
        return out;
      }(), transport, "mistral-small-latest", "mistral-embed") {}

RekaClient::RekaClient(Value options, Transport* transport)
    : OpenAICompatibleClient("reka", "Reka", [&]() {
        Value out = std::move(options);
        if (Core::get(out, "api_key").is_null() && Core::get(out, "apiKey").is_null()) Core::set(out, "api_key", env_or_default("REKA_API_KEY", ""));
        if (Core::get(out, "base_url").is_null() && Core::get(out, "baseUrl").is_null()) Core::set(out, "base_url", env_or_default("REKA_BASE_URL", "https://api.reka.ai/v1"));
        return out;
      }(), transport, "reka-core", "") {}

CohereClient::CohereClient(Value options, Transport* transport)
    : OpenAICompatibleClient("cohere", "Cohere", [&]() {
        Value out = std::move(options);
        if (Core::get(out, "api_key").is_null() && Core::get(out, "apiKey").is_null()) Core::set(out, "api_key", env_or_default("COHERE_API_KEY", ""));
        if (Core::get(out, "base_url").is_null() && Core::get(out, "baseUrl").is_null()) Core::set(out, "base_url", env_or_default("COHERE_BASE_URL", "https://api.cohere.ai/compatibility/v1"));
        return out;
      }(), transport, "command-r-plus", "embed-english-v3.0") {}

GrokClient::GrokClient(Value options, Transport* transport)
    : OpenAICompatibleClient("grok", "Grok", [&]() {
        Value out = std::move(options);
        if (Core::get(out, "api_key").is_null() && Core::get(out, "apiKey").is_null()) Core::set(out, "api_key", env_or_default("XAI_API_KEY", env_or_default("GROK_API_KEY", "")));
        if (Core::get(out, "base_url").is_null() && Core::get(out, "baseUrl").is_null()) Core::set(out, "base_url", env_or_default("XAI_BASE_URL", env_or_default("GROK_BASE_URL", "https://api.x.ai/v1")));
        return out;
      }(), transport, "grok-4.3", "") {}

Value OpenAICompatibleClient::do_chat(Value request, Value options) {
  Value realtime_model = Core::coalesce(Core::get(request, "model"), Value(model_));
  if (Core::truthy(Core::provider_should_use_realtime(profile_, realtime_model, request))) {
    return realtime_chat(request, nullptr);
  }
  (void)options;
  Value payload = Core::provider_build_chat_request(profile_, request);
  bool stream = Core::truthy(Core::get(payload, "stream"));
  if (stream) {
    Value model = Core::coalesce(Core::get(request, "model"), Core::coalesce(Core::get(payload, "model"), model_));
    Value raw = request_json(operation_path("stream_chat", model), payload, true);
    Value state = Value::object();
    Value results = Value::array();
    for (const auto& event : iter_sse_json(raw)) {
      Core::append(results, Core::provider_normalize_stream_delta(profile_, event, state, name_, model));
    }
    return Value(Object{{"results", results}});
  }
  Value model = Core::coalesce(Core::get(request, "model"), Core::coalesce(Core::get(payload, "model"), model_));
  Value raw = request_json(operation_path("chat", model), payload, false);
  return Core::provider_normalize_chat_response(profile_, raw, name_, model);
}

Value OpenAICompatibleClient::do_embed(Value request, Value) {
  Value payload = Core::provider_build_embed_request(profile_, request);
  Value model = Core::coalesce(Core::get(request, "embed_model"), Core::coalesce(Core::get(request, "embedModel"), Core::coalesce(Core::get(payload, "model"), embed_model_)));
  Value raw = request_json(operation_path("embed", model), payload, false);
  return Core::provider_normalize_embed_response(profile_, raw, name_, model);
}

std::vector<Value> OpenAICompatibleClient::stream(Value request) {
  Value req = Core::coerce_chat_request(std::move(request));
  Core::validate_chat_request(req);
  Value config = Core::merge_model_config(model_config_, Core::get(req, "model_config"), Value(Object{{"stream", true}}));
  Core::set(config, "stream", true);
  Core::set(req, "model", Core::coalesce(Core::get(req, "model"), model_));
  Core::set(req, "model_config", config);
  Value payload = Core::provider_build_chat_request(profile_, req);
  Value model = Core::get(req, "model", Core::get(payload, "model", model_));
  Value retry_cfg = Core::resolve_stream_retry(options_);
  int max_retries = static_cast<int>(num(Core::get(retry_cfg, "max_retries", 3)));
  double initial_delay = num(Core::get(retry_cfg, "initial_delay_ms", 1000));
  double max_delay = num(Core::get(retry_cfg, "max_delay_ms", 60000));
  double backoff = num(Core::get(retry_cfg, "backoff_factor", 2));
  int attempt = 0;
  while (true) {
    Value raw = request_json(operation_path("stream_chat", model), payload, true);
    std::vector<Value> events = iter_sse_json(raw);
    // Pre-content streaming retry: peek the first raw SSE event before any stateful normalize
    // runs (so peeking has no side effects); if the provider classifies it as a retryable
    // transient status (e.g. Anthropic's HTTP-200 overloaded_error event), re-issue with the
    // same exponential backoff apiCall uses for a 529 before surfacing.
    if (!events.empty()) {
      Value status = Core::provider_classify_stream_error_status(profile_, events[0]);
      if (!status.is_null() && Core::truthy(Core::is_retryable_status(status)) && attempt < max_retries) {
        attempt++;
        double delay = std::min(initial_delay * std::pow(backoff, attempt - 1), max_delay);
        if (delay > 0) std::this_thread::sleep_for(std::chrono::milliseconds(static_cast<long>(delay)));
        continue;
      }
    }
    Value state = Value::object();
    std::vector<Value> out;
    for (const auto& event : events) out.push_back(Core::provider_normalize_stream_delta(profile_, event, state, name_, model));
    return out;
  }
}

Value OpenAICompatibleClient::transcribe(Value request) {
  Value payload = Core::provider_build_transcribe_request(profile_, request);
  Value model = Core::get(request, "model", model_);
  std::string body_key = str(Core::get(Core::provider_operation_descriptor(profile_, "transcribe"), "body", "json")) == "multipart" ? "data" : "json";
  Value raw = request_json(operation_path("transcribe", model), payload, false, body_key);
  return Core::provider_normalize_transcribe_response(profile_, raw);
}

Value OpenAICompatibleClient::speak(Value request) {
  Value payload = Core::provider_build_speak_request(profile_, request);
  Value model = Core::get(request, "model", model_);
  Value descriptor = Core::provider_operation_descriptor(profile_, "speak");
  std::string body_key = str(Core::get(descriptor, "body", "json")) == "multipart" ? "data" : "json";
  // OpenAI /audio/speech returns raw binary audio (mp3); the transport returns
  // it as base64 instead of JSON-parsing, and the normalizer reads raw["audio"].
  bool binary = str(Core::get(descriptor, "response", Value(""))) == "binary";
  Value raw = request_json(operation_path("speak", model), payload, false, body_key, binary);
  return Core::provider_normalize_speak_response(profile_, raw, request);
}

std::vector<Value> OpenAICompatibleClient::realtime(Value events) {
  std::vector<Value> out;
  Value state = Value::object();
  for (const auto& event : array_ref(events)) out.push_back(Core::provider_normalize_realtime_event(profile_, event, state, name_, model_));
  return out;
}

Value OpenAICompatibleClient::realtime_audio_setup(Value request) {
  return Core::provider_build_realtime_audio_setup(profile_, request);
}

Value OpenAICompatibleClient::realtime_audio_input(Value request) {
  return Core::provider_build_realtime_audio_input(profile_, request);
}

namespace {

bool realtime_event_is_ready(const Value& event) {
  std::string type = str(Core::get(event, "type", Value("")));
  if (type == "session.created" || type == "session.updated" || type == "transcription_session.created" || type == "transcription_session.updated") return true;
  return !Core::get(event, "setupComplete").is_null();
}

bool realtime_event_is_done(const Value& event) {
  std::string type = str(Core::get(event, "type", Value("")));
  if (type == "response.done" || type == "response.completed") return true;
  Value server_content = Core::get(event, "serverContent");
  return !server_content.is_null() && Core::truthy(Core::get(server_content, "turnComplete", Value(false)));
}

struct RealtimeWsTarget {
  std::string url;
  std::vector<std::pair<std::string, std::string>> headers;
};

RealtimeWsTarget realtime_ws_target(const std::string& profile, const std::string& api_key, const std::string& model) {
  // Grammar-specific URL + auth construction lives in Core so the client stays
  // provider-agnostic.
  Value result = Core::provider_realtime_ws_url(Value(profile), Value(model), Value(api_key));
  RealtimeWsTarget target;
  target.url = str(Core::get(result, "url", Value("")));
  Value headers = Core::get(result, "headers");
  for (const auto& key : array_ref(Core::map_keys(headers))) {
    target.headers.push_back({str(key), str(Core::get(headers, key, Value("")))});
  }
  return target;
}

#if defined(AXLLM_ENABLE_REALTIME)
// Live transport over IXWebSocket: the on-message callback fires on a background
// thread and enqueues whole text frames; recv() drains the queue on the calling
// thread (mirrors the Transport/HTTP split, gated by AXLLM_ENABLE_REALTIME).
class WsRealtimeTransport : public RealtimeTransport {
 public:
  WsRealtimeTransport(const std::string& url, const std::vector<std::pair<std::string, std::string>>& headers) {
    socket_.setUrl(url);
    ix::WebSocketHttpHeaders ws_headers;
    for (const auto& header : headers) ws_headers[header.first] = header.second;
    socket_.setExtraHeaders(ws_headers);
    socket_.disableAutomaticReconnection();
    socket_.setOnMessageCallback([this](const ix::WebSocketMessagePtr& message) {
      std::lock_guard<std::mutex> lock(mutex_);
      if (message->type == ix::WebSocketMessageType::Message) queue_.push_back(message->str);
      else if (message->type == ix::WebSocketMessageType::Close || message->type == ix::WebSocketMessageType::Error) closed_ = true;
      cv_.notify_one();
    });
    socket_.start();
  }
  void send(const Value& event) override { socket_.send(str(Core::json_stringify(event))); }
  bool recv(Value& out) override {
    std::unique_lock<std::mutex> lock(mutex_);
    if (!cv_.wait_for(lock, std::chrono::seconds(30), [this] { return !queue_.empty() || closed_; })) return false;
    if (queue_.empty()) return false;
    std::string raw = queue_.front();
    queue_.pop_front();
    lock.unlock();
    out = parse_json(raw);
    return true;
  }
  void close() override { socket_.stop(); }

 private:
  ix::WebSocket socket_;
  std::mutex mutex_;
  std::condition_variable cv_;
  std::deque<std::string> queue_;
  bool closed_ = false;
};
#endif

}  // namespace

ScriptedRealtimeTransport::ScriptedRealtimeTransport(std::vector<Value> inbound) : inbound_(std::move(inbound)) {}
void ScriptedRealtimeTransport::send(const Value& event) { sent.push_back(event); }
bool ScriptedRealtimeTransport::recv(Value& out) {
  if (index_ >= inbound_.size()) return false;
  out = inbound_[index_++];
  return true;
}

Value OpenAICompatibleClient::realtime_chat(Value request, RealtimeTransport* transport) {
  std::string model = str(Core::get(request, "model", Value(model_)));
  Value setup = Core::provider_build_realtime_audio_setup(profile_, request);
  Value inputs = Core::provider_build_realtime_audio_input(profile_, request);
  std::unique_ptr<RealtimeTransport> owned;
  if (transport == nullptr) {
#if defined(AXLLM_ENABLE_REALTIME)
    RealtimeWsTarget target = realtime_ws_target(profile_, api_key_, model);
    owned = std::make_unique<WsRealtimeTransport>(target.url, target.headers);
    transport = owned.get();
#else
    throw Core::as_error(Core::ai_error_unsupported("C++ realtime audio requires the built-in IXWebSocket transport. Build with CMake and AXLLM_ENABLE_REALTIME=ON, or pass a custom RealtimeTransport."));
#endif
  }
  std::vector<Value> events;
  Value event;
  bool input_sent = false;
  try {
    transport->send(setup);
    while (transport->recv(event)) {
      if (str(Core::get(event, "type", Value(""))) == "error") {
        Value error = Core::get(event, "error");
        std::string message = error.is_null() ? "realtime error" : str(Core::get(error, "message", Value("realtime error")));
        throw Core::as_error(Core::ai_error_response(message));
      }
      if (realtime_event_is_ready(event)) {
        if (!input_sent) {
          input_sent = true;
          for (const auto& item : array_ref(inputs)) transport->send(item);
        }
        continue;
      }
      bool done = realtime_event_is_done(event);
      events.push_back(event);
      if (done) break;
    }
  } catch (...) {
    if (owned) transport->close();
    throw;
  }
  if (owned) transport->close();

  Value state = Value::object();
  std::string content;
  std::string audio_bytes;
  bool has_audio = false;
  Value function_calls = Value::array();
  std::string response_id;
  std::string finish_reason;
  Value model_usage;
  for (const auto& folded_event : events) {
    Value normalized = Core::provider_normalize_realtime_event(profile_, folded_event, state, name_, model);
    Array results = array_ref(Core::get(normalized, "results", Value::array()));
    if (results.empty()) continue;
    Value result_value = results[0];
    Value content_value = Core::get(result_value, "content");
    if (!content_value.is_null()) content += str(content_value);
    Value audio = Core::get(result_value, "audio");
    if (!audio.is_null()) {
      std::string data = str(Core::get(audio, "data", Value("")));
      if (!data.empty()) {
        audio_bytes += axir_base64_decode(data);
        has_audio = true;
      }
    }
    for (const auto& call : array_ref(Core::get(result_value, "function_calls", Value::array()))) Core::append(function_calls, call);
    Value finish_value = Core::get(result_value, "finish_reason");
    if (!finish_value.is_null() && !str(finish_value).empty()) finish_reason = str(finish_value);
    Value remote_id = Core::get(normalized, "remote_id", Core::get(result_value, "id"));
    if (!remote_id.is_null() && !str(remote_id).empty() && str(remote_id) != "0") response_id = str(remote_id);
    Value usage = Core::get(normalized, "model_usage");
    if (!usage.is_null()) model_usage = usage;
  }
  if (response_id.empty()) response_id = "realtime";
  if (finish_reason.empty()) finish_reason = "stop";
  Value result = Value::object();
  Core::set(result, "index", Value(0));
  Core::set(result, "id", Value(response_id));
  Core::set(result, "content", Value(content));
  Core::set(result, "function_calls", function_calls);
  Core::set(result, "finish_reason", Value(finish_reason));
  if (has_audio) {
    Value audio_map = Value::object();
    Core::set(audio_map, "data", Value(axir_base64_encode(audio_bytes)));
    Core::set(audio_map, "format", Value("pcm16"));
    Core::set(audio_map, "transcript", Value(content));
    Core::set(result, "audio", audio_map);
  }
  Value response = Value::object();
  Value results_array = Value::array();
  Core::append(results_array, result);
  Core::set(response, "results", results_array);
  Core::set(response, "remote_id", Value(response_id));
  Core::set(response, "model_usage", model_usage);
  return response;
}

Value OpenAICompatibleClient::headers() const {
  Value headers = Value::object();
  Core::set(headers, "Content-Type", "application/json");
  if (str(Core::get(descriptor_, "auth")) == "bearer") Core::set(headers, "Authorization", "Bearer " + api_key_);
  if (str(Core::get(descriptor_, "auth")) == "anthropic_key") Core::set(headers, "x-api-key", api_key_);
  if (str(Core::get(descriptor_, "auth")) == "api_key_header") Core::set(headers, str(Core::get(descriptor_, "apiKeyHeader", "api-key")), api_key_);
  for (const auto& entry : object_ref(Core::get(descriptor_, "headers", Value::object()))) {
    Core::set(headers, entry.first, str(entry.second));
  }
  return headers;
}

Value OpenAICompatibleClient::request_json(const std::string& endpoint, Value payload, bool stream) {
  return request_json(endpoint, std::move(payload), stream, "json", false);
}

Value OpenAICompatibleClient::request_json(const std::string& endpoint, Value payload, bool stream, const std::string& body_key) {
  return request_json(endpoint, std::move(payload), stream, body_key, false);
}

Value OpenAICompatibleClient::request_json(const std::string& endpoint, Value payload, bool stream, const std::string& body_key, bool binary_response) {
  Value call = Value::object();
  Core::set(call, "method", "POST");
  Core::set(call, "url", base_url_ + endpoint);
  Core::set(call, "headers", headers());
  Core::set(call, body_key.empty() ? "json" : body_key, payload);
  Core::set(call, "stream", stream);
  // Signals the transport to return the raw body as base64 instead of JSON.
  if (binary_response) Core::set(call, "binary", Value(true));
  Core::set(call, "timeout", timeout_seconds_);
  if (api_key_.empty() || api_key_ == "null") throw Core::as_error(Core::ai_error_auth("OPENAI_API_KEY is required", Value(), Value(), Value(), call));
  if (transport_ != nullptr) return transport_result(transport_->call(call), call);
  throw Core::as_error(Core::ai_error_unsupported("C++ HTTP transport is not available; build with AXLLM_ENABLE_CURL=ON or pass a custom Transport"));
}

std::string OpenAICompatibleClient::operation_path(const std::string& operation) const {
  return operation_path(operation, Value());
}

std::string OpenAICompatibleClient::operation_path(const std::string& operation, Value model) const {
  std::string path = str(Core::get(Core::provider_operation_descriptor(profile_, operation), "path", "/" + operation));
  if (!model.is_null()) {
    std::string token = "{model}";
    std::string::size_type pos = 0;
    while ((pos = path.find(token, pos)) != std::string::npos) {
      path.replace(pos, token.size(), url_component(str(model)));
      pos += str(model).size();
    }
  }
  if (str(Core::get(descriptor_, "auth")) == "api_key_query") {
    std::string key = str(Core::get(descriptor_, "apiKeyQuery", "key"));
    path += (path.find('?') == std::string::npos ? "?" : "&") + url_component(key) + "=" + url_component(api_key_);
  }
  if (!api_version_.empty() && api_version_ != "null") {
    path += (path.find('?') == std::string::npos ? "?" : "&") + std::string("api-version=") + url_component(api_version_);
  }
  return path;
}

Value OpenAICompatibleClient::transport_result(Value result, Value request) {
  if (result.is_object() && has_key(result, "status")) {
    int status = static_cast<int>(num(Core::get(result, "status", 200)));
    Value body = Core::get(result, "json", Core::get(result, "body", Core::get(result, "data")));
    if (status >= 400) throw Core::as_error(Core::openai_normalize_error(status, body, request));
    return body;
  }
  return result;
}

std::vector<Value> OpenAICompatibleClient::iter_sse_json(Value raw) {
  std::vector<Value> out;
  if (raw.is_array()) {
    for (const auto& item : array_ref(raw)) if (display(item) != "[DONE]") out.push_back(item);
    return out;
  }
  // Mirror src/ax/util/sse.ts: normalize CRLF/CR, then fold the data: lines of
  // each event (events are blank-line separated) into a single payload before
  // parsing. A spec-legal SSE event may split one JSON value across several
  // data: lines, joined with "\n"; parsing each line on its own would choke.
  std::string text = display(raw);
  std::string normalized;
  normalized.reserve(text.size());
  for (size_t i = 0; i < text.size(); ++i) {
    if (text[i] == '\r') {
      normalized.push_back('\n');
      if (i + 1 < text.size() && text[i + 1] == '\n') ++i;  // collapse CRLF
    } else {
      normalized.push_back(text[i]);
    }
  }
  std::string buffer;
  auto flush = [&]() {
    std::string payload = display(Core::string_trim(buffer));
    buffer.clear();
    if (payload.empty() || payload == "[DONE]") return;
    out.push_back(parse_json(payload));
  };
  std::istringstream lines(normalized);
  std::string line;
  while (std::getline(lines, line)) {
    if (line.empty()) {
      flush();
      continue;
    }
    if (line[0] == ':') continue;  // comment line
    std::string value;
    std::string::size_type colon = line.find(':');
    if (colon != std::string::npos) {
      if (display(Core::string_trim(line.substr(0, colon))) != "data") continue;  // not a data: line
      value = display(Core::string_trim(line.substr(colon + 1)));
    } else {
      value = display(Core::string_trim(line));
    }
    if (!buffer.empty() && buffer.back() != '\n') buffer.push_back('\n');
    buffer += value;
  }
  flush();
  return out;
}

Tool::Tool(std::string name_, std::string description_, Value parameters_, std::function<Value(Value)> handler_, Value args_, Value returns_)
    : id(pointer_id(this)),
      name(std::move(name_)),
      description(std::move(description_)),
      parameters(std::move(parameters_)),
      args(std::move(args_)),
      returns(std::move(returns_)),
      handler(std::move(handler_)) {
  tool_registry()[id] = handler ? handler : [](Value) { return Value(); };
}

Value Tool::value() const {
  return Value(Object{
      {"__tool_id", id},
      {"name", name},
      {"description", description},
      {"parameters", parameters},
      {"args", args},
      {"returns", returns},
  });
}

AxMemory::AxMemory() : items_(Value(Object{{"items", Value::array()}})) {}
AxMemory& AxMemory::add_request(Value messages) {
  Value items = Core::get(items_, "items", Value::array());
  Core::append(items, Value(Object{{"role", "request"}, {"messages", messages}, {"tags", Value::array()}}));
  Core::set(items_, "items", items);
  return *this;
}
AxMemory& AxMemory::add_response(Value response) {
  if (!ax_memory_response_meaningful(response)) return *this;
  Value items = Core::get(items_, "items", Value::array());
  Core::append(items, Value(Object{{"role", "assistant"}, {"response", response}, {"tags", Value::array()}}));
  Core::set(items_, "items", items);
  return *this;
}
AxMemory& AxMemory::update_result(Value response) { return add_response(std::move(response)); }
AxMemory& AxMemory::add_function_results(Value results) {
  Value items = Core::get(items_, "items", Value::array());
  Core::append(items, Value(Object{{"role", "function"}, {"results", results.is_array() ? results : Value(Array{results})}, {"tags", Value::array()}}));
  Core::set(items_, "items", items);
  return *this;
}
AxMemory& AxMemory::add_processor_output(Value output) {
  Value items = Core::get(items_, "items", Value::array());
  Core::append(items, Value(Object{{"role", "processor"}, {"output", output}, {"tags", Value(Array{Value("processor")})}}));
  Core::set(items_, "items", items);
  return *this;
}
AxMemory& AxMemory::add_correction(Value response, Value error_message) {
  Value items = Core::get(items_, "items", Value::array());
  Core::append(items, Value(Object{{"role", "user"}, {"content", std::string("Correction: ") + str(error_message)}, {"response", response}, {"tags", Value(Array{Value("correction")})}}));
  Core::set(items_, "items", items);
  return *this;
}
Value AxMemory::history() const { return Core::get(items_, "items", Value::array()); }
Value AxMemory::get_last() const {
  Array arr = array_ref(history());
  return arr.empty() ? Value() : arr.back();
}
AxMemory& AxMemory::add_tag(const std::string& tag) {
  Array arr = array_ref(history());
  if (!arr.empty()) {
    Value item = arr.back();
    Value tags = Core::get(item, "tags", Value::array());
    Core::append(tags, tag);
    Core::set(item, "tags", tags);
    arr[arr.size() - 1] = item;
    Core::set(items_, "items", Value(arr));
  }
  return *this;
}
AxMemory& AxMemory::rewind_to_tag(const std::string& tag) {
  Array arr = array_ref(history());
  for (int i = static_cast<int>(arr.size()) - 1; i >= 0; --i) {
    bool has = false;
    for (const auto& t : array_ref(Core::get(arr[static_cast<size_t>(i)], "tags", Value::array()))) if (str(t) == tag) has = true;
    if (has) {
      arr.erase(arr.begin() + i + 1, arr.end());
      Core::set(items_, "items", Value(arr));
      return *this;
    }
  }
  return *this;
}
AxMemory& AxMemory::remove_by_tag(const std::string& tag) {
  Array kept;
  for (const auto& item : array_ref(history())) {
    bool has = false;
    for (const auto& t : array_ref(Core::get(item, "tags", Value::array()))) if (str(t) == tag) has = true;
    if (!has) kept.push_back(item);
  }
  Core::set(items_, "items", Value(kept));
  return *this;
}
Value AxMemory::value() const { return items_; }
Value& AxMemory::value_ref() { return items_; }

AxGen::AxGen(Value signature, Value options) {
  state_ = Value::object();
  Core::set(state_, "signature", std::move(signature));
  Core::set(state_, "options", options);
  Core::set(state_, "functions", Core::get(options, "functions", Value::array()));
  Core::set(state_, "examples", Core::get(options, "examples", Value::array()));
  Core::set(state_, "demos", Core::get(options, "demos", Value::array()));
  Core::set(state_, "assertions", Core::get(options, "assertions", Value::array()));
  Core::set(state_, "streaming_assertions", Core::get(options, "streaming_assertions", Core::get(options, "streamingAssertions", Value::array())));
  Core::set(state_, "field_processors", Core::get(options, "field_processors", Core::get(options, "fieldProcessors", Value::array())));
  Core::set(state_, "stop_functions", Core::get(options, "stop_functions", Core::get(options, "stopFunctions", Value::array())));
  Core::set(state_, "program_id", Core::get(options, "id", Core::get(options, "program_id", Core::get(options, "programId", Value("root")))));
  Core::set(state_, "instruction", Core::get(options, "instruction", Value("")));
  Core::set(state_, "memory", memory_.value());
  Core::set(state_, "chat_log", Value::array());
  Core::set(state_, "function_call_traces", Value::array());
  Core::set(state_, "traces", Value::array());
  refresh_prompt_template();
}

void AxGen::refresh_prompt_template() {
  Value prompt = Value::object();
  Core::set(prompt, "__kind", "PromptTemplate");
  Core::set(prompt, "signature", Core::get(state_, "signature"));
  Core::set(prompt, "functions", Core::get(state_, "functions", Value::array()));
  Core::set(prompt, "options", Core::get(state_, "options", Value::object()));
  Core::set(state_, "prompt_template", prompt);
}

AxGen& AxGen::add_tool(const Tool& tool) {
  Value functions = Core::get(state_, "functions", Value::array());
  Core::append(functions, tool.value());
  Core::set(state_, "functions", functions);
  refresh_prompt_template();
  return *this;
}

AxGen& AxGen::set_examples(Value examples) {
  Core::set(state_, "examples", examples);
  return *this;
}

AxGen& AxGen::set_demos(Value demos) {
  Core::set(state_, "demos", demos);
  return *this;
}

AxGen& AxGen::add_assert(Value assertion) {
  Value assertions = Core::get(state_, "assertions", Value::array());
  Core::append(assertions, assertion);
  Core::set(state_, "assertions", assertions);
  return *this;
}

AxGen& AxGen::add_assert(std::function<Value(Value)> assertion) {
  std::string id = pointer_id(this) + ":assert:" + std::to_string(assertion_registry().size());
  assertion_registry()[id] = std::move(assertion);
  Value spec = Value::object();
  Core::set(spec, "__assertion_id", id);
  return add_assert(spec);
}

AxGen& AxGen::add_streaming_assert(Value assertion) {
  Value assertions = Core::get(state_, "streaming_assertions", Value::array());
  Core::append(assertions, assertion);
  Core::set(state_, "streaming_assertions", assertions);
  return *this;
}

AxGen& AxGen::add_streaming_assert(std::string field, std::string not_contains, std::string message) {
  Value spec = Value::object();
  Core::set(spec, "field", std::move(field));
  Core::set(spec, "not_contains", std::move(not_contains));
  if (!message.empty()) Core::set(spec, "message", std::move(message));
  return add_streaming_assert(spec);
}

AxGen& AxGen::add_field_processor(std::string field, std::string op) {
  Value processors = Core::get(state_, "field_processors", Value::array());
  Value spec = Value::object();
  Core::set(spec, "field", std::move(field));
  Core::set(spec, "processor", std::move(op));
  Core::append(processors, spec);
  Core::set(state_, "field_processors", processors);
  return *this;
}

AxGen& AxGen::add_field_processor(std::string field, std::function<Value(Value)> processor) {
  std::string id = pointer_id(this) + ":processor:" + std::to_string(processor_registry().size());
  processor_registry()[id] = std::move(processor);
  Value processors = Core::get(state_, "field_processors", Value::array());
  Value spec = Value::object();
  Core::set(spec, "field", std::move(field));
  Core::set(spec, "__processor_id", id);
  Core::append(processors, spec);
  Core::set(state_, "field_processors", processors);
  return *this;
}

AxGen& AxGen::on_function_call(std::function<void(Value)> hook) {
  std::string id = pointer_id(this) + ":function_hook";
  function_hook_registry()[id] = std::move(hook);
  Value options = Core::get(state_, "options", Value::object());
  Core::set(options, "__function_hook_id", id);
  Core::set(state_, "options", options);
  return *this;
}

AxGen& AxGen::set_stop_functions(Value names) {
  Core::set(state_, "stop_functions", names);
  return *this;
}

AxGen& AxGen::set_instruction(Value instruction) {
  Core::set(state_, "instruction", instruction);
  Value options = Core::get(state_, "options", Value::object());
  Core::set(options, "instruction", instruction);
  Core::set(state_, "options", options);
  refresh_prompt_template();
  return *this;
}

Value AxGen::get_instruction() const {
  return Core::get(state_, "instruction", Value(""));
}

AxGen& AxGen::clear_instruction() {
  return set_instruction(Value(""));
}

Value AxGen::get_optimizable_components() const {
  Value components = Value::array();
  Value owner = Core::get(state_, "program_id", Value("root"));
  Value signature = Core::get(state_, "signature", Value::object());
  Value description = Core::get(signature, "description", Value());
  if (!description.is_null() && !str(description).empty()) {
    Core::append(components, Core::_optimization_component(
        Value(str(owner) + "::description"),
        owner,
        Value("description"),
        description,
        Value("Program signature description."),
        array({Value("Preserve the task intent and field references.")}),
        Value::array(),
        Value(false),
        Value("markdown"),
        object({{"required_placeholders", Value::array()}})));
  }
  Core::append(components, Core::_optimization_component(
      Value(str(owner) + "::instruction"),
      owner,
      Value("instruction"),
      Core::get(state_, "instruction", Value("")),
      Value("Prompt instruction text used by this generator."),
      array({Value("Keep required input and output fields intact.")}),
      Value::array(),
      Value(false),
      Value("markdown"),
      object({{"required_placeholders", Value::array()}})));
  for (const auto& fn : array_ref(Core::get(state_, "functions", Value::array()))) {
    Value name = Core::get(fn, "name", Value(""));
    if (str(name).empty()) continue;
    Value desc = Core::get(fn, "description", Value(""));
    Core::append(components, Core::_optimization_component(
        Value(str(owner) + "::fn:" + str(name) + ":desc"),
        owner,
        Value("fn-desc"),
        desc,
        Value("Description for tool " + str(name) + "."),
        array({Value("Non-empty, concise, and faithful to the tool behavior.")}),
        Value::array(),
        Value(false),
        Value("text"),
        object({{"maxLength", Value(320)}})));
    Core::append(components, Core::_optimization_component(
        Value(str(owner) + "::fn:" + str(name) + ":name"),
        owner,
        Value("fn-name"),
        name,
        Value("Callable name for tool " + str(name) + "."),
        array({Value("snake_case"), Value("32 characters or fewer"), Value("unique among tools")}),
        Value::array(),
        Value(true),
        Value("snake_case"),
        object({{"pattern", Value("^[a-z][a-z0-9_]{0,31}$")}})));
  }
  return components;
}

AxGen& AxGen::apply_optimized_components(Value component_map) {
  Value owner = Core::get(state_, "program_id", Value("root"));
  Value instruction_id(str(owner) + "::instruction");
  if (Core::truthy(Core::map_contains(component_map, instruction_id))) set_instruction(Core::get(component_map, instruction_id, Value("")));
  Value description_id(str(owner) + "::description");
  if (Core::truthy(Core::map_contains(component_map, description_id))) Core::set(state_, "optimized_description", Core::get(component_map, description_id, Value("")));
  Value functions = Core::get(state_, "functions", Value::array());
  Array out;
  for (const auto& raw_fn : array_ref(functions)) {
    Value fn = raw_fn;
    Value name = Core::get(fn, "name", Value(""));
    Value desc_id(str(owner) + "::fn:" + str(name) + ":desc");
    Value name_id(str(owner) + "::fn:" + str(name) + ":name");
    if (Core::truthy(Core::map_contains(component_map, desc_id))) Core::set(fn, "description", Core::get(component_map, desc_id, Value("")));
    if (Core::truthy(Core::map_contains(component_map, name_id))) Core::set(fn, "name", Core::get(component_map, name_id, name));
    out.push_back(fn);
  }
  Core::set(state_, "functions", Value(out));
  refresh_prompt_template();
  return *this;
}

AxGen& AxGen::apply_optimization(Value artifact) {
  Value components = get_optimizable_components();
  Value map = artifact.is_string() ? Core::_deserialize_optimized_artifact(artifact, components) : Core::_validate_optimized_artifact(artifact, components);
  return apply_optimized_components(Core::get(map, "componentMap", Value::object()));
}

static int gepa_int(Value value, int fallback) {
  if (value.is_null()) return fallback;
  if (value.is_number()) return static_cast<int>(std::floor(num(value)));
  try {
    return std::stoi(display(value));
  } catch (...) {
    return fallback;
  }
}

static double gepa_num(Value value, double fallback = 0.0) {
  if (value.is_null()) return fallback;
  if (value.is_number()) return num(value);
  try {
    return std::stod(display(value));
  } catch (...) {
    return fallback;
  }
}

static Value gepa_current_map(Value components) {
  Value out = Value::object();
  for (const auto& raw : Core::iter(components)) {
    std::string id = display(Core::get(raw, "id", Value("")));
    Value current = Core::get(raw, "current", Value(""));
    if (!id.empty() && current.is_string()) Core::set(out, id, current);
  }
  return out;
}

static Value gepa_dataset_for(const std::vector<Value>& examples) {
  Value train = Value::array();
  for (const auto& example : examples) Core::append(train, example);
  Value out = Value::object();
  Core::set(out, "train", train);
  Core::set(out, "validation", Value::array());
  return out;
}

static std::vector<Value> gepa_train(Value dataset) {
  return Core::iter(Core::get(dataset, "train", Value::array()));
}

static std::vector<Value> gepa_validation(Value dataset) {
  std::vector<Value> validation = Core::iter(Core::get(dataset, "validation", Value::array()));
  if (validation.empty()) return gepa_train(dataset);
  return validation;
}

static Value gepa_avg_vec(Value rows) {
  std::map<std::string, double> sums;
  std::map<std::string, int> counts;
  for (const auto& row : Core::iter(rows)) {
    for (const auto& kv : object_ref(Core::get(row, "scores", Value::object()))) {
      if (kv.second.is_number()) {
        sums[kv.first] += num(kv.second);
        counts[kv.first] += 1;
      }
    }
  }
  Value out = Value::object();
  for (const auto& kv : sums) Core::set(out, kv.first, Value(kv.second / std::max(1, counts[kv.first])));
  return out;
}

static double gepa_scalar(Value scores, Value options) {
  Value key = Core::get(options, "paretoMetricKey", Core::get(options, "pareto_metric_key", Value()));
  if (!key.is_null()) return gepa_num(Core::get(scores, display(key), Value()), 0.0);
  double sum = 0.0;
  int count = 0;
  for (const auto& kv : object_ref(scores)) {
    if (kv.second.is_number()) {
      sum += num(kv.second);
      count += 1;
    }
  }
  return count == 0 ? 0.0 : sum / count;
}

static bool gepa_dominates(Value a, Value b, double eps) {
  std::set<std::string> keys;
  for (const auto& kv : object_ref(a)) keys.insert(kv.first);
  for (const auto& kv : object_ref(b)) keys.insert(kv.first);
  bool at_least = true;
  bool strict = false;
  for (const auto& key : keys) {
    double av = gepa_num(Core::get(a, key, Value(0)), 0.0);
    double bv = gepa_num(Core::get(b, key, Value(0)), 0.0);
    if (av + eps < bv) {
      at_least = false;
      break;
    }
    if (av > bv + eps) strict = true;
  }
  return at_least && strict;
}

struct GepCandidate {
  Value cfg;
  Value scores;
  int parent = -1;
};

static Value gepa_pareto_front(const std::vector<GepCandidate>& candidates, double eps) {
  Value front = Value::array();
  for (size_t i = 0; i < candidates.size(); ++i) {
    bool dominated = false;
    int dominated_count = 0;
    for (size_t j = 0; j < candidates.size(); ++j) {
      if (i == j) continue;
      if (gepa_dominates(candidates[j].scores, candidates[i].scores, eps)) {
        dominated = true;
        break;
      }
      if (gepa_dominates(candidates[i].scores, candidates[j].scores, eps)) dominated_count += 1;
    }
    if (!dominated) {
      Value item = Value::object();
      Core::set(item, "idx", Value(static_cast<int>(i)));
      Core::set(item, "scores", candidates[i].scores);
      Core::set(item, "dominated", Value(dominated_count));
      Core::append(front, item);
    }
  }
  return front;
}

static std::string gepa_extract_text(Value response) {
  Value results = Core::get(response, "results", Value::array());
  if (Core::iter(results).empty()) return "";
  std::string text = display(Core::get(Core::iter(results)[0], "content", Value("")));
  auto trim = [](std::string s) {
    while (!s.empty() && std::isspace(static_cast<unsigned char>(s.front()))) s.erase(s.begin());
    while (!s.empty() && std::isspace(static_cast<unsigned char>(s.back()))) s.pop_back();
    return s;
  };
  text = trim(text);
  const std::string prefix = "New Value:";
  if (text.rfind(prefix, 0) == 0) return trim(text.substr(prefix.size()));
  const std::string fence = "\x60\x60\x60";
  size_t start = text.find(fence);
  size_t end = text.rfind(fence);
  if (start != std::string::npos && end != std::string::npos && end > start) {
    std::string inner = trim(text.substr(start + 3, end - start - 3));
    size_t newline = inner.find('\n');
    if (newline != std::string::npos) inner = inner.substr(newline + 1);
    return trim(inner);
  }
  return text;
}

static Value gepa_validate_value(Value component, const std::string& value) {
  if (value.empty()) return Value("component value must be a non-empty string");
  if (display(Core::get(component, "format", Value(""))) == "snake_case") {
    if (!std::regex_match(value, std::regex("^[a-z_][a-z0-9_]*$"))) return Value("must be snake_case");
  }
  Value max_len = Core::get(component, "maxLength", Value());
  if (max_len.is_number() && value.size() > static_cast<size_t>(num(max_len))) return Value("must be at most " + display(max_len) + " characters");
  for (const auto& literal : Core::iter(Core::get(component, "preserve", Value::array()))) {
    if (value.find(display(literal)) == std::string::npos) return Value("must preserve " + display(literal));
  }
  return Value(true);
}

static void gepa_component_visit(const std::string& id, const std::map<std::string, Value>& by_id, std::set<std::string>& seen, std::vector<Value>& out) {
  if (seen.count(id) != 0) return;
  auto it = by_id.find(id);
  if (it == by_id.end()) return;
  seen.insert(id);
  out.push_back(it->second);
  Value deps = Core::get(it->second, "dependsOn", Core::get(it->second, "depends_on", Value::array()));
  for (const auto& dep : Core::iter(deps)) gepa_component_visit(display(dep), by_id, seen, out);
}

static std::vector<Value> gepa_component_group(Value target, const std::vector<Value>& components) {
  std::map<std::string, Value> by_id;
  for (const auto& component : components) by_id[display(Core::get(component, "id", Value("")))] = component;
  std::vector<Value> out;
  std::set<std::string> seen;
  gepa_component_visit(display(Core::get(target, "id", Value(""))), by_id, seen, out);
  return out;
}

AxBootstrapFewShot::AxBootstrapFewShot(Value options) : options_(std::move(options)) {}
std::string AxBootstrapFewShot::name() const { return "BootstrapFewShot"; }
std::string AxBootstrapFewShot::version() const { return "axir-bootstrap-fewshot-v1"; }
Value AxBootstrapFewShot::optimize(Value request) { return optimize(std::move(request), nullptr); }
Value AxBootstrapFewShot::optimize(Value request, OptimizerEvaluator* evaluator) {
  if (evaluator == nullptr) throw AxError("runtime", "AxBootstrapFewShot requires an OptimizerEvaluator");
  Value options = Core::map_merge(options_, Core::get(request, "options", Value::object()));
  std::vector<Value> components = Core::iter(Core::get(request, "components", Value::array()));
  std::vector<Value> train = gepa_train(Core::get(request, "dataset", Value::object()));
  double threshold = gepa_num(Core::get(options, "qualityThreshold", Core::get(options, "quality_threshold", Value(0.5))), 0.5);
  int max_rounds = std::max(1, gepa_int(Core::get(options, "maxRounds", Core::get(options, "max_rounds", Value(3))), 3));
  int max_examples = std::max(1, gepa_int(Core::get(options, "maxExamples", Core::get(options, "max_examples", Value(16))), 16));
  int max_demos = std::max(1, gepa_int(Core::get(options, "maxDemos", Core::get(options, "max_demos", Value(4))), 4));
  int batch_size = std::max(1, gepa_int(Core::get(options, "batchSize", Core::get(options, "batch_size", Value(1))), 1));
  if (static_cast<int>(train.size()) > max_examples) train.resize(static_cast<size_t>(max_examples));
  Value base_cfg = gepa_current_map(Value(components));
  Value demos = Value::array();
  std::set<std::string> accepted;
  int total_calls = 0;
  for (int round = 0; round < max_rounds && static_cast<int>(Core::iter(demos).size()) < max_demos; ++round) {
    for (int offset = 0; offset < static_cast<int>(train.size()) && static_cast<int>(Core::iter(demos).size()) < max_demos; offset += batch_size) {
      int end = std::min(static_cast<int>(train.size()), offset + batch_size);
      for (int i = offset; i < end && static_cast<int>(Core::iter(demos).size()) < max_demos; ++i) {
        std::string example_key = stable_stringify(train[static_cast<size_t>(i)]);
        if (accepted.count(example_key)) continue;
        Value eval_options = object({{"dataset", object({{"train", array({train[static_cast<size_t>(i)]})}, {"validation", Value::array()}})}, {"phase", "bootstrap"}, {"round", static_cast<double>(round)}});
        Value result = evaluator->evaluate(base_cfg, eval_options);
        std::vector<Value> rows = Core::iter(Core::get(result, "rows", Value::array()));
        total_calls += gepa_int(Core::get(result, "count", Value(static_cast<double>(rows.empty() ? 1 : rows.size()))), rows.empty() ? 1 : static_cast<int>(rows.size()));
        if (rows.empty()) continue;
        if (gepa_num(Core::get(rows[0], "scalar", Value(0)), 0) >= threshold) {
          accepted.insert(example_key);
          Value traces = Value::array();
          Core::append(traces, Core::get(rows[0], "prediction", Core::get(rows[0], "input", Value::object())));
          Core::append(demos, object({{"programId", "root"}, {"traces", traces}}));
        }
      }
    }
  }
  return object({
      {"artifactVersion", "axir-optimized-artifact-v1"},
      {"optimizerName", "BootstrapFewShot"},
      {"optimizerVersion", version()},
      {"componentMap", Value::object()},
      {"demos", demos},
      {"metadata", object({{"optimizer", "BootstrapFewShot"}, {"qualityThreshold", threshold}, {"totalMetricCalls", static_cast<double>(total_calls)}, {"demosGenerated", static_cast<double>(Core::iter(demos).size())}})},
      {"evidence", object({{"count", static_cast<double>(total_calls)}})},
      {"provenance", object({{"sourceProgramKind", Core::get(request, "programKind", "unknown")}})},
  });
}

AxGEPA::AxGEPA(AIClient* reflection_client, Value options)
    : reflection_client_(reflection_client), options_(std::move(options)), rng_state_(123456789), selector_state_(Value::object()) {
  int seed = gepa_int(Core::get(options_, "seed", Value(123456789)), 123456789);
  rng_state_ = static_cast<uint32_t>(seed == 0 ? 123456789 : seed);
}

std::string AxGEPA::name() const { return "GEPA"; }
std::string AxGEPA::version() const { return "axir-gepa-v1"; }
Value AxGEPA::optimize(Value request) { return optimize(std::move(request), nullptr); }

double AxGEPA::rand() {
  rng_state_ ^= (rng_state_ << 13);
  rng_state_ ^= (rng_state_ >> 17);
  rng_state_ ^= (rng_state_ << 5);
  return static_cast<double>(rng_state_) / 4294967296.0;
}

Value AxGEPA::optimize(Value request, OptimizerEvaluator* evaluator) {
  if (evaluator == nullptr) throw AxError("runtime", "AxGEPA requires an OptimizerEvaluator");
  Value options = Core::map_merge(Value::object(), options_);
  options = Core::map_merge(options, Core::get(request, "options", Value::object()));
  Value components = Core::get(request, "components", Value::array());
  if (Core::iter(components).empty()) throw AxError("runtime", "AxGEPA: program exposes no optimizable components");
  Value dataset = Core::get(request, "dataset", Value::object());
  std::vector<Value> train = gepa_train(dataset);
  std::vector<Value> validation = gepa_validation(dataset);
  int max_calls = gepa_int(Core::get(options, "maxMetricCalls", Core::get(options, "max_metric_calls", Value(0))), 0);
  if (max_calls <= 0) throw AxError("runtime", "AxGEPA: options.maxMetricCalls must be set to a positive integer");
  int num_trials = gepa_int(Core::get(options, "numTrials", Core::get(options, "num_trials", Value(30))), 30);
  bool minibatch = !Core::truthy(Core::eq(Core::get(options, "minibatch", Value(true)), Value(false)));
  int minibatch_size = std::max(1, gepa_int(Core::get(options, "minibatchSize", Core::get(options, "minibatch_size", Value(20))), 20));
  int early_stop = std::max(1, gepa_int(Core::get(options, "earlyStoppingTrials", Core::get(options, "early_stopping_trials", Value(5))), 5));
  double min_improvement = gepa_num(Core::get(options, "minImprovementThreshold", Core::get(options, "min_improvement_threshold", Value(0))), 0.0);
  int pareto_size = std::min(1000, std::max(1, gepa_int(Core::get(options, "paretoSetSize", Core::get(options, "pareto_set_size", Value(std::max(10, std::min(200, minibatch_size * 3))))), 10)));
  double tie_eps = gepa_num(Core::get(options, "tieEpsilon", Core::get(options, "tie_epsilon", Value(0))), 0.0);
  Value base_cfg = gepa_current_map(components);
  std::vector<Value> pareto_set(validation.begin(), validation.begin() + std::min(validation.size(), static_cast<size_t>(pareto_size)));
  selector_state_ = Value::object();
  Value initial_selector = Core::get(options, "selectorState", Core::get(options, "selector_state", Value::object()));
  for (const auto& raw : Core::iter(components)) {
    std::string id = display(Core::get(raw, "id", Value("")));
    Value old = Core::get(initial_selector, id, Value::object());
    Value state = Value::object();
    Core::set(state, "proposals", Value(std::max(0, gepa_int(Core::get(old, "proposals", Value(0)), 0))));
    Core::set(state, "accepts", Value(std::max(0, gepa_int(Core::get(old, "accepts", Value(0)), 0))));
    Core::set(state, "lastAcceptIter", Value(gepa_int(Core::get(old, "lastAcceptIter", Value(-1)), -1)));
    Core::set(state, "stagnation", Value(std::max(0, gepa_int(Core::get(old, "stagnation", Value(0)), 0))));
    Core::set(selector_state_, id, state);
  }

  int total_calls = 0;
  auto evaluate = [&](Value cfg, const std::vector<Value>& examples, const std::string& phase, bool required, bool capture) -> Value {
    if (total_calls + static_cast<int>(examples.size()) > max_calls) {
      if (required) throw AxError("runtime", "AxGEPA: options.maxMetricCalls=" + std::to_string(max_calls) + " is too small to evaluate the initial Pareto set; need at least " + std::to_string(examples.size()) + " metric calls");
      return Value();
    }
    Value eval_options = Value::object();
    Core::set(eval_options, "dataset", gepa_dataset_for(examples));
    Core::set(eval_options, "phase", Value(phase));
    Core::set(eval_options, "captureTraces", Value(capture));
    Value result = evaluator->evaluate(cfg, eval_options);
    total_calls += static_cast<int>(gepa_num(Core::get(result, "count", Value(static_cast<int>(examples.size()))), examples.size()));
    Value rows = Core::get(result, "rows", Value::array());
    Value scalars = Value::array();
    for (const auto& row : Core::iter(rows)) Core::append(scalars, Core::get(row, "scalar", Value(0)));
    Value out = Value::object();
    Core::set(out, "rows", rows);
    Core::set(out, "avgScores", gepa_avg_vec(rows));
    Core::set(out, "avg", Core::get(result, "avg", Value(0)));
    Core::set(out, "sum", Core::get(result, "sum", Value(0)));
    Core::set(out, "scalars", scalars);
    return out;
  };

  Value demos = Value::array();
  if (Core::truthy(Core::get(options, "bootstrap", Value(false)))) {
    Value bootstrap = Core::get(options, "bootstrap", Value::object());
    double threshold = gepa_num(Core::get(bootstrap, "scoreThreshold", Core::get(bootstrap, "score_threshold", Value(0.8))), 0.8);
    int max_demos = std::max(1, gepa_int(Core::get(bootstrap, "maxBootstrapDemos", Core::get(bootstrap, "max_bootstrap_demos", Value(4))), 4));
    int max_boot_calls = std::max(1, gepa_int(Core::get(bootstrap, "maxBootstrapMetricCalls", Core::get(bootstrap, "max_bootstrap_metric_calls", Value(static_cast<int>(std::min<size_t>(train.size(), 8))))), static_cast<int>(std::min<size_t>(train.size(), 8))));
    int boot_calls = 0;
    for (const auto& example : train) {
      if (boot_calls >= max_boot_calls || static_cast<int>(Core::iter(demos).size()) >= max_demos) break;
      Value boot_eval = evaluate(base_cfg, std::vector<Value>{example}, "bootstrap", false, false);
      boot_calls += 1;
      if (boot_eval.is_null()) break;
      std::vector<Value> rows = Core::iter(Core::get(boot_eval, "rows", Value::array()));
      if (!rows.empty() && gepa_num(Core::get(rows[0], "scalar", Value(0)), 0.0) >= threshold) {
        Value demo = Value::object();
        Core::set(demo, "programId", Value("root"));
        Value traces = Value::array();
        Core::append(traces, Core::get(rows[0], "prediction", Core::get(rows[0], "input", Value::object())));
        Core::set(demo, "traces", traces);
        Core::append(demos, demo);
      }
    }
  }

  Value base_eval = evaluate(base_cfg, pareto_set, "initial Pareto evaluation", true, false);
  std::vector<GepCandidate> candidates{{base_cfg, Core::get(base_eval, "avgScores", Value::object()), -1}};
  std::vector<std::vector<double>> per_instance;
  std::vector<double> base_scalars;
  for (const auto& scalar : Core::iter(Core::get(base_eval, "scalars", Value::array()))) base_scalars.push_back(gepa_num(scalar, 0.0));
  per_instance.push_back(base_scalars);
  int stagnation = 0;
  std::vector<Value> component_list = Core::iter(components);

  for (int iteration = 0; iteration < num_trials; ++iteration) {
    if (total_calls >= max_calls) break;
    int parent_idx = 0;
    double parent_avg = -1e100;
    for (size_t i = 0; i < per_instance.size(); ++i) {
      double sum = 0.0;
      for (double v : per_instance[i]) sum += v;
      double avg = per_instance[i].empty() ? 0.0 : sum / per_instance[i].size();
      if (avg > parent_avg) {
        parent_avg = avg;
        parent_idx = static_cast<int>(i);
      }
    }
    std::vector<Value> mini;
    if (minibatch) {
      for (int i = 0; i < std::min(minibatch_size, static_cast<int>(train.size())); ++i) mini.push_back(train[(iteration * minibatch_size + i) % train.size()]);
    } else {
      mini = train;
    }
    Value parent_eval = evaluate(candidates[parent_idx].cfg, mini, "parent minibatch", false, true);
    if (parent_eval.is_null()) break;
    double perfect = gepa_num(Core::get(options, "perfectScore", Core::get(options, "perfect_score", Value(1))), 1.0);
    bool all_perfect = !Core::iter(Core::get(parent_eval, "scalars", Value::array())).empty();
    for (const auto& score : Core::iter(Core::get(parent_eval, "scalars", Value::array()))) if (gepa_num(score, 0.0) < perfect) all_perfect = false;
    if (!Core::truthy(Core::eq(Core::get(options, "skipPerfectScore", Core::get(options, "skip_perfect_score", Value(true))), Value(false))) && all_perfect) continue;
    Value target = component_list.empty() ? Value::object() : component_list[static_cast<size_t>(std::floor(rand() * component_list.size())) % component_list.size()];
    std::vector<Value> group = gepa_component_group(target, component_list);
    Value proposed = Core::map_merge(Value::object(), candidates[parent_idx].cfg);
    Value rows = Core::get(parent_eval, "rows", Value::array());
    Value tuples = Value::array();
    Value trace_dataset = Value::array();
    for (const auto& row : Core::iter(rows)) {
      Value tuple = Value::object();
      Core::set(tuple, "input", Core::get(row, "input", Value()));
      Core::set(tuple, "prediction", Core::get(row, "prediction", Value()));
      Core::set(tuple, "score", Core::get(row, "scalar", Value(0)));
      Core::append(tuples, tuple);
      Value trace = Value::object();
      Core::set(trace, "score", Core::get(row, "scalar", Value(0)));
      Core::set(trace, "trace", Core::get(row, "trace", Value()));
      Core::set(trace, "output", Core::get(row, "prediction", Value()));
      Core::append(trace_dataset, trace);
    }
    if (reflection_client_ == nullptr) throw AxError("runtime", "AxGEPA requires a reflection_client for reflective trials");
    for (const auto& group_target : group) {
      std::string target_id = display(Core::get(group_target, "id", Value("")));
      Value state = Core::get(selector_state_, target_id, Value::object());
      Core::set(state, "proposals", Value(gepa_int(Core::get(state, "proposals", Value(0)), 0) + 1));
      Core::set(selector_state_, target_id, state);
      std::string current = display(Core::get(proposed, target_id, Value("")));
      std::string candidate_text = current;
      Value previous;
      for (int attempt = 0; attempt < 2; ++attempt) {
        Value payload = Value::object();
        Core::set(payload, "componentKey", Value(target_id));
        Core::set(payload, "componentKind", Core::get(group_target, "kind", Value("component")));
        Core::set(payload, "currentValue", Value(current));
        Core::set(payload, "previousValidationError", previous);
        Core::set(payload, "minibatch", tuples);
        Core::set(payload, "traceDataset", trace_dataset);
        Value request_chat = Value::object();
        Value messages = Value::array();
        Value message = Value::object();
        Core::set(message, "role", Value("user"));
        Core::set(message, "content", Core::json_stringify(payload));
        Core::append(messages, message);
        Core::set(request_chat, "chatPrompt", messages);
        candidate_text = gepa_extract_text(reflection_client_->chat(request_chat));
        Value validation = gepa_validate_value(group_target, candidate_text);
        if (Core::truthy(Core::eq(validation, Value(true)))) break;
        previous = validation;
        candidate_text = current;
      }
      Core::set(proposed, target_id, Value(candidate_text));
    }
    Value child_mini = evaluate(proposed, mini, "child minibatch", false, false);
    if (child_mini.is_null()) break;
    bool accepted = gepa_num(Core::get(child_mini, "sum", Value(0)), 0.0) > gepa_num(Core::get(parent_eval, "sum", Value(0)), 0.0) + min_improvement;
    for (const auto& group_target : group) {
      std::string target_id = display(Core::get(group_target, "id", Value("")));
      Value state = Core::get(selector_state_, target_id, Value::object());
      if (accepted) {
        Core::set(state, "accepts", Value(gepa_int(Core::get(state, "accepts", Value(0)), 0) + 1));
        Core::set(state, "lastAcceptIter", Value(iteration));
        Core::set(state, "stagnation", Value(0));
      } else {
        Core::set(state, "stagnation", Value(gepa_int(Core::get(state, "stagnation", Value(0)), 0) + 1));
      }
      Core::set(selector_state_, target_id, state);
    }
    if (!accepted) {
      if (++stagnation >= early_stop) break;
      continue;
    }
    Value child_eval = evaluate(proposed, pareto_set, "validation evaluation", false, false);
    if (child_eval.is_null()) break;
    candidates.push_back(GepCandidate{proposed, Core::get(child_eval, "avgScores", Value::object()), parent_idx});
    std::vector<double> child_scalars;
    for (const auto& scalar : Core::iter(Core::get(child_eval, "scalars", Value::array()))) child_scalars.push_back(gepa_num(scalar, 0.0));
    per_instance.push_back(child_scalars);
    stagnation = 0;
  }

  Value front = gepa_pareto_front(candidates, tie_eps);
  int best_idx = 0;
  double best_score = -1e100;
  for (const auto& item : Core::iter(front)) {
    int idx = static_cast<int>(gepa_num(Core::get(item, "idx", Value(0)), 0));
    double score = gepa_scalar(Core::get(item, "scores", Value::object()), options);
    if (score > best_score || (score == best_score && idx > best_idx)) {
      best_score = score;
      best_idx = idx;
    }
  }
  Value owners = Value::object();
  for (const auto& component : component_list) {
    std::string id = display(Core::get(component, "id", Value("")));
    std::string owner = display(Core::get(component, "owner", Value(id.substr(0, id.find("::")))));
    Core::set(owners, id, Value(owner));
  }
  Value metadata = Value::object();
  Core::set(metadata, "optimizer", Value("GEPA"));
  Core::set(metadata, "selectorState", selector_state_);
  Core::set(metadata, "paretoFront", front);
  Core::set(metadata, "bestScore", Value(best_score == -1e100 ? 0.0 : best_score));
  Core::set(metadata, "totalMetricCalls", Value(total_calls));
  Core::set(metadata, "candidatesExplored", Value(static_cast<int>(candidates.size())));
  Value report = Value::object();
  Core::set(report, "summary", Value("GEPA Multi-Objective Optimization Complete"));
  Value stats = Value::object();
  Core::set(stats, "totalEvaluations", Value(total_calls));
  Core::set(stats, "candidatesExplored", Value(static_cast<int>(candidates.size())));
  Core::set(stats, "converged", Value(true));
  Core::set(report, "statistics", stats);
  Core::set(metadata, "report", report);
  Value artifact = Value::object();
  Core::set(artifact, "artifactVersion", Value("axir-optimized-artifact-v1"));
  Core::set(artifact, "optimizerName", Value("GEPA"));
  Core::set(artifact, "optimizerVersion", Value(version()));
  Core::set(artifact, "componentMap", candidates[static_cast<size_t>(best_idx)].cfg);
  Core::set(artifact, "demos", demos);
  Core::set(artifact, "metadata", metadata);
  Value evidence = Value::object();
  Core::set(evidence, "avg", Value(best_score == -1e100 ? 0.0 : best_score));
  Core::set(evidence, "count", Value(static_cast<int>(pareto_set.size())));
  Core::set(evidence, "totalMetricCalls", Value(total_calls));
  Core::set(artifact, "evidence", evidence);
  Value provenance = Value::object();
  Core::set(provenance, "sourceProgramKind", Core::get(request, "programKind", Value("unknown")));
  Core::set(provenance, "componentOwners", owners);
  Core::set(artifact, "provenance", provenance);
  return artifact;
}

static bool ace_is_number(const Value& value) { return value.is_number(); }

static const char* kAceConfigKeys[] = {
    "maxEpochs", "maxReflectorRounds", "maxSectionSize",
    "maxSerializedFieldChars", "similarityThreshold", "allowDynamicSections"};

AxACE::AxACE(Value options) {
  if (!options.is_object()) options = Value::object();
  config_ = Value::object();
  Core::set(config_, "maxEpochs", Value(1));
  Core::set(config_, "maxReflectorRounds", Value(2));
  Core::set(config_, "maxSectionSize", Value(25));
  Core::set(config_, "maxSerializedFieldChars", Value(2000));
  Core::set(config_, "similarityThreshold", Value(0.95));
  Core::set(config_, "allowDynamicSections", Value(true));
  for (const char* key : kAceConfigKeys) {
    Value value = Core::get(options, key);
    if (!value.is_null()) Core::set(config_, key, value);
  }
  Value now_value = Core::get(options, "now");
  now_ = now_value.is_null() ? std::string("1970-01-01T00:00:00.000Z") : display(now_value);
  initial_playbook_ = Core::get(options, "initialPlaybook");
  playbook_ = initial_playbook_.is_null() ? empty_playbook() : initial_playbook_;
}

void AxACE::set_callables(AceCallable reflector, AceCallable curator, AceCallable generator) {
  reflector_ = std::move(reflector);
  curator_ = std::move(curator);
  generator_ = std::move(generator);
  has_generator_ = static_cast<bool>(generator_);
}

std::string AxACE::name() const { return "ACE"; }
std::string AxACE::version() const { return "axir-ace-v1"; }

Value AxACE::empty_playbook() const { return Core::_ace_empty_playbook(Value(), Value(now_)); }

int AxACE::int_config(const std::string& key, int fallback) const {
  Value value = Core::get(config_, key);
  if (value.is_number()) return static_cast<int>(num(value));
  return fallback;
}

void AxACE::reset() {
  playbook_ = initial_playbook_.is_null() ? empty_playbook() : initial_playbook_;
  generator_history_.clear();
  delta_history_.clear();
}

void AxACE::configure_auto(const std::string& level) {
  if (level == "light") {
    Core::set(config_, "maxEpochs", Value(1));
    Core::set(config_, "maxReflectorRounds", Value(1));
  } else if (level == "medium") {
    Core::set(config_, "maxEpochs", Value(2));
    Core::set(config_, "maxReflectorRounds", Value(2));
  } else if (level == "heavy") {
    Core::set(config_, "maxEpochs", Value(3));
    Core::set(config_, "maxReflectorRounds", Value(3));
  }
}

void AxACE::hydrate(const Value& state) {
  Value pb = Core::get(state, "playbook");
  if (!pb.is_null()) {
    playbook_ = pb;
  } else if (!initial_playbook_.is_null()) {
    playbook_ = initial_playbook_;
  } else {
    playbook_ = empty_playbook();
  }
  Value artifact = Core::get(state, "artifact", Value::object());
  generator_history_.clear();
  for (const auto& item : Core::iter(Core::get(artifact, "feedback", Value::array()))) generator_history_.push_back(item);
  delta_history_.clear();
  for (const auto& item : Core::iter(Core::get(artifact, "history", Value::array()))) delta_history_.push_back(item);
}

Value AxACE::get_playbook() const { return playbook_; }

Value AxACE::get_artifact() const {
  Value out = Value::object();
  Core::set(out, "playbook", playbook_);
  Core::set(out, "feedback", Value(generator_history_));
  Core::set(out, "history", Value(delta_history_));
  return out;
}

std::string AxACE::render_playbook() const { return display(Core::_ace_render_playbook(playbook_)); }

Value AxACE::generator_output(const Value& prediction) const {
  std::string reasoning;
  Value bullet_ids = Value::array();
  if (prediction.is_object()) {
    Value thought = Core::get(prediction, "thought");
    if (!thought.is_null()) reasoning = display(thought);
    Value ids = Core::get(prediction, "bullet_ids");
    if (ids.is_array()) bullet_ids = ids;
  }
  Value out = Value::object();
  Core::set(out, "reasoning", Value(reasoning));
  Core::set(out, "answer", prediction);
  Core::set(out, "bulletIds", bullet_ids);
  return out;
}

Value AxACE::run_reflector(const Value& example, const Value& generator_output, const Value& feedback, const Value& previous_reflection) {
  if (!reflector_) return Value();
  Value payload = Value::object();
  Core::set(payload, "question", example);
  Core::set(payload, "generator_answer", Core::get(generator_output, "answer"));
  Core::set(payload, "generator_reasoning", Core::get(generator_output, "reasoning"));
  Core::set(payload, "playbook", Value(render_playbook()));
  Core::set(payload, "feedback", feedback);
  Core::set(payload, "previous_reflection", previous_reflection);
  return reflector_(payload);
}

Value AxACE::run_reflection_rounds(const Value& example, const Value& generator_output, const Value& feedback) {
  int rounds = std::max(int_config("maxReflectorRounds", 1), 1);
  Value previous;
  for (int round = 0; round < rounds; round++) {
    Value reflection = run_reflector(example, generator_output, feedback, previous);
    if (reflection.is_null() || (reflection.is_object() && Core::iter(Core::map_keys(reflection)).empty())) break;
    Core::set(reflection, "bulletTags", Core::_ace_normalize_reflection_bullet_tags(reflection));
    previous = reflection;
    std::string error_text = display(Core::string_lower(Core::get(reflection, "errorIdentification", Value(""))));
    size_t start = error_text.find_first_not_of(" \t\n\r");
    size_t end = error_text.find_last_not_of(" \t\n\r");
    error_text = (start == std::string::npos) ? std::string("") : error_text.substr(start, end - start + 1);
    bool resolved = Core::truthy(Core::get(Core::get(reflection, "metadata", Value::object()), "resolved", Value(false)));
    if (resolved || error_text.empty() || error_text.rfind("no error", 0) == 0 || error_text.rfind("resolved", 0) == 0) break;
  }
  return previous;
}

Value AxACE::run_curator(const Value& example, const Value& reflection) {
  if (reflection.is_null()) return Value();
  if (!curator_) return Value();
  Value payload = Value::object();
  Core::set(payload, "playbook", Value(render_playbook()));
  Core::set(payload, "reflection", reflection);
  Core::set(payload, "question_context", example);
  Core::set(payload, "token_budget", Value(1024));
  return curator_(payload);
}

std::vector<Value> AxACE::normalize_and_resolve(const Value& raw_curator, const Value& generator_output, const Value& reflection) {
  Value raw_operations = raw_curator.is_null() ? Value() : Core::get(raw_curator, "operations");
  Value operations = Core::_ace_normalize_curator_operations(raw_operations);
  Value resolved = Core::_ace_resolve_curator_operation_targets(operations, playbook_, reflection, generator_output);
  std::vector<Value> out;
  for (const auto& item : Core::iter(resolved)) out.push_back(item);
  return out;
}

std::vector<Value> AxACE::apply_operations(std::vector<Value>& resolved, Value& curator_result) {
  Value protected_ids = Value::array();
  for (const auto& op : resolved) {
    if (display(Core::get(op, "type", Value(""))) == "UPDATE" && !Core::get(op, "bulletId").is_null()) {
      Core::append(protected_ids, Core::get(op, "bulletId"));
    }
  }
  Value options = Value::object();
  Core::set(options, "maxSectionSize", Core::get(config_, "maxSectionSize"));
  Core::set(options, "allowDynamicSections", Core::get(config_, "allowDynamicSections"));
  Core::set(options, "enableAutoPrune", Value(true));
  Core::set(options, "protectedBulletIds", protected_ids);
  Value result = Core::_ace_apply_curator_operations(playbook_, Value(resolved), options, Value(now_));
  playbook_ = Core::get(result, "playbook");
  std::vector<Value> applied_ids;
  for (const auto& item : Core::iter(Core::get(result, "updatedBulletIds", Value::array()))) applied_ids.push_back(item);
  std::vector<Value> auto_removed;
  for (const auto& item : Core::iter(Core::get(result, "autoRemoved", Value::array()))) auto_removed.push_back(item);
  if (!auto_removed.empty()) {
    for (const auto& item : auto_removed) resolved.push_back(item);
    if (!curator_result.is_null()) Core::set(curator_result, "operations", Value(resolved));
  }
  return applied_ids;
}

void AxACE::apply_bullet_tags(const Value& reflection) {
  for (const auto& tag : Core::iter(Core::_ace_normalize_reflection_bullet_tags(reflection))) {
    playbook_ = Core::_ace_update_bullet_feedback(playbook_, Core::get(tag, "id"), Core::get(tag, "tag"), Value(now_));
  }
}

Value AxACE::compile(const std::vector<Value>& examples, const AceCallable& metric_fn, Value options) {
  Value ace_options = Core::get(options, "aceOptions");
  if (ace_options.is_null()) ace_options = Core::get(options, "ace_options");
  if (!ace_options.is_null()) {
    for (const char* key : kAceConfigKeys) {
      Value value = Core::get(ace_options, key);
      if (!value.is_null()) Core::set(config_, key, value);
    }
  }
  reset();
  int epochs = std::max(int_config("maxEpochs", 1), 1);
  bool has_best = false;
  double best_score = 0.0;
  for (int epoch = 0; epoch < epochs; epoch++) {
    for (size_t index = 0; index < examples.size(); index++) {
      const Value& example = examples[index];
      Value prediction = has_generator_ ? generator_(example) : Value::object();
      last_prediction_ = prediction;
      Value score = metric_fn ? metric_fn(example) : Value(0);
      if (ace_is_number(score)) {
        double s = num(score);
        best_score = has_best ? std::max(best_score, s) : s;
        has_best = true;
      }
      Value generator_out = generator_output(last_prediction_);
      Value feedback = ace_is_number(score) ? Value("Metric score: " + display(score)) : Value();
      Value reflection = run_reflection_rounds(example, generator_out, feedback);
      Value raw_curator = run_curator(example, reflection);
      std::vector<Value> resolved = normalize_and_resolve(raw_curator, generator_out, reflection);
      Value curator_result;
      if (!raw_curator.is_null() || !resolved.empty()) {
        curator_result = raw_curator.is_null() ? Value::object() : raw_curator;
        Core::set(curator_result, "operations", Value(resolved));
      }
      std::vector<Value> applied_ids;
      if (!resolved.empty()) applied_ids = apply_operations(resolved, curator_result);
      if (!reflection.is_null()) apply_bullet_tags(reflection);
      if (!resolved.empty() && !applied_ids.empty()) playbook_ = Core::_ace_dedupe_playbook(playbook_);
      Value feedback_event = Value::object();
      Core::set(feedback_event, "example", example);
      Core::set(feedback_event, "prediction", last_prediction_);
      Core::set(feedback_event, "score", ace_is_number(score) ? score : Value(0));
      Core::set(feedback_event, "generatorOutput", generator_out);
      Core::set(feedback_event, "reflection", reflection);
      Core::set(feedback_event, "curator", curator_result);
      Core::set(feedback_event, "timestamp", Value(now_));
      generator_history_.push_back(feedback_event);
      bool has_ops = !curator_result.is_null() && !Core::iter(Core::get(curator_result, "operations", Value::array())).empty();
      if (!applied_ids.empty() && has_ops) {
        Value delta = Value::object();
        Core::set(delta, "source", Value("compile"));
        Core::set(delta, "epoch", Value(epoch));
        Core::set(delta, "exampleIndex", Value(static_cast<int>(index)));
        Core::set(delta, "operations", Core::get(curator_result, "operations"));
        Core::set(delta, "updatedBulletIds", Value(applied_ids));
        delta_history_.push_back(delta);
      }
    }
  }
  Value out = Value::object();
  Core::set(out, "playbook", playbook_);
  Core::set(out, "artifact", get_artifact());
  Core::set(out, "bestScore", Value(has_best ? best_score : 0.0));
  Value final_config = Value::object();
  Core::set(final_config, "strategy", Value("ace"));
  Core::set(final_config, "epochs", Value(epochs));
  Core::set(out, "finalConfiguration", final_config);
  return out;
}

Value AxACE::apply_online_update(Value args) {
  if (!has_generator_) throw AxError("optimize", "AxACE: compile must run before apply_online_update");
  Value example = Core::get(args, "example", Value::object());
  Value prediction = Core::get(args, "prediction");
  last_prediction_ = prediction;
  Value generator_out = generator_output(prediction);
  Value feedback = Core::get(args, "feedback");
  Value reflection = run_reflection_rounds(example, generator_out, feedback);
  Value raw_curator = run_curator(example, reflection);
  std::vector<Value> resolved = normalize_and_resolve(raw_curator, generator_out, reflection);
  Value curator_result;
  if (!raw_curator.is_null() || !resolved.empty()) {
    curator_result = raw_curator.is_null() ? Value::object() : raw_curator;
    Core::set(curator_result, "operations", Value(resolved));
  }
  if (!reflection.is_null()) apply_bullet_tags(reflection);
  std::vector<Value> applied_ids;
  if (!resolved.empty()) {
    applied_ids = apply_operations(resolved, curator_result);
    playbook_ = Core::_ace_dedupe_playbook(playbook_);
  }
  Value feedback_event = Value::object();
  Core::set(feedback_event, "example", example);
  Core::set(feedback_event, "prediction", prediction);
  Core::set(feedback_event, "score", Value(0));
  Core::set(feedback_event, "generatorOutput", generator_out);
  Core::set(feedback_event, "reflection", reflection);
  Core::set(feedback_event, "curator", curator_result);
  Core::set(feedback_event, "timestamp", Value(now_));
  generator_history_.push_back(feedback_event);
  bool has_ops = !curator_result.is_null() && !Core::iter(Core::get(curator_result, "operations", Value::array())).empty();
  if (!applied_ids.empty() && has_ops) {
    Value delta = Value::object();
    Core::set(delta, "source", Value("online"));
    Core::set(delta, "epoch", Value(-1));
    Core::set(delta, "exampleIndex", Value(static_cast<int>(generator_history_.size()) - 1));
    Core::set(delta, "operations", Core::get(curator_result, "operations"));
    Core::set(delta, "updatedBulletIds", Value(applied_ids));
    delta_history_.push_back(delta);
  }
  return curator_result;
}

static const char* kAceReflectorSignature =
    "question:string \"Original task input serialized as JSON\", "
    "generator_answer:string \"Generator output serialized as JSON\", "
    "generator_reasoning?:string \"Generator reasoning trace\", "
    "playbook:string \"Current context playbook rendered as markdown\", "
    "expected_answer?:string \"Expected output when ground truth is available\", "
    "feedback?:string \"External feedback or reward signal\", "
    "previous_reflection?:string \"Most recent reflection JSON when running multi-round refinement\" "
    "-> reasoning:string \"Step-by-step analysis of generator performance\", "
    "errorIdentification:string \"Specific mistakes detected\", "
    "rootCauseAnalysis:string \"Underlying cause of the error\", "
    "correctApproach:string \"What the generator should do differently\", "
    "keyInsight:string \"Reusable insight to remember\", "
    "bulletTags:json \"Array of {id, tag} entries referencing playbook bullets\"";

static const char* kAceCuratorSignature =
    "playbook:string \"Current playbook serialized as JSON\", "
    "reflection:string \"Latest reflection output serialized as JSON\", "
    "question_context:string \"Original task input serialized as JSON\", "
    "token_budget?:number \"Approximate token budget for curator response\" "
    "-> reasoning:string \"Justification for the proposed updates\", "
    "operations:json \"List of operations with type/section/content fields\"";

static const char* kAgentPlaybookWeaknessMinerSignature =
    "clusterSignature:string \"Shared error signature of the cluster\", "
    "taskSummaries:string \"One line per failing task\", "
    "actionLogExcerpts:string \"Excerpts of failing runs centered on the failure\", "
    "functionCallSummary?:string \"Digest of runtime/tool calls\", "
    "toolErrors?:string \"Tool errors observed\", "
    "currentPlaybook?:string \"Current failure-avoidance playbook\" "
    "-> weaknessDescription:string \"Recurring weakness\", "
    "rootCause:string \"Mechanical root cause\", "
    "proposedGuidance:string \"One concise imperative avoidance rule\", "
    "evidenceQuotes:json \"Verbatim substrings copied from actionLogExcerpts\", "
    "configRecommendations?:json \"Setup suggestions no prompt text can fix\"";

static std::string playbook_compose_instruction(const std::string& base, const std::string& rendered) {
  std::vector<std::string> parts;
  std::string base_trimmed = base;
  std::string rendered_trimmed = rendered;
  auto trim = [](std::string& s) {
    size_t start = s.find_first_not_of(" \t\r\n");
    size_t end = s.find_last_not_of(" \t\r\n");
    if (start == std::string::npos) {
      s.clear();
    } else {
      s = s.substr(start, end - start + 1);
    }
  };
  trim(base_trimmed);
  trim(rendered_trimmed);
  std::string out;
  if (!base_trimmed.empty()) out += base_trimmed;
  if (!rendered_trimmed.empty()) {
    if (!out.empty()) out += "\n\n";
    out += rendered_trimmed;
  }
  return out;
}

static std::string playbook_stringify(const Value& value) {
  if (value.is_null()) return std::string();
  if (value.is_string()) return display(value);
  return stringify(value);
}

static Value playbook_option(const Value& options, std::initializer_list<const char*> keys) {
  for (const char* key : keys) {
    Value value = Core::get(options, key);
    if (!value.is_null()) return value;
  }
  return Value();
}

static std::string playbook_collapse(const std::string& value) {
  std::string collapsed = std::regex_replace(value, std::regex("\\s+"), " ");
  size_t start = collapsed.find_first_not_of(' ');
  if (start == std::string::npos) return std::string();
  size_t end = collapsed.find_last_not_of(' ');
  return collapsed.substr(start, end - start + 1);
}

static std::string playbook_error_signature(const std::string& value) {
  std::smatch match;
  if (std::regex_search(value, match, std::regex("^(\\w+Error:\\s*.{0,60})", std::regex_constants::multiline))) {
    return match[1].str();
  }
  return value.substr(0, std::min<size_t>(80, value.size()));
}

static std::string playbook_record_signature(const Value& record) {
  Value prediction = Core::get(record, "prediction", Value::object());
  std::vector<std::pair<std::string, int>> counts;
  for (const auto& signal : Core::iter(Core::get(prediction, "failureSignals", Value::array()))) {
    std::string signature = display(Core::get(signal, "signature", Value("behavioral:no_error")));
    auto found = std::find_if(counts.begin(), counts.end(), [&](const auto& item) { return item.first == signature; });
    int occurrences = static_cast<int>(num(Core::get(signal, "occurrences", Value(1))));
    if (found == counts.end()) counts.push_back({signature, occurrences});
    else found->second += occurrences;
  }
  std::string best;
  int best_count = 0;
  for (const auto& entry : counts) {
    if (entry.second > best_count) {
      best = entry.first;
      best_count = entry.second;
    }
  }
  if (!best.empty()) return best;
  auto tool_errors = Core::iter(Core::get(prediction, "toolErrors", Value::array()));
  if (!tool_errors.empty()) {
    std::string line = display(tool_errors.front());
    size_t newline = line.find('\n');
    if (newline != std::string::npos) line.resize(newline);
    if (line.size() > 100) line.resize(100);
    return line;
  }
  Value error = Core::get(record, "error");
  if (!error.is_null()) return playbook_error_signature(display(error));
  std::string action_log = display(Core::get(prediction, "actionLog", Value("")));
  std::smatch match;
  if (std::regex_search(action_log, match, std::regex("^\\s*(\\w+Error:\\s*.{0,60})", std::regex_constants::multiline))) {
    return playbook_error_signature(match[1].str());
  }
  return "behavioral:no_error";
}

static std::string playbook_failure_excerpt(const Value& record, const std::string& signature) {
  Value error = Core::get(record, "error");
  if (!error.is_null()) return "Run threw: " + display(error);
  std::string action_log = display(Core::get(Core::get(record, "prediction", Value::object()), "actionLog", Value("")));
  if (action_log.size() <= 2000) return action_log;
  std::string needle = signature.substr(0, std::min<size_t>(40, signature.size()));
  size_t hit = action_log.find(needle);
  if (hit == std::string::npos) return action_log.substr(action_log.size() - 2000);
  size_t start = hit > 1000 ? hit - 1000 : 0;
  return action_log.substr(start, std::min<size_t>(2000, action_log.size() - start));
}

AxPlaybook::AxPlaybook(AxGen& program, AIClient& student, AIClient* teacher, Value options)
    : program_(&program), engine_(Value::object()), student_(&student), teacher_(teacher == nullptr ? &student : teacher) {
  if (!options.is_object()) options = Value::object();
  verbose_ = Core::truthy(Core::get(options, "verbose", Value(false)));
  Value engine_options = Value::object();
  Value now_value = Core::get(options, "now");
  if (!now_value.is_null()) Core::set(engine_options, "now", now_value);
  Value max_epochs = playbook_option(options, {"maxEpochs", "max_epochs"});
  if (!max_epochs.is_null()) Core::set(engine_options, "maxEpochs", max_epochs);
  Value max_rounds = playbook_option(options, {"maxReflectorRounds", "max_reflector_rounds"});
  if (!max_rounds.is_null()) Core::set(engine_options, "maxReflectorRounds", max_rounds);
  Value max_section = playbook_option(options, {"maxSectionSize", "max_section_size"});
  if (!max_section.is_null()) Core::set(engine_options, "maxSectionSize", max_section);
  Value dynamic = playbook_option(options, {"allowDynamicSections", "allow_dynamic_sections"});
  if (!dynamic.is_null()) Core::set(engine_options, "allowDynamicSections", dynamic);
  Value initial = playbook_option(options, {"initialPlaybook", "initial_playbook"});
  if (!initial.is_null()) Core::set(engine_options, "initialPlaybook", initial);
  engine_ = AxACE(engine_options);
  Value auto_level = Core::get(options, "auto");
  if (!auto_level.is_null()) engine_.configure_auto(display(auto_level));
  base_instruction_ = display(program.get_instruction());
}

// (Re)bind the engine's reflect/curate/generate callables to this handle. Called
// at the start of evolve()/update() so the captured `this` is always the final
// (post-move) object, since an AxPlaybook is returned by value from playbook().
void AxPlaybook::bind_callables() {
  engine_.set_callables(
      [this](const Value& payload) { return run_reflector(payload); },
      [this](const Value& payload) { return run_curator(payload); },
      [this](const Value& example) { return run_generator(example); });
}

// The real LLM generator: run the bound program with the student client.
Value AxPlaybook::run_generator(const Value& example) {
  if (program_ == nullptr) return Value::object();
  inject();
  Value prediction = program_->forward(*student_, example);
  last_prediction_ = prediction;
  return prediction;
}

// The real LLM reflector: a focused AxGen sub-program driven by the teacher.
Value AxPlaybook::run_reflector(const Value& payload) {
  if (!reflector_program_) reflector_program_ = std::make_unique<AxGen>(s(kAceReflectorSignature));
  Value request = Value::object();
  Core::set(request, "question", Value(playbook_stringify(Core::get(payload, "question"))));
  Core::set(request, "generator_answer", Value(playbook_stringify(Core::get(payload, "generator_answer"))));
  Core::set(request, "playbook", Core::get(payload, "playbook", Value("")));
  Value reasoning = Core::get(payload, "generator_reasoning");
  if (!reasoning.is_null()) Core::set(request, "generator_reasoning", reasoning);
  Value feedback = Core::get(payload, "feedback");
  if (!feedback.is_null()) Core::set(request, "feedback", feedback);
  Value previous = Core::get(payload, "previous_reflection");
  if (!previous.is_null()) Core::set(request, "previous_reflection", Value(playbook_stringify(previous)));
  try {
    return reflector_program_->forward(*teacher_, request);
  } catch (const std::exception& e) {
    if (verbose_) std::cerr << "[AxPlaybook] reflector error: " << e.what() << "\n";
    return Value();
  }
}

// The real LLM curator: a focused AxGen sub-program driven by the teacher.
Value AxPlaybook::run_curator(const Value& payload) {
  if (!curator_program_) curator_program_ = std::make_unique<AxGen>(s(kAceCuratorSignature));
  Value request = Value::object();
  Core::set(request, "playbook", Core::get(payload, "playbook", Value("")));
  Core::set(request, "reflection", Value(playbook_stringify(Core::get(payload, "reflection"))));
  Core::set(request, "question_context", Value(playbook_stringify(Core::get(payload, "question_context"))));
  Core::set(request, "token_budget", Core::get(payload, "token_budget", Value(1024)));
  try {
    return curator_program_->forward(*teacher_, request);
  } catch (const std::exception& e) {
    if (verbose_) std::cerr << "[AxPlaybook] curator error: " << e.what() << "\n";
    return Value();
  }
}

Value AxPlaybook::evolve(const std::vector<Value>& examples, const MetricFn& metric_fn, Value options) {
  bind_callables();
  if (!options.is_object()) options = Value::object();
  Value auto_level = Core::get(options, "auto");
  if (!auto_level.is_null()) engine_.configure_auto(display(auto_level));
  Value ace_options = Value::object();
  Value max_epochs = playbook_option(options, {"maxEpochs", "max_epochs"});
  if (!max_epochs.is_null()) Core::set(ace_options, "maxEpochs", max_epochs);
  AxACE::AceCallable wrapped_metric = [this, &metric_fn](const Value& example) -> Value {
    if (!metric_fn) return Value(0);
    Value args = Value::object();
    Core::set(args, "prediction", last_prediction_);
    Core::set(args, "example", example);
    return metric_fn(args);
  };
  Value result = engine_.compile(examples, wrapped_metric, object({{"aceOptions", ace_options}}));
  started_ = true;
  inject();
  Value out = Value::object();
  Core::set(out, "bestScore", Core::get(result, "bestScore", Value(0)));
  Core::set(out, "playbook", Core::get(result, "playbook"));
  return out;
}

Value AxPlaybook::update(Value args) {
  bind_callables();
  if (!started_) {
    Value state = Value::object();
    Core::set(state, "playbook", engine_.get_playbook());
    engine_.hydrate(state);
    started_ = true;
  }
  Value result = engine_.apply_online_update(args.is_null() ? Value::object() : args);
  inject();
  return result;
}

void AxPlaybook::apply_to(AxGen* program) {
  if (program != nullptr && program != program_) {
    program->set_instruction(Value(playbook_compose_instruction(display(program->get_instruction()), render())));
    return;
  }
  inject();
}

std::string AxPlaybook::render() const {
  return display(Core::_ace_render_playbook(engine_.get_playbook()));
}

Value AxPlaybook::get_state() const {
  Value out = Value::object();
  Core::set(out, "playbook", engine_.get_playbook());
  Core::set(out, "artifact", engine_.get_artifact());
  return out;
}

Value AxPlaybook::to_json() const { return get_state(); }

AxPlaybook& AxPlaybook::load(Value snapshot) {
  if (!snapshot.is_object()) snapshot = Value::object();
  Value state = Value::object();
  Core::set(state, "playbook", Core::get(snapshot, "playbook"));
  Core::set(state, "artifact", Core::get(snapshot, "artifact"));
  engine_.hydrate(state);
  started_ = true;
  inject();
  return *this;
}

void AxPlaybook::configure_auto(const std::string& level) { engine_.configure_auto(level); }

void AxPlaybook::reset() {
  engine_.reset();
  started_ = false;
}

void AxPlaybook::set_apply_hook(std::function<void(const std::string&)> hook) { apply_hook_ = std::move(hook); }

AxPlaybook& AxPlaybook::bind_agent(AxAgent& agent) {
  agent_ = &agent;
  return *this;
}

Value AxPlaybook::evolve(Value dataset, Value options) {
  if (agent_ == nullptr) throw AxError("validation", "AxAgent.playbook().evolve() requires an agent-bound playbook");
  if (!options.is_object()) options = Value::object();
  Value normalized = Core::_normalize_optimization_dataset(dataset.is_null() ? Value::array() : dataset);
  std::vector<Value> train = Core::iter(Core::get(normalized, "train", Value::array()));
  std::vector<Value> validation = Core::iter(Core::get(normalized, "validation", Value::array()));
  if (train.empty()) throw AxError("validation", "AxAgent.playbook().evolve(): at least one training task is required.");
  double threshold = num(Core::get(options, "scoreThreshold", Core::get(options, "score_threshold", Value(0.7))));
  double min_gain = num(Core::get(options, "minHeldInGain", Core::get(options, "min_held_in_gain", Value(0.05))));
  double epsilon = num(Core::get(options, "epsilon", Value(0.01)));
  size_t max_proposals = static_cast<size_t>(std::max(1.0, num(Core::get(options, "maxProposals", Core::get(options, "max_proposals", Value(4))))));
  bool verify = !Core::truthy(Core::eq(Core::get(options, "verify", Value(true)), Value(false)));
  int runs_per_task = std::max(1, static_cast<int>(num(Core::get(options, "runsPerTask", Core::get(options, "runs_per_task", Value(1))))));
  int dataset_size = static_cast<int>(train.size() + validation.size()) * runs_per_task;
  int max_metric_calls = std::max(1, static_cast<int>(num(Core::get(options, "maxMetricCalls", Core::get(options, "max_metric_calls", Value(std::max(100, (static_cast<int>(max_proposals) + 1) * dataset_size)))))));
  int remaining = max_metric_calls;
  auto run_batch = [&](const std::vector<Value>& tasks) {
    Array records;
    double weighted_sum = 0;
    double weight_sum = 0;
    bool exhausted = false;
    for (size_t task_index = 0; task_index < tasks.size(); ++task_index) {
      const auto& raw_task = tasks[task_index];
      Value task = raw_task.is_object() ? raw_task : object({{"input", raw_task}});
      Value prediction;
      std::string last_error;
      double score_sum = 0;
      int completed_runs = 0;
      for (int run = 0; run < runs_per_task; ++run) {
        if (remaining <= 0) { exhausted = true; break; }
        --remaining;
        double score = 0;
        try {
          prediction = agent_->evaluate_optimization_task(*student_, task, options);
          Value default_score = Core::truthy(Core::eq(Core::get(prediction, "completionType", Value("")), Value("error"))) ? Value(0) : Value(1);
          Value raw_score = Core::get(task, "metric_score", Core::get(task, "scores", Core::get(task, "score", default_score)));
          score = num(Core::_scalarize_optimization_scores(Core::_normalize_optimization_metric_scores(raw_score), options));
          if (!std::isfinite(score)) score = 0;
        } catch (const std::exception& error) {
          score = 0;
          last_error = error.what();
        }
        score_sum += score;
        ++completed_runs;
      }
      if (completed_runs == 0) break;
      double score = score_sum / static_cast<double>(completed_runs);
      double weight = num(Core::get(task, "weight", Value(1)));
      weighted_sum += weight * score;
      weight_sum += weight;
      Value record = object({{"task", task}, {"index", Value(static_cast<double>(task_index))}, {"score", Value(score)}, {"passed", Value(score >= threshold && display(Core::get(prediction, "completionType", Value(""))) == "final")}});
      if (!prediction.is_null()) Core::set(record, "prediction", prediction);
      else if (!last_error.empty()) Core::set(record, "error", Value(last_error));
      records.push_back(record);
      if (completed_runs < runs_per_task) break;
    }
    if (records.size() < tasks.size()) exhausted = true;
    return object({{"records", Value(records)}, {"mean", Value(weight_sum == 0 ? 0.0 : weighted_sum / weight_sum)}, {"exhausted", Value(exhausted)}});
  };
  Value baseline_batch = run_batch(train);
  double baseline_held_in = num(Core::get(baseline_batch, "mean", Value(0)));
  double held_in = baseline_held_in;
  double held_out = validation.empty() ? std::numeric_limits<double>::quiet_NaN() : num(Core::get(run_batch(validation), "mean", Value(0)));
  double baseline_held_out = held_out;
  std::vector<std::pair<std::string, std::vector<Value>>> clusters;
  for (const auto& record : Core::iter(Core::get(baseline_batch, "records", Value::array()))) {
    Value prediction = Core::get(record, "prediction", Value::object());
    double score = num(Core::get(record, "score", Value(0)));
    std::string completion = display(Core::get(prediction, "completionType", Value("")));
    if (Core::get(record, "error").is_null() && score >= threshold && completion == "final") continue;
    std::string signature = playbook_record_signature(record);
    auto cluster = std::find_if(clusters.begin(), clusters.end(), [&](const auto& entry) { return entry.first == signature; });
    if (cluster == clusters.end()) clusters.push_back({signature, {record}});
    else cluster->second.push_back(record);
  }
  std::vector<std::pair<std::string, std::vector<Value>>> ranked = clusters;
  std::stable_sort(ranked.begin(), ranked.end(), [](const auto& left, const auto& right) {
    auto severity = [](const auto& records) { double out = 0; for (const auto& record : records) out += 1.0 - num(Core::get(record, "score", Value(0))); return out; };
    return severity(left.second) > severity(right.second);
  });
  if (ranked.size() > max_proposals) ranked.resize(max_proposals);
  Value initial = parse_json(stringify(get_state()));
  Array outcomes;
  Array weaknesses;
  size_t index = 0;
  for (const auto& cluster : ranked) {
    ++index;
    std::vector<Value> selected(cluster.second.begin(), cluster.second.begin() + std::min<size_t>(4, cluster.second.size()));
    std::vector<std::string> bodies;
    std::string excerpts;
    std::string task_summaries;
    std::vector<std::string> function_calls;
    std::vector<std::string> tool_errors;
    for (size_t record_index = 0; record_index < selected.size(); ++record_index) {
      const Value& record = selected[record_index];
      std::string body = playbook_failure_excerpt(record, cluster.first);
      bodies.push_back(body);
      if (!excerpts.empty()) excerpts += "\n\n";
      excerpts += "--- run " + std::to_string(record_index + 1) + " ---\n" + body;
      Value task = Core::get(record, "task", Value::object());
      std::string label = Core::get(task, "id").is_null() ? "#" + std::to_string(record_index + 1) : display(Core::get(task, "id"));
      std::string input = stringify(Core::get(task, "input"));
      if (input.size() > 240) input.resize(240);
      if (!task_summaries.empty()) task_summaries += "\n";
      std::ostringstream score_text;
      score_text << std::fixed << std::setprecision(2) << num(Core::get(record, "score", Value(0)));
      task_summaries += "- " + label + " (score " + score_text.str() + "): " + input;
      Value prediction = Core::get(record, "prediction", Value::object());
      for (const auto& call : Core::iter(Core::get(prediction, "functionCalls", Value::array()))) {
        if (function_calls.size() < 20) function_calls.push_back(stringify(call));
      }
      for (const auto& error : Core::iter(Core::get(prediction, "toolErrors", Value::array()))) {
        if (tool_errors.size() < 10) tool_errors.push_back(display(error));
      }
    }
    bool has_body = std::any_of(bodies.begin(), bodies.end(), [](const std::string& body) { return !playbook_collapse(body).empty(); });
    if (!has_body) continue;
    Value miner_request = object({
        {"clusterSignature", Value(cluster.first)},
        {"taskSummaries", Value(task_summaries)},
        {"actionLogExcerpts", Value(excerpts)},
    });
    if (!function_calls.empty()) {
      std::string joined;
      for (const auto& call : function_calls) { if (!joined.empty()) joined += "\n"; joined += call; }
      Core::set(miner_request, "functionCallSummary", Value(joined));
    }
    if (!tool_errors.empty()) {
      std::string joined;
      for (const auto& error : tool_errors) { if (!joined.empty()) joined += "\n"; joined += error; }
      Core::set(miner_request, "toolErrors", Value(joined));
    }
    std::string current_playbook = render();
    if (!playbook_collapse(current_playbook).empty()) Core::set(miner_request, "currentPlaybook", Value(current_playbook));
    Value mined;
    try {
      AxGen miner(s(kAgentPlaybookWeaknessMinerSignature), object({
          {"id", "agent.playbook.weakness-miner"},
          {"instruction", "Identify one recurring weakness and one narrow durable avoidance rule. Every evidence quote must be copied verbatim from actionLogExcerpts."},
      }));
      mined = miner.forward(*teacher_, miner_request);
    } catch (...) {
      continue;
    }
    std::vector<Value> quote_candidates;
    Value raw_quotes = Core::get(mined, "evidenceQuotes");
    if (raw_quotes.is_array()) quote_candidates = Core::iter(raw_quotes);
    else if (!raw_quotes.is_null()) quote_candidates.push_back(raw_quotes);
    Array evidence;
    std::string haystack = playbook_collapse(excerpts);
    for (const auto& quote : quote_candidates) {
      std::string text = display(quote);
      std::string needle = playbook_collapse(text);
      if (!needle.empty() && haystack.find(needle) != std::string::npos) evidence.push_back(Value(text));
    }
    if (evidence.empty()) continue;
    Array task_ids;
    for (size_t record_index = 0; record_index < cluster.second.size(); ++record_index) {
      Value task = Core::get(cluster.second[record_index], "task", Value::object());
      size_t task_index = static_cast<size_t>(num(Core::get(cluster.second[record_index], "index", Value(static_cast<double>(record_index)))));
      task_ids.push_back(Core::get(task, "id").is_null() ? Value("task-" + std::to_string(task_index)) : Core::get(task, "id"));
    }
    Array recommendations;
    Value raw_recommendations = Core::get(mined, "configRecommendations");
    if (raw_recommendations.is_array()) recommendations = Core::iter(raw_recommendations);
    else if (!raw_recommendations.is_null()) recommendations.push_back(Value(display(raw_recommendations)));
    Value weakness = object({
        {"id", Value("weakness-" + std::to_string(index))},
        {"clusterSignature", Value(cluster.first)},
        {"description", Value(display(Core::get(mined, "weaknessDescription", Value(""))))},
        {"rootCause", Value(display(Core::get(mined, "rootCause", Value(""))))},
        {"proposedGuidance", Value(display(Core::get(mined, "proposedGuidance", Value(""))))},
        {"evidenceQuotes", Value(evidence)},
        {"taskIds", Value(task_ids)},
        {"configRecommendations", Value(recommendations)},
    });
    weaknesses.push_back(weakness);
    Value proposal = object({{"weaknessId", Core::get(weakness, "id")}, {"clusterSignature", Value(cluster.first)}, {"feedback", Value("")}});
    int required_calls = static_cast<int>(train.size() + validation.size()) * runs_per_task;
    if (verify && remaining < required_calls) {
      outcomes.push_back(object({{"proposal", proposal}, {"accepted", false}, {"reason", "metric_budget exhausted before validation"}, {"heldIn", object({{"before", held_in}, {"after", held_in}})}}));
      continue;
    }
    Value before = parse_json(stringify(get_state()));
    std::string quote_lines;
    auto grounded_quotes = Core::iter(Core::get(weakness, "evidenceQuotes", Value::array()));
    for (size_t quote_index = 0; quote_index < std::min<size_t>(3, grounded_quotes.size()); ++quote_index) {
      if (!quote_lines.empty()) quote_lines += "\n";
      quote_lines += "- " + display(grounded_quotes[quote_index]);
    }
    std::string feedback = "A recurring agent weakness was diagnosed from real failed runs.\n\n"
        "Weakness: " + display(Core::get(weakness, "description", Value(""))) + "\n"
        "Root cause: " + display(Core::get(weakness, "rootCause", Value(""))) + "\n"
        "Error signature: [" + cluster.first + "]\nGrounding excerpts:\n" + quote_lines +
        "\n\nCurate ONE durable rule into the playbook (suggested section: \"failures_to_avoid\"): " +
        display(Core::get(weakness, "proposedGuidance", Value(""))) +
        "\nUPDATE an existing bullet if one already covers this failure mode.";
    Core::set(proposal, "feedback", feedback);
    try {
      update(object({{"example", object({{"task", Value("playbook.evolve(): repair a diagnosed agent weakness")}, {"failureSignatures", array({Value(cluster.first)})}})}, {"prediction", Value::object()}, {"feedback", Value(feedback)}}));
    } catch (const std::exception& error) {
      outcomes.push_back(object({{"proposal", proposal}, {"accepted", false}, {"reason", Value("apply failed: " + std::string(error.what()))}, {"heldIn", object({{"before", held_in}, {"after", held_in}})}}));
      continue;
    }
    bool accepted = true;
    double next_in = held_in;
    double next_out = held_out;
    bool reeval_complete = true;
    if (verify) {
      Value train_batch = run_batch(train);
      next_in = num(Core::get(train_batch, "mean", Value(0)));
      Value validation_batch = validation.empty() ? object({{"mean", Value(std::numeric_limits<double>::quiet_NaN())}, {"exhausted", false}}) : run_batch(validation);
      next_out = num(Core::get(validation_batch, "mean", Value(0)));
      reeval_complete = !Core::truthy(Core::get(train_batch, "exhausted", false)) && !Core::truthy(Core::get(validation_batch, "exhausted", false));
      accepted = reeval_complete && next_in - held_in >= min_gain && (std::isnan(next_out) || std::isnan(held_out) || next_out - held_out >= -epsilon);
    }
    std::string reason = !reeval_complete ? "metric_budget exhausted during re-evaluation" : !verify ? "applied without verification (verify: false)" : accepted ? (std::isnan(held_out) ? "held-in improved (no held-out set provided — consider one)" : "held-in improved, held-out non-regressing") : next_in - held_in < min_gain ? "held-in gain below threshold" : "held-out regressed";
    Value outcome = object({{"proposal", proposal}, {"accepted", Value(accepted)}, {"reason", Value(reason)}, {"heldIn", object({{"before", Value(held_in)}, {"after", Value(next_in)}})}});
    if (!std::isnan(next_out) && !std::isnan(held_out)) Core::set(outcome, "heldOut", object({{"before", held_out}, {"after", next_out}}));
    outcomes.push_back(outcome);
    if (accepted) { held_in = next_in; held_out = next_out; } else { load(before); }
  }
  bool any_accepted = false;
  for (const auto& outcome : outcomes) if (Core::truthy(Core::get(outcome, "accepted", Value(false)))) any_accepted = true;
  Value learned = any_accepted ? parse_json(stringify(get_state())) : Value();
  if (Core::truthy(Core::eq(Core::get(options, "apply", Value(true)), Value(false))) && !learned.is_null()) load(initial);
  Value baseline_result = object({{"heldIn", Value(baseline_held_in)}});
  Value final_result = object({{"heldIn", Value(held_in)}});
  if (!std::isnan(baseline_held_out)) Core::set(baseline_result, "heldOut", baseline_held_out);
  if (!std::isnan(held_out)) Core::set(final_result, "heldOut", held_out);
  Array all_recommendations;
  for (const auto& weakness : weaknesses) {
    for (const auto& recommendation : Core::iter(Core::get(weakness, "configRecommendations", Value::array()))) {
      all_recommendations.push_back(Value(display(recommendation)));
    }
  }
  Value result = object({{"baseline", baseline_result}, {"final", final_result}, {"weaknesses", Value(weaknesses)}, {"outcomes", Value(outcomes)}, {"recommendations", Value(all_recommendations)}, {"metricCallsUsed", max_metric_calls - remaining}, {"records", Core::get(baseline_batch, "records", Value::array())}});
  if (!learned.is_null()) Core::set(result, "playbookSnapshot", learned);
  return result;
}

void AxPlaybook::inject() {
  std::string rendered = render();
  if (apply_hook_) {
    apply_hook_(rendered);
    return;
  }
  if (program_ != nullptr) {
    program_->set_instruction(Value(playbook_compose_instruction(base_instruction_, rendered)));
  }
}

AxPlaybook playbook(AxGen& program, AIClient& student, Value options, AIClient* teacher) {
  return AxPlaybook(program, student, teacher, std::move(options));
}

Value AxGen::evaluate_optimization(AIClient& client, Value dataset, Value candidate_map, Value options) {
  Value normalized = Core::_normalize_optimization_dataset(dataset.is_null() ? Value::array() : dataset);
  Value rows = Value::array();
  Value original = Core::_optimization_component_current_map(get_optimizable_components());
  try {
    if (Core::truthy(candidate_map)) apply_optimized_components(candidate_map);
    for (const auto& raw_task : Core::iter(Core::get(normalized, "train", Value::array()))) {
      Value task = raw_task;
      Value prediction = Value::object();
      Value error;
      try {
        Value output = forward(client, Core::get(task, "input", task), Core::get(options, "forward_options", Value::object()));
        prediction = object({{"completionType", "final"}, {"output", output}, {"finalOutput", output}, {"functionCalls", get_function_call_traces()}, {"actionLog", get_chat_log()}, {"usage", Value::object()}, {"trace", object({{"traces", get_traces()}})}});
      } catch (const AxError& e) {
        error = object({{"message", Value(std::string(e.what()))}});
        prediction = object({{"completionType", "error"}, {"error", error}, {"functionCalls", get_function_call_traces()}, {"actionLog", get_chat_log()}, {"usage", Value::object()}, {"trace", object({{"traces", get_traces()}})}});
      }
      Value default_score = Core::truthy(Core::eq(Core::get(prediction, "completionType", Value("")), Value("error"))) ? Value(0) : Value(1);
      Value raw_score = Core::get(task, "metric_score", Core::get(task, "scores", Core::get(task, "score", default_score)));
      Value scores = Core::_normalize_optimization_metric_scores(raw_score);
      Value scalar = Core::_adjust_optimization_score_for_actions(Core::_scalarize_optimization_scores(scores, options), task, prediction);
      Core::append(rows, Core::_build_optimization_eval_row(task, prediction, scores, scalar, Core::get(prediction, "trace"), error));
    }
    Value result = Core::_build_optimization_eval_result(rows, candidate_map, Core::get(options, "phase", Value("train")));
    apply_optimized_components(original);
    return result;
  } catch (...) {
    apply_optimized_components(original);
    throw;
  }
}

struct AxGenOptimizerEvaluator : OptimizerEvaluator {
  AxGen& gen;
  AIClient& client;
  Value dataset;
  Value options;
  AxGenOptimizerEvaluator(AxGen& gen_, AIClient& client_, Value dataset_, Value options_)
      : gen(gen_), client(client_), dataset(std::move(dataset_)), options(std::move(options_)) {}
  Value evaluate(Value candidate_map, Value eval_options = Value::object()) override {
    Value merged = Core::map_merge(options, eval_options);
    Value eval_dataset = Core::get(merged, "dataset", Core::get(merged, "_dataset", dataset));
    return gen.evaluate_optimization(client, eval_dataset, std::move(candidate_map), merged);
  }
};

Value AxGen::optimize_with(OptimizerEngine& engine, Value dataset, Value options) {
  Value components = get_optimizable_components();
  Value run = Core::_prepare_optimizer_run(Value("axgen"), components, dataset.is_null() ? Value::array() : dataset, options, object({{"traces", get_traces()}, {"chat_log", get_chat_log()}}), Value(false));
  Value request = Core::get(run, "request", Value::object());
  Value artifact = Core::_normalize_optimizer_engine_response(engine.optimize(request), Value(engine.name()), Value(engine.version()), components);
  if (Core::truthy(Core::get(options, "apply", Value(true)))) apply_optimization(artifact);
  return artifact;
}

Value AxGen::optimize_with(OptimizerEngine& engine, AIClient& client, Value dataset, Value options) {
  Value components = get_optimizable_components();
  Value run = Core::_prepare_optimizer_run(Value("axgen"), components, dataset.is_null() ? Value::array() : dataset, options, object({{"traces", get_traces()}, {"chat_log", get_chat_log()}}), Value(true));
  Value request = Core::get(run, "request", Value::object());
  AxGenOptimizerEvaluator evaluator(*this, client, dataset, options);
  Value artifact = Core::_normalize_optimizer_engine_response(engine.optimize(request, &evaluator), Value(engine.name()), Value(engine.version()), components);
  if (Core::truthy(Core::get(options, "apply", Value(true)))) apply_optimization(artifact);
  return artifact;
}

Value AxGen::get_traces() const {
  return Core::get(state_, "traces", Value::array());
}

Value AxGen::get_chat_log() const {
  return Core::get(state_, "chat_log", Value::array());
}

Value AxGen::get_function_call_traces() const {
  return Core::get(state_, "function_call_traces", Value::array());
}

AxMemory& AxGen::get_memory() {
  memory_.value_ref() = Core::get(state_, "memory", memory_.value());
  return memory_;
}

Value AxGen::forward(AIClient& client, Value values, Value options) {
  return Core::_forward_impl(state_, Core::client_ref(client), std::move(values), std::move(options));
}

Value AxGen::value() const { return state_; }

AxFlow::AxFlow(Value options) {
  state_ = Core::_flow_factory(std::move(options));
  Core::set(state_, "mermaidPercent", "%");
  Core::set(state_, "mermaidOpenBrace", "{");
  Core::set(state_, "mermaidCloseBrace", "}");
}

AxFlow::AxFlow(std::string mermaid, Value bindings) {
  state_ = Core::_flow_from_mermaid(Value(std::move(mermaid)), bindings);
  Core::set(state_, "mermaidPercent", "%");
  Core::set(state_, "mermaidOpenBrace", "{");
  Core::set(state_, "mermaidCloseBrace", "}");
  Value steps = hydrate_mermaid_steps(Core::get(state_, "steps", Value::array()), bindings);
  Core::set(state_, "steps", std::move(steps));
}

AxFlow& AxFlow::execute(std::string name, AxProgram& program, Value options) {
  if (auto* gen = dynamic_cast<AxGen*>(&program)) {
    Value signature = Core::get(gen->value(), "signature");
    Core::set(options, "signatureText", Core::signature_to_string(signature));
  }
  return add_step(Value("execute"), Value(std::move(name)), Core::agent_stage_ref(program), std::move(options));
}

Value AxFlow::hydrate_mermaid_steps(Value steps, Value bindings) {
  Value out = Value::array();
  Value nodes = Core::get(bindings, "nodes", Value::object());
  for (const auto& raw : array_ref(steps)) {
    Value step = raw;
    std::string name = display(Core::get(step, "name", ""));
    Value binding = Core::get(nodes, name);
    Value program = binding.is_null() ? Core::get(step, "program") : binding;
    if (program.is_object() && !Core::get(program, "__flow_mapper_id").is_null()) {
      Core::set(step, "kind", "map");
      Core::set(step, "program", program);
    } else if (program.is_string()) {
      auto gen = std::make_shared<AxGen>(Core::parse_signature(program), Core::get(step, "options", Value::object()));
      Core::set(step, "program", Core::agent_stage_ref(*gen));
      mermaid_programs_.push_back(std::move(gen));
    } else if (!program.is_null()) {
      Core::set(step, "program", program);
    }
    Value options = Core::get(step, "options", Value::object());
    Value nested = Core::get(options, "steps", Value::array());
    if (nested.is_array() && !array_ref(nested).empty()) {
      Core::set(options, "steps", hydrate_mermaid_steps(nested, bindings));
      Core::set(step, "options", options);
    }
    Core::append(out, step);
  }
  return out;
}

AxFlow& AxFlow::derive(std::string name, AxProgram& program, Value options) {
  return add_step(Value("derive"), Value(std::move(name)), Core::agent_stage_ref(program), std::move(options));
}

AxFlow& AxFlow::map(std::string name, std::function<Value(Value)> mapper) {
  return map(std::move(name), std::move(mapper), Value::object());
}

AxFlow& AxFlow::map(std::string name, std::function<Value(Value)> mapper, Value options) {
  return add_step(Value("map"), Value(std::move(name)), register_flow_mapper(pointer_id(this), std::move(mapper)), std::move(options));
}

AxFlow& AxFlow::branch(std::string name, std::function<Value(Value)> predicate, Value branches, Value options) {
  Core::set(options, "predicate", register_flow_mapper(pointer_id(this), std::move(predicate)));
  Core::set(options, "branches", std::move(branches));
  return add_step(Value("branch"), Value(std::move(name)), Value(), std::move(options));
}

AxFlow& AxFlow::while_loop(std::string name, std::function<Value(Value)> condition, Value steps, int max_iterations, Value options) {
  Core::set(options, "condition", register_flow_mapper(pointer_id(this), std::move(condition)));
  Core::set(options, "steps", std::move(steps));
  Core::set(options, "maxIterations", Value(static_cast<double>(max_iterations)));
  return add_step(Value("while"), Value(std::move(name)), Value(), std::move(options));
}

AxFlow& AxFlow::feedback(std::string name, std::function<Value(Value)> condition, Value steps, int max_iterations, Value options) {
  Core::set(options, "condition", register_flow_mapper(pointer_id(this), std::move(condition)));
  Core::set(options, "steps", std::move(steps));
  Core::set(options, "maxIterations", Value(static_cast<double>(max_iterations)));
  Core::set(options, "label", Value(name));
  return add_step(Value("feedback"), Value(std::move(name)), Value(), std::move(options));
}

AxFlow& AxFlow::node_extended(std::string name, Value base_signature, Value extensions, Value options) {
  Value signature = Core::get(extensions, "extended_signature", Core::get(extensions, "extendedSignature", base_signature));
  auto* gen = new AxGen(Core::parse_signature(signature), options);
  return execute(std::move(name), *gen, std::move(options));
}

AxFlow& AxFlow::nx(std::string name, Value base_signature, Value extensions, Value options) {
  return node_extended(std::move(name), std::move(base_signature), std::move(extensions), std::move(options));
}

AxFlow& AxFlow::parallel(Value steps) {
  for (const auto& raw_step : array_ref(steps)) {
    Value step = raw_step;
    add_step(
      Core::get(step, "kind", Value("execute")),
      Core::get(step, "name", Value("parallel")),
      Core::get(step, "program", Value()),
      Core::get(step, "options", Value::object())
    );
  }
  return *this;
}

AxFlow& AxFlow::returns(Value spec) {
  state_ = Core::_flow_set_returns(state_, std::move(spec));
  return *this;
}

AxFlow& AxFlow::set_demos(Value demos) {
  if (demos.is_array()) {
    std::string owner = ::axllm::str(Core::get(state_, "program_id", Value("root.flow")));
    std::set<std::string> known_ids;
    known_ids.insert(owner);
    known_ids.insert("root");
    Value steps = Core::get(state_, "steps", Value::array());
    for (const auto& raw_step : array_ref(steps)) {
      std::string name = ::axllm::str(Core::get(raw_step, "name", Value("")));
      if (!name.empty()) {
        known_ids.insert(owner + "." + name);
        known_ids.insert("root." + name);
      }
    }
    std::set<std::string> unknown;
    for (const auto& raw_demo : array_ref(demos)) {
      Value id = Core::get(raw_demo, "programId", Value());
      if (!id.is_null() && known_ids.find(::axllm::str(id)) == known_ids.end()) unknown.insert(::axllm::str(id));
    }
    if (!unknown.empty()) throw AxError("runtime", "Unknown program ID(s) in demos: " + *unknown.begin());
    Core::set(state_, "demos", std::move(demos));
    return *this;
  }
  Value steps = Core::get(state_, "steps", Value::array());
  for (const auto& kv : object_ref(demos)) {
    if (kv.first == "__order") continue;
    bool found = false;
    for (const auto& raw_step : array_ref(steps)) {
      if (::axllm::str(Core::get(raw_step, "name", Value(""))) == kv.first) found = true;
    }
    if (!found) throw AxError("runtime", "unknown flow node in demos: " + kv.first);
  }
  Core::set(state_, "demos", std::move(demos));
  return *this;
}

Value AxFlow::forward(AIClient& client, Value values, Value options) {
  return Core::_flow_forward(state_, Core::client_ref(client), std::move(values), std::move(options));
}

Value AxFlow::streaming_forward(AIClient& client, Value values, Value options) {
  return array({object({{"version", Value(1)}, {"index", Value(0)}, {"delta", forward(client, std::move(values), std::move(options))}})});
}

Value AxFlow::get_plan() const { return Core::_flow_plan(state_); }
Value AxFlow::get_traces() const { return Core::get(state_, "traces", Value::array()); }
Value AxFlow::get_chat_log() const { return Core::get(state_, "chat_log", Value::array()); }
Value AxFlow::get_usage() const { return Core::get(state_, "usage", Value::object()); }

Value AxFlow::get_optimizable_components() const { return Core::_flow_get_optimizable_components(state_); }

AxFlow& AxFlow::apply_optimized_components(Value component_map) {
  Core::_flow_apply_optimized_components(state_, std::move(component_map));
  return *this;
}
AxFlow& AxFlow::apply_optimization(Value artifact) {
  Value components = get_optimizable_components();
  Value map = artifact.is_string() ? Core::_deserialize_optimized_artifact(artifact, components) : Core::_validate_optimized_artifact(artifact, components);
  return apply_optimized_components(Core::get(map, "componentMap", Value::object()));
}
Value AxFlow::evaluate_optimization(AIClient& client, Value dataset, Value candidate_map, Value options) {
  return Core::_flow_evaluate_optimization(state_, Core::client_ref(client), std::move(dataset), std::move(candidate_map), std::move(options));
}
struct AxFlowOptimizerEvaluator : OptimizerEvaluator {
  AxFlow& flow;
  AIClient& client;
  Value dataset;
  Value options;
  AxFlowOptimizerEvaluator(AxFlow& flow_, AIClient& client_, Value dataset_, Value options_)
      : flow(flow_), client(client_), dataset(std::move(dataset_)), options(std::move(options_)) {}
  Value evaluate(Value candidate_map, Value eval_options = Value::object()) override {
    Value merged = Core::map_merge(options, eval_options);
    Value eval_dataset = Core::get(merged, "dataset", Core::get(merged, "_dataset", dataset));
    return flow.evaluate_optimization(client, eval_dataset, std::move(candidate_map), merged);
  }
};
Value AxFlow::optimize_with(OptimizerEngine& engine, Value dataset, Value options) {
  Value request = Core::_flow_optimize_with(state_, dataset, options, Value(false));
  Value artifact = Core::_normalize_optimizer_engine_response(engine.optimize(request), Value(engine.name()), Value(engine.version()), get_optimizable_components());
  if (!Core::truthy(Core::eq(Core::get(options, "apply", Value(true)), Value(false)))) apply_optimization(artifact);
  return artifact;
}
Value AxFlow::optimize_with(OptimizerEngine& engine, AIClient& client, Value dataset, Value options) {
  Value request = Core::_flow_optimize_with(state_, dataset, options, Value(true));
  AxFlowOptimizerEvaluator evaluator(*this, client, dataset, options);
  Value artifact = Core::_normalize_optimizer_engine_response(engine.optimize(request, &evaluator), Value(engine.name()), Value(engine.version()), get_optimizable_components());
  if (!Core::truthy(Core::eq(Core::get(options, "apply", Value(true)), Value(false)))) apply_optimization(artifact);
  return artifact;
}
Value AxFlow::value() const { return state_; }

std::string AxFlow::str(Value options) const {
  return display(Core::_flow_to_mermaid(state_, std::move(options)));
}

AxFlow& AxFlow::add_raw_step(Value step) {
  state_ = Core::_flow_add_step(state_, std::move(step));
  return *this;
}

AxFlow& AxFlow::add_step(Value kind, Value name, Value program, Value options) {
  state_ = Core::_flow_add_step(state_, Core::_flow_step(std::move(kind), std::move(name), std::move(program), std::move(options)));
  return *this;
}

AxAgent::AxAgent(Value signature, Value options) {
  options_ = options;
  playbook_config_ = Core::get(options, "playbook", Value());
  state_ = Core::_agent_factory(std::move(signature), options);
  distiller_ = std::make_unique<AxGen>(s(str(Core::get(state_, "distiller_signature"))), object({{"validation_retries", 0}, {"id", "ctx.root.actor"}, {"instruction", Core::get(state_, "distiller_description", "")}}));
  executor_ = std::make_unique<AxGen>(s(str(Core::get(state_, "executor_signature"))), object({{"validation_retries", 0}, {"id", "task.root.actor"}, {"instruction", Core::get(state_, "executor_description", "")}}));
  responder_ = std::make_unique<AxGen>(s(str(Core::get(state_, "responder_signature"))), object({{"validation_retries", Core::get(options, "validation_retries", 2)}, {"id", "task.root.responder"}, {"instruction", Core::get(state_, "responder_description", "")}}));
  llm_query_ = std::make_unique<AxGen>(s(str(Core::get(state_, "llm_query_signature", Value("task:string, context:json -> answer:string")))), object({{"validation_retries", 1}, {"id", "rlm.llmquery"}, {"instruction", Core::get(state_, "llm_query_description", "")}}));
}

AxAgent& AxAgent::set_signature(Value signature) {
  Value options = Core::get(state_, "options", Value::object());
  state_ = Core::_agent_factory(std::move(signature), options);
  distiller_ = std::make_unique<AxGen>(s(str(Core::get(state_, "distiller_signature"))), object({{"validation_retries", 0}, {"id", "ctx.root.actor"}, {"instruction", Core::get(state_, "distiller_description", "")}}));
  executor_ = std::make_unique<AxGen>(s(str(Core::get(state_, "executor_signature"))), object({{"validation_retries", 0}, {"id", "task.root.actor"}, {"instruction", Core::get(state_, "executor_description", "")}}));
  responder_ = std::make_unique<AxGen>(s(str(Core::get(state_, "responder_signature"))), object({{"validation_retries", Core::get(options, "validation_retries", 2)}, {"id", "task.root.responder"}, {"instruction", Core::get(state_, "responder_description", "")}}));
  llm_query_ = std::make_unique<AxGen>(s(str(Core::get(state_, "llm_query_signature", Value("task:string, context:json -> answer:string")))), object({{"validation_retries", 1}, {"id", "rlm.llmquery"}, {"instruction", Core::get(state_, "llm_query_description", "")}}));
  return *this;
}

Value AxAgent::get_instruction() const { return Core::get(state_, "stage_instruction", Value("")); }

AxAgent& AxAgent::set_instruction(Value instruction) {
  Value composed = Core::_agent_set_instruction(state_, display(instruction));
  executor_->set_instruction(composed);
  return *this;
}

AxAgent& AxAgent::add_actor_instruction(Value addendum) {
  Value composed = Core::_agent_add_actor_instruction(state_, display(addendum));
  executor_->set_instruction(composed);
  return *this;
}

Value AxAgent::forward(AIClient& client, Value values, Value options) {
  ensure_configured_playbook(client);
  // Wire the built-in llmQuery primitive onto the runtime carried in agent
  // options (the same runtime the actor loop will create sessions on),
  // mirroring the Go/Python/Rust/Java wrappers. The logic lives in the
  // AxIR-generated helper; this only registers the host callable.
  Value runtime_ref = Core::get(options, "runtime", Value());
  if (runtime_ref.is_null()) {
    runtime_ref = Core::get(Core::get(state_, "options", Value::object()), "runtime", Value());
  }
  std::string runtime_id = str(Core::get(runtime_ref, "__code_runtime_id", Value("")));
  if (!runtime_id.empty()) {
    auto it = code_runtime_registry().find(runtime_id);
    if (it != code_runtime_registry().end() && it->second != nullptr) {
      AxGen* sub = llm_query_.get();
      AIClient* client_ptr = &client;
      it->second->register_host_callable("llmQuery", [sub, client_ptr](Value params) -> Value {
        return Core::_agent_run_llm_query(Core::agent_stage_ref(*sub), Core::client_ref(*client_ptr), std::move(params));
      });
    }
  }
  Value output = Core::_agent_forward(
      state_,
      Core::agent_stage_ref(*distiller_),
      Core::agent_stage_ref(*executor_),
      Core::agent_stage_ref(*responder_),
      Core::client_ref(client),
      std::move(values),
      std::move(options));
  if (citations_observer_) {
    try {
      citations_observer_(Core::get(state_, "last_citations", Value::array()));
    } catch (...) {
      // Citation observers are informational and must not fail forward().
    }
  }
  learn_playbook_failures(output);
  return output;
}

AxAgent& AxAgent::set_citations_observer(std::function<void(Value)> observer) {
  citations_observer_ = std::move(observer);
  return *this;
}

AxAgent& AxAgent::set_playbook_observer(std::function<void(Value)> observer) {
  playbook_observer_ = std::move(observer);
  return *this;
}

AxAgent& AxAgent::add_tool_module(std::string name, const std::vector<Tool>& tools) {
  Array functions;
  for (const auto& tool : tools) {
    functions.push_back(tool.value());
    distiller_->add_tool(tool);
    executor_->add_tool(tool);
    responder_->add_tool(tool);
    llm_query_->add_tool(tool);
  }
  Value modules = Core::get(state_, "functions", Value::array());
  Core::append(modules, object({{"name", std::move(name)}, {"functions", Value(functions)}}));
  Core::set(state_, "functions", modules);
  Value options = Core::get(state_, "options", Value::object());
  Core::set(options, "functions", modules);
  Core::set(state_, "options", options);
  return *this;
}

Value AxAgent::test(AxCodeRuntime& runtime, Value code, Value context_values, Value options) {
  return Core::_agent_runtime_test(state_, Core::code_runtime_ref(runtime), std::move(code), std::move(context_values), std::move(options));
}

Value AxAgent::execute_actor_step(AxCodeRuntime& runtime, Value code, Value values, Value options) {
  Core::_agent_runtime_build_globals(state_, std::move(values));
  Value session = Core::get(state_, "runtime_session", Value());
  return Core::_agent_runtime_execute_step(state_, Core::code_runtime_ref(runtime), session, std::move(code), std::move(options));
}

Value AxAgent::inspect_runtime(Value options) {
  return Core::_agent_runtime_inspect_state(state_, Core::get(state_, "runtime_session", Value()), std::move(options));
}

Value AxAgent::export_session_state(Value options) {
  return Core::_agent_runtime_export_session_state(state_, Core::get(state_, "runtime_session", Value()), std::move(options));
}

Value AxAgent::restore_session_state(Value snapshot, Value options) {
  return Core::_agent_runtime_restore_session_state(state_, Core::get(state_, "runtime_session", Value()), std::move(snapshot), std::move(options));
}

Value AxAgent::close_runtime_session() {
  return Core::_agent_runtime_close_session(state_, Core::get(state_, "runtime_session", Value()));
}

Value AxAgent::get_state() const { return Core::_agent_get_state(state_); }
void AxAgent::set_state(Value state) { Core::_agent_set_state(state_, std::move(state)); }
Value AxAgent::get_chat_log() const { return Core::get(state_, "chat_log", Value::array()); }
Value AxAgent::get_action_log() const { return Core::get(state_, "action_log", Value::array()); }
Value AxAgent::get_trace() const { return Core::_agent_export_trace(state_); }
Value AxAgent::export_trace() const { return Core::_agent_export_trace(state_); }
Value AxAgent::replay_trace(Value trace, Value fixtures) const { return Core::_agent_replay_trace(std::move(trace), std::move(fixtures)); }
Value AxAgent::get_usage() const { return Core::get(state_, "usage", Value::object()); }
Value AxAgent::get_runtime_contract() const { return Core::get(state_, "runtime_contract", Value::object()); }
Value AxAgent::get_policy() const { return Core::get(state_, "policy", Value::object()); }
Value AxAgent::get_policy_registry() const { return Core::get(state_, "policy_registry", Value::object()); }
Value AxAgent::get_callable_inventory() const { return Core::get(state_, "callable_inventory", Value::array()); }
Value AxAgent::get_discovery_catalog() const { return Core::get(state_, "discovery_catalog", Value::array()); }
Value AxAgent::discover(Value request) { return Core::_agent_discover(state_, std::move(request)); }
Value AxAgent::recall(Value request) { return Core::_agent_recall(state_, std::move(request)); }
Value AxAgent::used(Value id, Value reason, Value stage) {
  Value request = object({{"id", id}, {"reason", reason}, {"stage", stage}});
  return Core::_agent_used(state_, request, stage);
}
Value AxAgent::invoke_callable(Value qualified_name, Value args, Value options) {
  Value request = object({{"qualified_name", qualified_name}, {"args", args}});
  return Core::_agent_execute_callable(state_, request, std::move(options));
}
Value AxAgent::export_runtime_state() const { return Core::_agent_export_runtime_state(state_); }
Value AxAgent::restore_runtime_state(Value snapshot) { return Core::_agent_restore_runtime_state(state_, std::move(snapshot)); }
Value AxAgent::get_optimizer_metadata() const { return Core::_agent_optimizer_metadata(state_); }
Value AxAgent::get_optimizable_components() const {
  Value child_components = Value::array();
  for (const auto& item : array_ref(distiller_->get_optimizable_components())) Core::append(child_components, item);
  for (const auto& item : array_ref(executor_->get_optimizable_components())) Core::append(child_components, item);
  for (const auto& item : array_ref(responder_->get_optimizable_components())) Core::append(child_components, item);
  return Core::_agent_get_optimizable_components(state_, child_components);
}
AxAgent& AxAgent::apply_optimized_components(Value component_map) {
  Core::_validate_optimization_component_map(get_optimizable_components(), component_map);
  distiller_->apply_optimized_components(component_map);
  executor_->apply_optimized_components(component_map);
  responder_->apply_optimized_components(component_map);
  Value composed = Core::_agent_apply_optimized_components(state_, component_map);
  executor_->set_instruction(composed);
  return *this;
}
AxAgent& AxAgent::apply_optimization(Value artifact) {
  Value components = get_optimizable_components();
  Value map = artifact.is_string() ? Core::_deserialize_optimized_artifact(artifact, components) : Core::_validate_optimized_artifact(artifact, components);
  return apply_optimized_components(Core::get(map, "componentMap", Value::object()));
}
Value AxAgent::evaluate_optimization_task(AIClient& client, Value task, Value options) {
  Value input = Core::get(task, "input", task);
  Value forward_options = Core::get(options, "forward_options", Value::object());
  try {
    Value output = forward(client, input, forward_options);
    return Core::_build_agent_eval_prediction(output, get_action_log(), get_usage(), export_trace());
  } catch (const AxError& e) {
    if (e.category == "AxAgentClarificationError") {
      return object({{"completionType", Value("askClarification")}, {"clarification", Value(std::string(e.what()))}, {"actionLog", get_action_log()}, {"functionCalls", Core::get(state_, "function_call_traces", Value::array())}, {"toolErrors", Value::array()}, {"turnCount", Value(0)}, {"usage", get_usage()}, {"trace", export_trace()}});
    }
    Value err = object({{"message", Value(std::string(e.what()))}});
    return object({{"completionType", Value("error")}, {"error", err}, {"actionLog", get_action_log()}, {"functionCalls", Core::get(state_, "function_call_traces", Value::array())}, {"toolErrors", array({Value(std::string(e.what()))})}, {"turnCount", Value(0)}, {"usage", get_usage()}, {"trace", export_trace()}});
  }
}
Value AxAgent::evaluate_optimization(AIClient& client, Value dataset, Value candidate_map, Value options) {
  Value normalized = Core::_normalize_optimization_dataset(dataset.is_null() ? Value::array() : dataset);
  Value rows = Value::array();
  Value original = Core::_optimization_component_current_map(get_optimizable_components());
  int max_metric_calls = static_cast<int>(num(Core::get(options, "maxMetricCalls", Core::get(options, "max_metric_calls", Value(2147483647)))));
  int calls = 0;
  try {
    if (Core::truthy(candidate_map)) apply_optimized_components(candidate_map);
    for (const auto& raw_task : Core::iter(Core::get(normalized, "train", Value::array()))) {
      if (calls >= max_metric_calls) throw AxError("runtime", "max metric calls exceeded: " + std::to_string(max_metric_calls));
      ++calls;
      Value task = raw_task;
      Value prediction = evaluate_optimization_task(client, task, options);
      Value error = Core::get(prediction, "error");
      Value default_score = Core::truthy(Core::eq(Core::get(prediction, "completionType", Value("")), Value("error"))) ? Value(0) : Value(1);
      Value raw_score = Core::get(task, "metric_score", Core::get(task, "scores", Core::get(task, "score", default_score)));
      Value scores = Core::_normalize_optimization_metric_scores(raw_score);
      Value scalar = Core::_adjust_optimization_score_for_actions(Core::_scalarize_optimization_scores(scores, options), task, prediction);
      Core::append(rows, Core::_build_optimization_eval_row(task, prediction, scores, scalar, Core::get(prediction, "trace"), error));
    }
    Value result = Core::_build_optimization_eval_result(rows, candidate_map, Core::get(options, "phase", Value("train")));
    apply_optimized_components(original);
    return result;
  } catch (...) {
    apply_optimized_components(original);
    throw;
  }
}

struct AxAgentOptimizerEvaluator : OptimizerEvaluator {
  AxAgent& agent;
  AIClient& client;
  Value dataset;
  Value options;
  AxAgentOptimizerEvaluator(AxAgent& agent_, AIClient& client_, Value dataset_, Value options_)
      : agent(agent_), client(client_), dataset(std::move(dataset_)), options(std::move(options_)) {}
  Value evaluate(Value candidate_map, Value eval_options = Value::object()) override {
    Value merged = Core::map_merge(options, eval_options);
    Value eval_dataset = Core::get(merged, "dataset", Core::get(merged, "_dataset", dataset));
    return agent.evaluate_optimization(client, eval_dataset, std::move(candidate_map), merged);
  }
};

Value AxAgent::optimize_with(OptimizerEngine& engine, Value dataset, Value options) {
  Value components = get_optimizable_components();
  Value run = Core::_prepare_optimizer_run(Value("axagent"), components, dataset.is_null() ? Value::array() : dataset, options, export_trace(), Value(false));
  Value request = Core::get(run, "request", Value::object());
  Value artifact = Core::_normalize_optimizer_engine_response(engine.optimize(request), Value(engine.name()), Value(engine.version()), components);
  if (Core::truthy(Core::get(options, "apply", Value(true)))) apply_optimization(artifact);
  return artifact;
}
Value AxAgent::optimize_with(OptimizerEngine& engine, AIClient& client, Value dataset, Value options) {
  Value components = get_optimizable_components();
  Value run = Core::_prepare_optimizer_run(Value("axagent"), components, dataset.is_null() ? Value::array() : dataset, options, export_trace(), Value(true));
  Value request = Core::get(run, "request", Value::object());
  AxAgentOptimizerEvaluator evaluator(*this, client, dataset, options);
  Value artifact = Core::_normalize_optimizer_engine_response(engine.optimize(request, &evaluator), Value(engine.name()), Value(engine.version()), components);
  if (Core::truthy(Core::get(options, "apply", Value(true)))) apply_optimization(artifact);
  return artifact;
}
Value AxAgent::optimize(Value dataset, Value options) {
  throw AxError("validation", "options.engine must implement OptimizerEngine for optimize()");
}

// Build an evolving context AxPlaybook bound to an agent stage (the actor/task
// stage by default; pass {"target":"responder"} for the responder). As the
// playbook evolves it is injected into the live stage prompt unless {"apply"} is
// false. The evolution engine (ACE) is an implementation detail.
AxPlaybook& AxAgent::playbook(AIClient& student, Value options) {
  if (playbook_handle_) {
    if (options.is_object() && !Core::iter(Core::map_keys(options)).empty()) {
      throw AxError("validation", "AxAgent.playbook(): this agent already has a playbook; call playbook() without options to use it.");
    }
    return *playbook_handle_;
  }
  if (!options.is_object()) options = Value::object();
  std::string target = display(Core::get(options, "target", Value("actor")));
  AxGen* stage = target == "responder" ? responder_.get() : executor_.get();
  auto handle = std::make_unique<AxPlaybook>(*stage, student, nullptr, options);
  if (Core::truthy(Core::eq(Core::get(options, "apply"), Value(false)))) {
    handle->set_apply_hook([](const std::string&) {});
  } else {
    std::string base = display(stage->get_instruction());
    AxGen* stage_ptr = stage;
    handle->set_apply_hook([stage_ptr, base](const std::string& rendered) {
      stage_ptr->set_instruction(Value(playbook_compose_instruction(base, rendered)));
    });
  }
  handle->bind_agent(*this);
  playbook_handle_ = std::move(handle);
  return *playbook_handle_;
}

AxPlaybook* AxAgent::get_playbook() const { return playbook_handle_.get(); }

void AxAgent::ensure_configured_playbook(AIClient& client) {
  if (playbook_handle_ || playbook_config_.is_null() || (playbook_config_.is_bool() && !Core::truthy(playbook_config_))) return;
  Value config = playbook_config_.is_object() ? playbook_config_ : Value::object();
  if (Core::get(config, "maxReflectorRounds", Value()).is_null() && Core::get(config, "max_reflector_rounds", Value()).is_null()) {
    Core::set(config, "maxReflectorRounds", 1);
  }
  Value seed = Core::get(config, "seed", Value());
  if (seed.is_null() && (!Core::get(config, "playbook", Value()).is_null() || !Core::get(config, "artifact", Value()).is_null())) seed = config;
  AxPlaybook& handle = playbook(client, config);
  if (seed.is_object()) {
    if (!Core::get(seed, "playbook", Value()).is_null()) handle.load(seed);
    else handle.load(object({{"playbook", seed}}));
  }
}

void AxAgent::learn_playbook_failures(Value output) {
  if (!playbook_handle_ || playbook_config_.is_null()) return;
  Value config = playbook_config_.is_object() ? playbook_config_ : Value::object();
  Value learn = Core::get(config, "learn", Value(true));
  if (learn.is_bool() && !Core::truthy(learn)) return;
  try {
    std::vector<Value> signals = Core::iter(Core::get(state_, "failure_signals", Value::array()));
    Value learn_config = learn.is_object() ? learn : Value::object();
    int min_signals = static_cast<int>(num(Core::get(learn_config, "minSignals", Core::get(learn_config, "min_signals", Value(1)))));
    if (static_cast<int>(signals.size()) < min_signals) return;
    std::set<std::string> covered;
    for (const auto& signature : Core::iter(Core::_agent_collect_covered_failure_signatures(playbook_handle_->get_state()))) {
      covered.insert(display(signature));
    }
    if (Core::truthy(Core::get(learn_config, "dedupe", Value(true)))) {
      signals.erase(std::remove_if(signals.begin(), signals.end(), [&](const Value& signal) {
        return covered.count(display(Core::get(signal, "signature", Value("")))) > 0;
      }), signals.end());
    }
    if (signals.empty()) return;
    if (signals.size() > 12) signals.resize(12);
    std::string feedback = "Agent run failures to avoid:\n";
    Array signatures;
    for (const auto& signal : signals) {
      Value signature = Core::get(signal, "signature", Value(""));
      signatures.push_back(signature);
      feedback += "- [" + display(Core::get(signal, "kind", Value("error_turn"))) + "] " + display(signature) + ": " + display(Core::get(signal, "detail", Value(""))) + "\n";
    }
    feedback += "Curate ONE bounded avoidance rule into failures_to_avoid.";
    std::string before = stringify(Core::get(playbook_handle_->get_state(), "playbook", Value::object()));
    Value update = playbook_handle_->update(object({
      {"example", object({{"task", Core::get(options_, "instruction", Value("agent run"))}, {"failureSignatures", Value(signatures)}})},
      {"prediction", output},
      {"feedback", Value(feedback)},
    }));
    if (playbook_observer_) {
      Value snapshot = playbook_handle_->get_state();
      playbook_observer_(object({
        {"status", stringify(Core::get(snapshot, "playbook", Value::object())) == before ? Value("unchanged") : Value("updated")},
        {"signals", Value(signals)},
        {"feedback", Value(feedback)},
        {"snapshot", snapshot},
        {"result", update},
      }));
    }
  } catch (...) {
    // Run-end learning must never fail a completed user-facing run.
  }
}

static Value optimize_options_merge(Value base, Value extra) {
  Value out = Core::map_merge(Value::object(), base);
  if (extra.is_object()) out = Core::map_merge(out, extra);
  return out;
}

static bool optimize_bootstrap_enabled(Value setting) {
  return !(setting.is_bool() && !Core::truthy(setting));
}

static Value optimize_set_apply_false(Value options) {
  Value out = Core::map_merge(Value::object(), options);
  Core::set(out, "apply", false);
  return out;
}

static Value optimize_set_common_gepa_options(Value options) {
  Value out = optimize_set_apply_false(options);
  Core::set(out, "bootstrap", false);
  if (Core::get(out, "maxMetricCalls", Value()).is_null() && Core::get(out, "max_metric_calls", Value()).is_null()) {
    Core::set(out, "maxMetricCalls", 100);
  }
  return out;
}

static void optimize_apply_demos(AxGen& program, Value demos) { program.set_demos(std::move(demos)); }
static void optimize_apply_demos(AxFlow& program, Value demos) { program.set_demos(std::move(demos)); }
static void optimize_apply_demos(AxAgent&, Value) {}

template <typename Program>
static Value optimize_impl(Program& program, AIClient& student, Value dataset, Value options, AIClient* teacher) {
  AIClient* reflection = teacher == nullptr ? &student : teacher;
  Value bootstrap_setting = Core::get(options, "bootstrap", Value(static_cast<bool>(Core::iter(dataset).size() <= 8)));
  Value demos = Value::array();
  if (optimize_bootstrap_enabled(bootstrap_setting)) {
    Value bootstrap_options = optimize_set_apply_false(optimize_options_merge(options, bootstrap_setting));
    AxBootstrapFewShot bootstrap(bootstrap_options);
    Value bootstrap_artifact = program.optimize_with(bootstrap, *reflection, dataset, bootstrap_options);
    demos = Core::get(bootstrap_artifact, "demos", Value::array());
    if (!Core::iter(demos).empty()) optimize_apply_demos(program, demos);
  }
  Value gepa_options = optimize_set_common_gepa_options(options);
  AxGEPA gepa(reflection, gepa_options);
  Value artifact = program.optimize_with(gepa, student, dataset, gepa_options);
  if (!Core::iter(demos).empty()) Core::set(artifact, "demos", demos);
  return artifact;
}

Value optimize(AxGen& program, AIClient& student, Value dataset, Value options, AIClient* teacher) {
  return optimize_impl(program, student, std::move(dataset), std::move(options), teacher);
}

Value optimize(AxFlow& program, AIClient& student, Value dataset, Value options, AIClient* teacher) {
  return optimize_impl(program, student, std::move(dataset), std::move(options), teacher);
}

Value optimize(AxAgent& program, AIClient& student, Value dataset, Value options, AIClient* teacher) {
  return optimize_impl(program, student, std::move(dataset), std::move(options), teacher);
}

Value object(std::initializer_list<std::pair<std::string, Value>> items) {
  Value out = Value::object();
  for (const auto& item : items) Core::set(out, item.first, item.second);
  return out;
}

Value array(std::initializer_list<Value> items) {
  Value out = Value::array();
  for (const auto& item : items) Core::append(out, item);
  return out;
}

Value RuntimeCapabilities::to_value() const {
  return object({
    {"inspect", inspect},
    {"snapshot", snapshot},
    {"patch", patch},
    {"abort", abort},
    {"language", language.empty() ? "JavaScript" : language},
    {"usage_instructions", usage_instructions}
  });
}

Value RuntimeEnvelope::result(Value value) {
  return object({{"kind", "result"}, {"result", std::move(value)}});
}

Value RuntimeEnvelope::error(Value message, Value category) {
  return object({{"kind", "error"}, {"is_error", true}, {"error_category", std::move(category)}, {"error", std::move(message)}});
}

Value RuntimeEnvelope::session_closed(Value message) {
  return error(std::move(message), "session_closed");
}

Value RuntimeEnvelope::timeout(Value message) {
  return error(std::move(message), "timeout");
}

Value RuntimeEnvelope::final_payload(std::initializer_list<Value> args) {
  return object({{"type", "final"}, {"args", array(args)}});
}

Value RuntimeEnvelope::final_payload(Value args) {
  return object({{"type", "final"}, {"args", args.is_array() ? std::move(args) : array({std::move(args)})}});
}

Value RuntimeEnvelope::ask_clarification(std::initializer_list<Value> args) {
  return object({{"type", "askClarification"}, {"args", array(args)}});
}

Value RuntimeEnvelope::ask_clarification(Value args) {
  return object({{"type", "askClarification"}, {"args", args.is_array() ? std::move(args) : array({std::move(args)})}});
}

Value RuntimeEnvelope::discover(Value request) {
  return object({{"kind", "discover"}, {"discover", std::move(request)}});
}

Value RuntimeEnvelope::recall(Value request) {
  return object({{"kind", "recall"}, {"recall", std::move(request)}});
}

Value RuntimeEnvelope::used(Value request, Value reason, Value stage) {
  Value payload = request.is_object() ? request : object({{"id", std::move(request)}});
  if (!reason.is_null()) Core::set(payload, "reason", std::move(reason));
  if (!stage.is_null()) Core::set(payload, "stage", std::move(stage));
  return object({{"kind", "used"}, {"used", std::move(payload)}});
}

Value RuntimeEnvelope::status(Value type, Value message) {
  return object({{"kind", "status"}, {"status", object({{"type", std::move(type)}, {"message", std::move(message)}})}});
}

Value RuntimeEnvelope::guide_agent(Value guidance, Value triggered_by) {
  Value payload = object({{"type", "guide_agent"}, {"guidance", std::move(guidance)}});
  if (!triggered_by.is_null()) Core::set(payload, "triggeredBy", std::move(triggered_by));
  return payload;
}

RuntimeProtocolClient::RuntimeProtocolClient(RuntimeTransport& transport) : transport_(transport) {}

std::string RuntimeProtocolClient::usage_instructions() const {
  try {
    Value response = const_cast<RuntimeProtocolClient*>(this)->request("capabilities", Value(), Value::object(), false);
    return str(Core::get(Core::get(response, "result", Value::object()), "usage_instructions", ""));
  } catch (...) {
    return "";
  }
}

AxCodeSession* RuntimeProtocolClient::create_session(Value globals, Value options) {
  Value response = request("create_session", Value(), object({{"globals", std::move(globals)}, {"options", std::move(options)}}), true);
  Value session_id = Core::get(response, "session_id");
  if (session_id.is_null()) session_id = Core::get(Core::get(response, "result", Value::object()), "session_id");
  if (session_id.is_null()) throw AxError("runtime", "runtime protocol did not return a session_id");
  sessions_.push_back(std::make_unique<RuntimeProtocolSession>(*this, session_id));
  return sessions_.back().get();
}

Value RuntimeProtocolClient::request(Value op, Value session_id, Value payload, bool throw_on_error) {
  Value message = object({{"id", std::to_string(++next_id_)}, {"op", std::move(op)}, {"payload", std::move(payload)}});
  if (!session_id.is_null()) Core::set(message, "session_id", session_id);
  Value response = transport_.call(message);
  if (!response.is_object()) throw AxError("runtime", "runtime protocol response must be an object");
  if (str(Core::get(response, "id")) != str(Core::get(message, "id"))) {
    throw AxError("runtime", "runtime protocol response id mismatch");
  }
  if (!session_id.is_null() && !Core::get(response, "session_id").is_null() && str(Core::get(response, "session_id")) != str(session_id)) {
    throw AxError("runtime", "runtime protocol session_id mismatch");
  }
  if (!Core::truthy(Core::get(response, "ok", false)) && throw_on_error) {
    Value error = Core::get(response, "error", Value::object());
    throw AxError(str(Core::get(error, "category", "runtime")), str(Core::get(error, "message", "runtime protocol error")));
  }
  return response;
}

Value RuntimeProtocolClient::shutdown() {
  return request("shutdown", Value(), Value::object(), false);
}

RuntimeProtocolSession::RuntimeProtocolSession(RuntimeProtocolClient& client, Value session_id)
    : client_(client), session_id_(std::move(session_id)) {}

Value RuntimeProtocolSession::execute(Value code, Value options) {
  Value response = client_.request("execute", session_id_, object({{"code", std::move(code)}, {"options", std::move(options)}}), false);
  if (!Core::truthy(Core::get(response, "ok", false))) {
    Value error = Core::get(response, "error", Value::object());
    return RuntimeEnvelope::error(Core::get(error, "message", "runtime protocol error"), Core::get(error, "category", "runtime"));
  }
  return Core::get(response, "result");
}

Value RuntimeProtocolSession::inspect(Value options) {
  return Core::get(client_.request("inspect_globals", session_id_, std::move(options), true), "result");
}

Value RuntimeProtocolSession::snapshot_globals(Value options) {
  return Core::get(client_.request("snapshot_globals", session_id_, std::move(options), true), "result");
}

Value RuntimeProtocolSession::patch_globals(Value snapshot, Value options) {
  return Core::get(client_.request("patch_globals", session_id_, object({{"globals", std::move(snapshot)}, {"options", std::move(options)}}), true), "result");
}

Value RuntimeProtocolSession::close() {
  return Core::get(client_.request("close", session_id_, Value::object(), false), "result");
}

Value s(const std::string& source) {
  Value sig = Core::parse_signature(source);
  Core::validate_signature(sig);
  return sig;
}
Value signature(const std::string& source) { return s(source); }
std::string to_string(const Value& sig) { return display(Core::signature_to_string(sig)); }
AxGen ax(const std::string& source, Value options) { return AxGen(s(source), std::move(options)); }
AxGen ax(const char* source, Value options) { return ax(std::string(source == nullptr ? "" : source), std::move(options)); }
AxGen ax(Value signature, Value options) { return AxGen(std::move(signature), std::move(options)); }
AxAgent agent(const std::string& source, Value options) { return AxAgent(Value(source), std::move(options)); }
AxAgent agent(const char* source, Value options) { return agent(std::string(source == nullptr ? "" : source), std::move(options)); }
AxAgent agent(Value signature, Value options) { return AxAgent(std::move(signature), std::move(options)); }
AxFlow flow(Value options) { return AxFlow(std::move(options)); }
AxFlow flow(const std::string& mermaid, Value bindings) { return AxFlow(mermaid, std::move(bindings)); }
std::shared_ptr<AxAIService> ai(const std::string& provider, Value options) {
  Value resolved = Core::provider_resolve_profile(provider.empty() ? "openai" : provider);
  if (!Core::truthy(Core::get(resolved, "known"))) {
    throw AxError("provider", "unsupported AxAI provider: " + provider);
  }
  std::string canonical = display(Core::get(resolved, "id"));
  if (canonical == "openai-compatible") {
    return std::make_shared<OpenAICompatibleClient>(std::move(options));
  }
  if (canonical == "openai-responses") {
    return std::make_shared<OpenAIResponsesClient>(std::move(options));
  }
  if (canonical == "google-gemini") {
    return std::make_shared<GoogleGeminiClient>(std::move(options));
  }
  if (canonical == "anthropic") {
    return std::make_shared<AnthropicClient>(std::move(options));
  }
  if (canonical == "azure-openai") {
    return std::make_shared<AzureOpenAIClient>(std::move(options));
  }
  if (canonical == "deepseek") {
    return std::make_shared<DeepSeekClient>(std::move(options));
  }
  if (canonical == "mistral") {
    return std::make_shared<MistralClient>(std::move(options));
  }
  if (canonical == "reka") {
    return std::make_shared<RekaClient>(std::move(options));
  }
  if (canonical == "cohere") {
    return std::make_shared<CohereClient>(std::move(options));
  }
  if (canonical == "grok") {
    return std::make_shared<GrokClient>(std::move(options));
  }
  throw AxError("runtime", "unsupported AxAI provider: " + provider);
}
std::shared_ptr<AxAIService> ai(const char* provider, Value options) { return ai(std::string(provider == nullptr ? "" : provider), std::move(options)); }

Value get_supported_ai_models(Value options) { return Core::provider_model_catalog(std::move(options)); }

static Value balancer_base_features_cpp() {
  return object({
      {"functions", false},
      {"streaming", false},
      {"thinking", false},
      {"multiTurn", false},
      {"structuredOutputs", false},
      {"media", object({
          {"images", object({{"supported", false}, {"formats", Value::array()}})},
          {"audio", object({{"supported", false}, {"formats", Value::array()}})},
          {"files", object({{"supported", false}, {"formats", Value::array()}, {"uploadMethod", "none"}})},
          {"urls", object({{"supported", false}, {"webSearch", false}, {"contextFetching", false}})}
      })},
      {"caching", object({{"supported", false}, {"types", Value::array()}})}
  });
}

static bool feature_truthy_cpp(Value features, const std::string& key, const std::string& alt = "") {
  if (Core::truthy(Core::get(features, key))) return true;
  return !alt.empty() && Core::truthy(Core::get(features, alt));
}

static void append_unique_cpp(Value& target, Value values) {
  for (const auto& item : Core::iter(values)) {
    bool found = false;
    for (const auto& existing : Core::iter(target)) {
      if (equal(existing, item)) { found = true; break; }
    }
    if (!found) Core::append(target, item);
  }
}

static Value metric_bucket_cpp() {
  return object({{"mean", 0}, {"p95", 0}, {"p99", 0}, {"samples", Value::array()}});
}

static Value error_bucket_cpp() {
  return object({{"count", 0}, {"rate", 0}, {"total", 0}});
}

static Value balancer_base_metrics_cpp() {
  return object({
      {"latency", object({{"chat", metric_bucket_cpp()}, {"embed", metric_bucket_cpp()}})},
      {"errors", object({{"chat", error_bucket_cpp()}, {"embed", error_bucket_cpp()}})}
  });
}

AxBalancer::AxBalancer() = default;

AxBalancer::AxBalancer(std::vector<std::shared_ptr<AxAIService>> services, Value options)
    : services_(std::move(services)), policy_(Core::provider_balancer_retry_policy(std::move(options))) {
  if (services_.empty()) throw AxError("runtime", "No AI services provided.");
  max_retries_ = static_cast<int>(num(Core::get(policy_, "maxRetries", 3)));
  validate_models();
  Value raw_strategy = Core::get(policy_, "strategy", "metric");
  if (raw_strategy.is_object() && str(Core::get(raw_strategy, "type", "")) == "adaptive") {
    auto strategy = std::make_shared<AxBalancerAdaptiveStrategy>();
    strategy->deadline_ms = num(Core::get(raw_strategy, "deadlineMs", Core::get(raw_strategy, "deadline_ms", 0)));
    strategy->bad_outcome_cost = num(Core::get(raw_strategy, "badOutcomeCost", Core::get(raw_strategy, "bad_outcome_cost", -1)));
    strategy->expected_tokens = Core::get(raw_strategy, "expectedTokens", Core::get(raw_strategy, "expected_tokens", Value()));
    strategy->name_space = str(Core::get(raw_strategy, "namespace", "default"));
    initialize_adaptive(services_, strategy);
  }
  if (str(Core::get(policy_, "strategy", "metric")) != "input_order") {
    std::stable_sort(services_.begin(), services_.end(), [](const auto& a, const auto& b) {
      return num(Core::provider_balancer_metric_score(a->get_metrics())) < num(Core::provider_balancer_metric_score(b->get_metrics()));
    });
  }
  current_service_ = services_.front();
}

AxBalancer::AxBalancer(std::vector<std::shared_ptr<AxAIService>> services, AxBalancerOptions options)
    : services_(std::move(services)), policy_(object({{"strategy", "metric"}, {"debug", options.debug}, {"maxRetries", options.max_retries}})), max_retries_(options.max_retries) {
  if (services_.empty()) throw AxError("runtime", "No AI services provided.");
  validate_models();
  if (options.strategy) initialize_adaptive(services_, options.strategy);
  std::stable_sort(services_.begin(), services_.end(), [](const auto& a, const auto& b) {
    return num(Core::provider_balancer_metric_score(a->get_metrics())) < num(Core::provider_balancer_metric_score(b->get_metrics()));
  });
  current_service_ = services_.front();
}

AxBalancerRouteStats create_balancer_route_stats() { return Core::provider_balancer_route_stats(); }
AxBalancerRouteStats update_balancer_route_stats(AxBalancerRouteStats current, AxBalancerStatsObservation observation) { return Core::provider_balancer_observe_route(std::move(current), std::move(observation)); }
Value sample_balancer_route_health(AxBalancerRouteStats stats, double deadline_ms) { return Core::provider_balancer_sample_health(std::move(stats), deadline_ms); }

std::string AxInMemoryBalancerStatsStore::serialize(const AxBalancerStatsKey& key) const {
  return str(Core::get(key, "namespace", "")) + "\x1f" + str(Core::get(key, "slice", "")) + "\x1f" + str(Core::get(key, "logicalModel", "")) + "\x1f" + str(Core::get(key, "routeKey", ""));
}
AxBalancerRouteStats AxInMemoryBalancerStatsStore::get(const AxBalancerStatsKey& key) {
  std::lock_guard<std::mutex> lock(mutex_); auto found = stats_.find(serialize(key)); return found == stats_.end() ? Value() : found->second;
}
void AxInMemoryBalancerStatsStore::observe(const AxBalancerStatsKey& key, const AxBalancerStatsObservation& observation) {
  std::lock_guard<std::mutex> lock(mutex_); std::string encoded = serialize(key); auto found = stats_.find(encoded); Value current = found == stats_.end() ? Value() : found->second; stats_[encoded] = update_balancer_route_stats(current, observation);
}

void AxBalancer::initialize_adaptive(const std::vector<std::shared_ptr<AxAIService>>& input, std::shared_ptr<AxBalancerAdaptiveStrategy> strategy) {
  Core::provider_balancer_adaptive_policy(object({{"deadlineMs", strategy->deadline_ms}, {"badOutcomeCost", strategy->bad_outcome_cost}, {"namespace", strategy->name_space}}));
  if (strategy->name_space.empty()) throw AxError("runtime", "Adaptive namespace must be non-empty.");
  if (strategy->stats_store && !strategy->route_key) throw AxError("runtime", "Adaptive routeKey is required when statsStore is supplied.");
  adaptive_ = std::move(strategy); adaptive_store_ = adaptive_->stats_store ? adaptive_->stats_store : std::make_shared<AxInMemoryBalancerStatsStore>();
  std::set<std::string> seen;
  for (size_t index = 0; index < input.size(); ++index) {
    auto service = input[index]; std::string key = adaptive_->route_key ? adaptive_->route_key(service, index) : service->get_id();
    Value seen_keys = Value::array(); for (const auto& value : seen) Core::append(seen_keys, value);
    key = str(Core::provider_balancer_validate_route_key(key, seen_keys));
    seen.insert(key);
    adaptive_route_keys_[service.get()] = key; adaptive_indices_[service.get()] = index;
  }
}

void AxBalancer::validate_models() {
  Value reference;
  bool has_reference = false;
  for (const auto& service : services_) {
    Value model_list = service->get_model_list();
    if (!model_list.is_null()) { reference = model_list; has_reference = true; break; }
  }
  if (!has_reference) return;
  std::set<std::string> reference_keys;
  for (const auto& entry : Core::iter(reference)) reference_keys.insert(str(Core::get(entry, "key")));
  for (size_t index = 0; index < services_.size(); ++index) {
    Value model_list = services_[index]->get_model_list();
    if (model_list.is_null()) throw AxError("runtime", "Service at index " + std::to_string(index) + " (" + services_[index]->get_name() + ") has no model list while another service does.");
    std::set<std::string> keys;
    for (const auto& entry : Core::iter(model_list)) keys.insert(str(Core::get(entry, "key")));
    for (const auto& key : reference_keys) if (!keys.count(key)) throw AxError("runtime", "Service at index " + std::to_string(index) + " (" + services_[index]->get_name() + ") is missing model \"" + key + "\"");
    for (const auto& key : keys) if (!reference_keys.count(key)) throw AxError("runtime", "Service at index " + std::to_string(index) + " (" + services_[index]->get_name() + ") has extra model \"" + key + "\"");
  }
}

bool AxBalancer::can_retry_service(const std::shared_ptr<AxAIService>& service) const {
  return service_failures_.find(service->get_id()) == service_failures_.end();
}

void AxBalancer::handle_failure(const std::shared_ptr<AxAIService>& service) {
  service_failures_[service->get_id()] += 1;
}

void AxBalancer::handle_success(const std::shared_ptr<AxAIService>& service) {
  service_failures_.erase(service->get_id());
}

bool AxBalancer::retryable(const AxError& error) const {
  if (error.category != "ai") return false;
  if (error.type == "AxAIServiceAuthenticationError") return false;
  if (error.type == "AxAIServiceStatusError") {
    return error.status == 408 || error.status == 429 || error.status == 500 || error.status == 502 || error.status == 503 || error.status == 504 || error.status == 529;
  }
  return error.type == "AxAIServiceNetworkError" || error.type == "AxAIServiceResponseError" || error.type == "AxAIServiceStreamTerminatedError" || error.type == "AxAIServiceTimeoutError";
}

std::vector<std::shared_ptr<AxAIService>> AxBalancer::candidate_services(Value request) {
  std::vector<std::shared_ptr<AxAIService>> out;
  Value model = Core::get(request, "model");
  for (const auto& service : services_) {
    if (Core::truthy(Core::provider_balancer_candidate_allowed(service->get_features(model), request))) out.push_back(service);
  }
  if (!out.empty()) return out;
  std::vector<std::string> requirements;
  if (str(Core::get(Core::get(request, "responseFormat", Core::get(request, "response_format", Value::object())), "type", "")) == "json_schema") requirements.push_back("structured outputs");
  Value caps = Core::get(request, "capabilities", Value::object());
  if (Core::truthy(Core::get(caps, "requiresImages", Core::get(caps, "requires_images", false)))) requirements.push_back("images");
  if (Core::truthy(Core::get(caps, "requiresAudio", Core::get(caps, "requires_audio", false)))) requirements.push_back("audio");
  Value reqs = Value::array();
  for (const auto& item : requirements) Core::append(reqs, item);
  throw AxError("runtime", "No services available that support required capabilities: " + str(Core::string_join(", ", reqs)) + ".");
}

void AxBalancer::reset() {
  current_service_index_ = 0;
  current_service_ = services_.front();
}

std::string AxBalancer::get_id() { return current_service_ ? current_service_->get_id() : ""; }
std::string AxBalancer::get_name() { return current_service_ ? current_service_->get_name() : ""; }

Value AxBalancer::get_model_list() {
  for (const auto& service : services_) {
    Value model_list = service->get_model_list();
    if (!model_list.is_null()) return model_list;
  }
  return Value();
}

Value AxBalancer::get_features(Value model) {
  Value features = balancer_base_features_cpp();
  for (const auto& service : services_) {
    Value raw = service->get_features(model);
    for (const auto& pair : std::vector<std::pair<std::string, std::string>>{{"functions", ""}, {"streaming", ""}, {"thinking", ""}, {"multiTurn", "multi_turn"}, {"structuredOutputs", "structured_outputs"}, {"functionCot", "function_cot"}, {"hasThinkingBudget", "has_thinking_budget"}, {"hasShowThoughts", "has_show_thoughts"}}) {
      if (feature_truthy_cpp(raw, pair.first, pair.second)) Core::set(features, pair.first, true);
    }
    Value media = Core::get(features, "media", Value::object());
    Value raw_media = Core::get(raw, "media", Value::object());
    for (const auto& kind : std::vector<std::string>{"images", "audio", "files"}) {
      Value dst = Core::get(media, kind, Value::object());
      Value src = Core::get(raw_media, kind, Value::object());
      if (Core::truthy(Core::get(src, "supported", false))) Core::set(dst, "supported", true);
      Value formats = Core::get(dst, "formats", Value::array());
      append_unique_cpp(formats, Core::get(src, "formats", Value::array()));
      Core::set(dst, "formats", formats);
      if (kind == "files") {
        Value upload = Core::get(src, "uploadMethod", Core::get(src, "upload_method", Value()));
        if (!upload.is_null() && str(upload) != "none") Core::set(dst, "uploadMethod", upload);
      }
      Core::set(media, kind, dst);
    }
    Value urls = Core::get(media, "urls", Value::object());
    Value raw_urls = Core::get(raw_media, "urls", Value::object());
    if (Core::truthy(Core::get(raw_urls, "supported", false))) Core::set(urls, "supported", true);
    if (Core::truthy(Core::get(raw_urls, "webSearch", Core::get(raw_urls, "web_search", false)))) Core::set(urls, "webSearch", true);
    if (Core::truthy(Core::get(raw_urls, "contextFetching", Core::get(raw_urls, "context_fetching", false)))) Core::set(urls, "contextFetching", true);
    Core::set(media, "urls", urls);
    Core::set(features, "media", media);
    Value caching = Core::get(features, "caching", Value::object());
    Value raw_caching = Core::get(raw, "caching", Value::object());
    if (Core::truthy(Core::get(raw_caching, "supported", false))) Core::set(caching, "supported", true);
    Value types = Core::get(caching, "types", Value::array());
    append_unique_cpp(types, Core::get(raw_caching, "types", Value::array()));
    Core::set(caching, "types", types);
    Core::set(features, "caching", caching);
  }
  return features;
}

Value AxBalancer::get_metrics() {
  double chat_error_count = 0, chat_error_total = 0, embed_error_count = 0, embed_error_total = 0;
  double chat_sum = 0, chat_count = 0, embed_sum = 0, embed_count = 0;
  double chat_p95 = 0, chat_p99 = 0, embed_p95 = 0, embed_p99 = 0;
  for (const auto& service : services_) {
    Value metrics = service->get_metrics();
    Value errors = Core::get(metrics, "errors", Value::object());
    Value chat_errors = Core::get(errors, "chat", Value::object());
    Value embed_errors = Core::get(errors, "embed", Value::object());
    chat_error_count += num(Core::get(chat_errors, "count", 0));
    chat_error_total += num(Core::get(chat_errors, "total", 0));
    embed_error_count += num(Core::get(embed_errors, "count", 0));
    embed_error_total += num(Core::get(embed_errors, "total", 0));
    Value latency = Core::get(metrics, "latency", Value::object());
    Value chat = Core::get(latency, "chat", Value::object());
    double chat_samples = static_cast<double>(Core::iter(Core::get(chat, "samples", Value::array())).size());
    if (chat_samples > 0) { chat_sum += num(Core::get(chat, "mean", 0)) * chat_samples; chat_count += chat_samples; }
    Value embed = Core::get(latency, "embed", Value::object());
    double embed_samples = static_cast<double>(Core::iter(Core::get(embed, "samples", Value::array())).size());
    if (embed_samples > 0) { embed_sum += num(Core::get(embed, "mean", 0)) * embed_samples; embed_count += embed_samples; }
    chat_p95 = std::max(chat_p95, num(Core::get(chat, "p95", 0)));
    chat_p99 = std::max(chat_p99, num(Core::get(chat, "p99", 0)));
    embed_p95 = std::max(embed_p95, num(Core::get(embed, "p95", 0)));
    embed_p99 = std::max(embed_p99, num(Core::get(embed, "p99", 0)));
  }
  return object({
      {"latency", object({
          {"chat", object({{"mean", chat_count > 0 ? chat_sum / chat_count : 0}, {"p95", chat_p95}, {"p99", chat_p99}, {"samples", Value::array()}})},
          {"embed", object({{"mean", embed_count > 0 ? embed_sum / embed_count : 0}, {"p95", embed_p95}, {"p99", embed_p99}, {"samples", Value::array()}})}
      })},
      {"errors", object({
          {"chat", object({{"count", chat_error_count}, {"rate", chat_error_total > 0 ? chat_error_count / chat_error_total : 0}, {"total", chat_error_total}})},
          {"embed", object({{"count", embed_error_count}, {"rate", embed_error_total > 0 ? embed_error_count / embed_error_total : 0}, {"total", embed_error_total}})}
      })}
  });
}

void AxBalancer::emit_routing_event(Value event) const {
  if (!adaptive_ || !adaptive_->on_routing_event) return;
  try { adaptive_->on_routing_event(std::move(event)); } catch (...) {}
}

void AxBalancer::observe_adaptive(const AdaptiveCandidate& candidate, Value observation, bool streaming, std::string reason, int status) {
  try { adaptive_store_->observe(candidate.stats_key, observation); }
  catch (const std::exception& error) {
    emit_routing_event(object({{"type", "store-error"}, {"namespace", Core::get(candidate.stats_key, "namespace", "")}, {"slice", Core::get(candidate.stats_key, "slice", "")}, {"logicalModel", Core::get(candidate.stats_key, "logicalModel", "")}, {"operation", "observe"}, {"routeKey", candidate.route_key}, {"errorType", std::string(typeid(error).name())}}));
  }
  emit_routing_event(object({{"type", "observation"}, {"namespace", Core::get(candidate.stats_key, "namespace", "")}, {"slice", Core::get(candidate.stats_key, "slice", "")}, {"logicalModel", Core::get(candidate.stats_key, "logicalModel", "")}, {"routeKey", candidate.route_key}, {"serviceName", candidate.service->get_name()}, {"outcome", Core::get(observation, "outcome", "failure")}, {"latencyMs", Core::get(observation, "latencyMs", Value())}, {"streaming", streaming}, {"reason", reason.empty() ? Value() : Value(reason)}, {"status", status == 0 ? Value() : Value(status)}}));
}

double AxBalancer::adaptive_cost(const std::shared_ptr<AxAIService>& service, const std::string& route_key, Value request) const {
  std::string logical = str(Core::get(request, "model", "default")); std::string resolved = logical;
  for (const auto& raw : Core::iter(service->get_model_list())) if (equal(Core::get(raw, "key", Value()), Core::get(request, "model", Value()))) { resolved = str(Core::get(raw, "model", logical)); break; }
  Value context = object({{"serviceIndex", static_cast<double>(adaptive_indices_.at(service.get()))}, {"routeKey", route_key}, {"logicalModel", logical}, {"resolvedModel", resolved}, {"expectedTokens", adaptive_->expected_tokens}, {"serviceName", service->get_name()}});
  double cost = 0;
  if (adaptive_->estimate_cost) cost = adaptive_->estimate_cost(*service, context);
  else if (adaptive_->expected_tokens.is_null()) cost = service->get_estimated_cost(Value());
  else {
    double prompt = num(Core::get(adaptive_->expected_tokens, "promptTokens", Core::get(adaptive_->expected_tokens, "prompt_tokens", 0)));
    double completion = num(Core::get(adaptive_->expected_tokens, "completionTokens", Core::get(adaptive_->expected_tokens, "completion_tokens", 0)));
    cost = service->get_estimated_cost(object({{"ai", service->get_name()}, {"model", resolved}, {"tokens", object({{"promptTokens", prompt}, {"completionTokens", completion}, {"totalTokens", prompt + completion}})}}));
  }
  if (!std::isfinite(cost) || cost < 0) throw AxError("runtime", "Adaptive estimated cost for route \"" + route_key + "\" must be finite and non-negative.");
  return cost;
}

std::vector<AxBalancer::AdaptiveCandidate> AxBalancer::rank_adaptive(Value request, Value options) {
  auto eligible = candidate_services(request); std::string logical = str(Core::get(request, "model", "default"));
  std::string slice = adaptive_->slice ? adaptive_->slice(object({{"model", Core::get(request, "model", Value())}, {"options", options}})) : "default";
  if (slice.empty()) throw AxError("runtime", "Adaptive slice must be non-empty.");
  std::vector<AdaptiveCandidate> ranked;
  for (size_t order = 0; order < eligible.size(); ++order) {
    auto service = eligible[order]; std::string route_key = adaptive_route_keys_.at(service.get());
    Value key = object({{"namespace", adaptive_->name_space}, {"slice", slice}, {"logicalModel", logical}, {"routeKey", route_key}}); Value stats;
    try { stats = adaptive_store_->get(key); }
    catch (const std::exception& error) {
      emit_routing_event(object({{"type", "store-error"}, {"namespace", adaptive_->name_space}, {"slice", slice}, {"logicalModel", logical}, {"operation", "get"}, {"routeKey", route_key}, {"errorType", std::string(typeid(error).name())}}));
    }
    Value health = sample_balancer_route_health(stats, adaptive_->deadline_ms); double failure = num(Core::get(health, "failureProbability", 0.05)); double late = num(Core::get(health, "deadlineMissProbability", 0)); double estimated = adaptive_cost(service, route_key, request); double score = num(Core::provider_balancer_adaptive_score(estimated, adaptive_->bad_outcome_cost, failure, late));
    ranked.push_back({service, order, route_key, key, score, estimated, failure, late});
  }
  Value rank_input = Value::array(); std::map<std::string, AdaptiveCandidate> ranked_by_key;
  for (const auto& value : ranked) { Core::append(rank_input, object({{"routeKey", value.route_key}, {"score", value.score}, {"order", static_cast<double>(value.order)}})); ranked_by_key.emplace(value.route_key, value); }
  std::vector<AdaptiveCandidate> core_ranked; for (const auto& raw : Core::iter(Core::provider_balancer_rank_candidates(rank_input))) core_ranked.push_back(ranked_by_key.at(str(Core::get(raw, "routeKey")))); ranked = std::move(core_ranked);
  Value scores = Value::array(); for (const auto& value : ranked) Core::append(scores, object({{"routeKey", value.route_key}, {"serviceName", value.service->get_name()}, {"score", value.score}, {"estimatedCost", value.estimated_cost}, {"failureProbability", value.failure_probability}, {"deadlineMissProbability", value.deadline_miss_probability}}));
  emit_routing_event(object({{"type", "ranked"}, {"namespace", adaptive_->name_space}, {"slice", slice}, {"logicalModel", logical}, {"candidates", scores}})); return ranked;
}

Value AxBalancer::chat(Value request) { return chat(std::move(request), Value::object()); }
Value AxBalancer::chat(Value request, Value options) {
  if (adaptive_) {
    auto ranked = rank_adaptive(request, options); std::exception_ptr last;
    for (size_t index = 0; index < ranked.size(); ++index) {
      auto& candidate = ranked[index]; current_service_ = candidate.service;
      emit_routing_event(object({{"type", "selected"}, {"namespace", Core::get(candidate.stats_key, "namespace", "")}, {"slice", Core::get(candidate.stats_key, "slice", "")}, {"logicalModel", Core::get(candidate.stats_key, "logicalModel", "")}, {"routeKey", candidate.route_key}, {"serviceName", candidate.service->get_name()}, {"attempt", static_cast<double>(index + 1)}}));
      auto started = std::chrono::steady_clock::now();
      try {
        Value response = candidate.service->chat(request, options); double latency = std::max(1.0, std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - started).count()); observe_adaptive(candidate, object({{"outcome", "success"}, {"latencyMs", latency}}), false); return response;
      } catch (const AxError& error) {
        if (!retryable(error)) throw; last = std::current_exception(); std::string reason = error.type == "AxAIServiceStatusError" ? "status" : error.type == "AxAIServiceNetworkError" ? "network" : error.type == "AxAIServiceStreamTerminatedError" ? "stream-terminated" : error.type == "AxAIServiceTimeoutError" ? "timeout" : "response"; observe_adaptive(candidate, object({{"outcome", "failure"}}), false, reason, error.status);
        emit_routing_event(object({{"type", "fallback"}, {"namespace", Core::get(candidate.stats_key, "namespace", "")}, {"slice", Core::get(candidate.stats_key, "slice", "")}, {"logicalModel", Core::get(candidate.stats_key, "logicalModel", "")}, {"fromRouteKey", candidate.route_key}, {"toRouteKey", index + 1 < ranked.size() ? Value(ranked[index + 1].route_key) : Value()}, {"reason", reason}, {"status", error.status == 0 ? Value() : Value(error.status)}}));
      }
    }
    if (last) std::rethrow_exception(last); throw AxError("runtime", "All candidate services exhausted (tried " + std::to_string(ranked.size()) + " service(s))");
  }
  auto candidates = candidate_services(request);
  size_t index = 0;
  auto service = candidates.at(index);
  current_service_ = service;
  while (true) {
    if (!can_retry_service(service)) {
      ++index;
      if (index >= candidates.size()) throw AxError("runtime", "All candidate services exhausted (tried " + std::to_string(candidates.size()) + " service(s))");
      service = candidates.at(index);
      current_service_ = service;
      continue;
    }
    try {
      Value response = service->chat(request, options);
      handle_success(service);
      return response;
    } catch (const AxError& error) {
      if (!retryable(error)) throw;
      handle_failure(service);
      if (service_failures_[service->get_id()] >= max_retries_) {
        ++index;
        if (index >= candidates.size()) throw;
        service = candidates.at(index);
        current_service_ = service;
      }
    }
  }
}

std::vector<Value> AxBalancer::stream(Value request) {
  if (!adaptive_) return AxAIService::stream(std::move(request));
  auto ranked = rank_adaptive(request, Value::object()); std::exception_ptr last;
  for (size_t index = 0; index < ranked.size(); ++index) {
    auto& candidate = ranked[index]; current_service_ = candidate.service;
    emit_routing_event(object({{"type", "selected"}, {"namespace", Core::get(candidate.stats_key, "namespace", "")}, {"slice", Core::get(candidate.stats_key, "slice", "")}, {"logicalModel", Core::get(candidate.stats_key, "logicalModel", "")}, {"routeKey", candidate.route_key}, {"serviceName", candidate.service->get_name()}, {"attempt", static_cast<double>(index + 1)}}));
    auto started = std::chrono::steady_clock::now();
    try {
      std::vector<Value> chunks = candidate.service->stream(request); double latency = std::max(1.0, std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - started).count()); observe_adaptive(candidate, object({{"outcome", "success"}, {"latencyMs", latency}}), true); return chunks;
    } catch (const AxError& error) {
      if (!retryable(error)) throw; last = std::current_exception(); std::string reason = error.type == "AxAIServiceStatusError" ? "status" : error.type == "AxAIServiceNetworkError" ? "network" : error.type == "AxAIServiceStreamTerminatedError" ? "stream-terminated" : error.type == "AxAIServiceTimeoutError" ? "timeout" : "response"; observe_adaptive(candidate, object({{"outcome", "failure"}}), true, reason, error.status);
      emit_routing_event(object({{"type", "fallback"}, {"namespace", Core::get(candidate.stats_key, "namespace", "")}, {"slice", Core::get(candidate.stats_key, "slice", "")}, {"logicalModel", Core::get(candidate.stats_key, "logicalModel", "")}, {"fromRouteKey", candidate.route_key}, {"toRouteKey", index + 1 < ranked.size() ? Value(ranked[index + 1].route_key) : Value()}, {"reason", reason}, {"status", error.status == 0 ? Value() : Value(error.status)}}));
    }
  }
  if (last) std::rethrow_exception(last); throw AxError("runtime", "All candidate services exhausted (tried " + std::to_string(ranked.size()) + " service(s))");
}

Value AxBalancer::embed(Value request) { return embed(std::move(request), Value::object()); }
Value AxBalancer::embed(Value request, Value options) {
  reset();
  size_t index = current_service_index_;
  while (true) {
    if (!can_retry_service(current_service_)) {
      ++index;
      if (index >= services_.size()) throw AxError("runtime", "All services exhausted (tried " + std::to_string(services_.size()) + " service(s))");
      current_service_ = services_.at(index);
      current_service_index_ = index;
      continue;
    }
    try {
      Value response = current_service_->embed(request, options);
      handle_success(current_service_);
      return response;
    } catch (const AxError& error) {
      if (!retryable(error)) throw;
      handle_failure(current_service_);
      if (service_failures_[current_service_->get_id()] >= max_retries_) {
        ++index;
        if (index >= services_.size()) throw;
        current_service_ = services_.at(index);
        current_service_index_ = index;
      }
    }
  }
}

Value AxBalancer::transcribe(Value request) { return transcribe(std::move(request), Value::object()); }
Value AxBalancer::transcribe(Value request, Value options) { return current_service_->transcribe(std::move(request), std::move(options)); }
Value AxBalancer::speak(Value request) { return speak(std::move(request), Value::object()); }
Value AxBalancer::speak(Value request, Value options) { return current_service_->speak(std::move(request), std::move(options)); }
std::function<void(std::string)> AxBalancer::get_logger() { return current_service_->get_logger(); }
double AxBalancer::get_estimated_cost(Value usage) { return current_service_->get_estimated_cost(std::move(usage)); }
Value AxBalancer::get_options() { return current_service_->get_options(); }
void AxBalancer::set_options(Value options) { for (auto& service : services_) service->set_options(options); if (current_service_) current_service_->set_options(options); }
Value AxBalancer::get_last_used_chat_model() { return current_service_ ? current_service_->get_last_used_chat_model() : Value(); }
Value AxBalancer::get_last_used_embed_model() { return current_service_ ? current_service_->get_last_used_embed_model() : Value(); }
Value AxBalancer::get_last_used_model_config() { return current_service_ ? current_service_->get_last_used_model_config() : Value(); }
Value AxBalancer::complete(Value request) { return Core::chat_response_to_completion(chat(Core::coerce_chat_request(std::move(request)))); }

static Value router_default_features_cpp() {
  return object({
      {"functions", false},
      {"streaming", false},
      {"media", object({
          {"images", object({{"supported", false}, {"formats", Value::array()}})},
          {"audio", object({{"supported", false}, {"formats", Value::array()}, {"output", object({{"supported", false}, {"formats", Value::array()}})}})},
          {"files", object({{"supported", false}, {"formats", Value::array()}, {"uploadMethod", "none"}})},
          {"urls", object({{"supported", false}, {"webSearch", false}, {"contextFetching", false}})}
      })},
      {"caching", object({{"supported", false}, {"types", Value::array()}})},
      {"thinking", false},
      {"multiTurn", true}
  });
}

MultiServiceRouter::MultiServiceRouter() = default;

MultiServiceRouter::MultiServiceRouter(std::vector<std::shared_ptr<AxAIService>> services) {
  if (services.empty()) throw AxError("runtime", "No AI services provided.");
  for (size_t index = 0; index < services.size(); ++index) {
    auto service = services[index];
    Value model_list = service->get_model_list();
    if (!model_list.is_array() || array_ref(model_list).empty()) {
      throw AxError("runtime", "Service " + std::to_string(index) + " '" + service->get_name() + "' has no model list.");
    }
    for (const auto& raw : array_ref(model_list)) {
      std::string key = display(Core::get(raw, "key"));
      if (services_.count(key)) {
        throw AxError("runtime", "Service " + std::to_string(index) + " '" + service->get_name() + "' has duplicate model key: " + key + " as service " + services_[key].service->get_name());
      }
      Entry entry;
      entry.service = service;
      entry.description = display(Core::get(raw, "description", ""));
      if (!Core::get(raw, "model").is_null()) entry.model = Core::get(raw, "model");
      else if (!Core::get(raw, "embedModel").is_null()) entry.embed_model = Core::get(raw, "embedModel");
      else throw AxError("runtime", "Key " + key + " in model list for service " + std::to_string(index) + " '" + service->get_name() + "' is missing a model or embedModel property.");
      services_[key] = std::move(entry);
      service_keys_.push_back(key);
    }
  }
}

MultiServiceRouter::MultiServiceRouter(Value) {
  throw AxError("runtime", "C++ MultiServiceRouter dynamic entries require host-owned service pointers");
}

void MultiServiceRouter::set_service_entry(std::string key, std::shared_ptr<AxAIService> service, std::string description, bool is_internal) {
  if (services_.count(key)) throw AxError("runtime", "Duplicate model key: " + key);
  Entry entry;
  entry.service = std::move(service);
  entry.description = std::move(description);
  entry.is_internal = is_internal;
  service_keys_.push_back(key);
  services_[std::move(key)] = std::move(entry);
}

void MultiServiceRouter::set_service_entry(std::string, Value) {
  throw AxError("runtime", "C++ MultiServiceRouter dynamic entries require host-owned service pointers");
}

std::string MultiServiceRouter::get_id() {
  std::vector<std::string> ids;
  for (const auto& key : service_keys_) ids.push_back(services_[key].service->get_id());
  std::string out = "MultiServiceRouter:";
  for (size_t i = 0; i < ids.size(); ++i) { if (i) out += ","; out += ids[i]; }
  return out;
}

std::string MultiServiceRouter::get_name() { return "MultiServiceRouter"; }

Value MultiServiceRouter::get_model_list() {
  Value out = Value::array();
  for (const auto& key : service_keys_) {
    const Entry& entry = services_[key];
    if (entry.is_internal) continue;
    Value item = object({{"key", key}, {"description", entry.description}});
    if (!entry.model.is_null()) Core::set(item, "model", entry.model);
    else if (!entry.embed_model.is_null()) Core::set(item, "embedModel", entry.embed_model);
    else throw AxError("runtime", "Service " + key + " has no model or embedModel");
    Core::append(out, item);
  }
  return out;
}

Value MultiServiceRouter::get_features(Value model) {
  if (!model.is_null()) {
    auto it = services_.find(display(model));
    if (it != services_.end()) return it->second.service->get_features(model);
  }
  return router_default_features_cpp();
}

Value MultiServiceRouter::chat(Value request) { return chat(std::move(request), Value::object()); }
Value MultiServiceRouter::chat(Value request, Value options) {
  Value model_key = Core::get(request, "model");
  if (model_key.is_null()) throw AxError("runtime", "Model key must be specified for multi-service");
  auto it = services_.find(display(model_key));
  if (it == services_.end()) throw AxError("runtime", "No service found for model key: " + display(model_key));
  last_used_service_ = it->second.service;
  Value req(object_ref(request));
  if (Core::get(req, "model_config").is_null() && !Core::get(req, "modelConfig").is_null()) Core::set(req, "model_config", Core::get(req, "modelConfig"));
  if (it->second.model.is_null()) Core::map_delete(req, "model");
  return last_used_service_->chat(req, options);
}

Value MultiServiceRouter::embed(Value request) { return embed(std::move(request), Value::object()); }
Value MultiServiceRouter::embed(Value request, Value options) {
  Value model_key = Core::get(request, "embedModel", Core::get(request, "embed_model"));
  if (model_key.is_null()) throw AxError("runtime", "Embed model key must be specified for multi-service");
  auto it = services_.find(display(model_key));
  if (it == services_.end()) throw AxError("runtime", "No service found for embed model key: " + display(model_key));
  last_used_service_ = it->second.service;
  Value req(object_ref(request));
  if (it->second.model.is_null()) {
    Core::map_delete(req, "embedModel");
    Core::map_delete(req, "embed_model");
  }
  return last_used_service_->embed(req, options);
}

Value MultiServiceRouter::transcribe(Value request) { return transcribe(std::move(request), Value::object()); }
Value MultiServiceRouter::transcribe(Value request, Value options) {
  Value model_key = Core::get(request, "model");
  if (model_key.is_null()) {
    if (services_.empty()) throw AxError("runtime", "No AI services provided.");
    last_used_service_ = services_.begin()->second.service;
    return last_used_service_->transcribe(request, options);
  }
  auto it = services_.find(display(model_key));
  if (it == services_.end()) throw AxError("runtime", "No service found for transcription model key: " + display(model_key));
  last_used_service_ = it->second.service;
  return last_used_service_->transcribe(request, options);
}

Value MultiServiceRouter::speak(Value request) { return speak(std::move(request), Value::object()); }
Value MultiServiceRouter::speak(Value request, Value options) {
  Value model_key = Core::get(request, "model");
  if (model_key.is_null()) {
    if (services_.empty()) throw AxError("runtime", "No AI services provided.");
    last_used_service_ = services_.begin()->second.service;
    return last_used_service_->speak(request, options);
  }
  auto it = services_.find(display(model_key));
  if (it == services_.end()) throw AxError("runtime", "No service found for speech model key: " + display(model_key));
  last_used_service_ = it->second.service;
  return last_used_service_->speak(request, options);
}

Value MultiServiceRouter::get_metrics() {
  auto service = last_used_service_;
  if (!service && !services_.empty()) service = services_.begin()->second.service;
  if (!service) throw AxError("runtime", "No service available to get metrics.");
  return service->get_metrics();
}
std::function<void(std::string)> MultiServiceRouter::get_logger() {
  auto service = last_used_service_;
  if (!service && !services_.empty()) service = services_.begin()->second.service;
  if (!service) throw AxError("runtime", "No service available to get logger.");
  return service->get_logger();
}
double MultiServiceRouter::get_estimated_cost(Value usage) { return last_used_service_ ? last_used_service_->get_estimated_cost(usage) : 0.0; }
Value MultiServiceRouter::get_options() { return options_; }
void MultiServiceRouter::set_options(Value options) { options_ = options; for (auto& kv : services_) kv.second.service->set_options(options); }
Value MultiServiceRouter::get_last_used_chat_model() { return last_used_service_ ? last_used_service_->get_last_used_chat_model() : Value(); }
Value MultiServiceRouter::get_last_used_embed_model() { return last_used_service_ ? last_used_service_->get_last_used_embed_model() : Value(); }
Value MultiServiceRouter::get_last_used_model_config() { return last_used_service_ ? last_used_service_->get_last_used_model_config() : Value(); }
Value MultiServiceRouter::complete(Value request) { return Core::chat_response_to_completion(chat(Core::coerce_chat_request(std::move(request)))); }

ProviderRouter::ProviderRouter(Value config) {
  Value providers = Core::get(config, "providers", Value::object());
  routing_ = Core::get(Core::get(config, "routing", Value::object()), "capability", Value::object());
  processing_ = Core::get(config, "processing", Value::object());
  (void)providers;
}

ProviderRouter::ProviderRouter(std::vector<std::shared_ptr<AxAIService>> providers, Value routing, Value processing)
    : providers_(std::move(providers)), routing_(std::move(routing)), processing_(std::move(processing)) {}

Value ProviderRouter::provider_records() const {
  Value out = Value::array();
  for (const auto& provider : providers_) {
    Core::append(out, object({{"name", provider->get_name()}, {"id", provider->get_id()}, {"features", provider->get_features(Value())}}));
  }
  return out;
}

std::shared_ptr<AxAIService> ProviderRouter::service_for_name(Value name) const {
  for (auto provider : providers_) if (provider->get_name() == display(name)) return provider;
  return providers_.empty() ? nullptr : providers_.front();
}

Value ProviderRouter::get_routing_recommendation(Value request) {
  Value rec = Core::provider_route_recommendation(provider_records(), Core::coerce_chat_request(request), routing_);
  return rec;
}

Value ProviderRouter::validate_request(Value request) {
  return Core::provider_route_validation(provider_records(), Core::coerce_chat_request(request), processing_, routing_);
}

Value ProviderRouter::get_routing_stats() { return Core::provider_routing_stats(provider_records()); }
Value ProviderRouter::chat(Value request, Value options) {
  Value rec = get_routing_recommendation(request);
  auto provider = service_for_name(Core::get(rec, "providerName"));
  if (!provider) throw Core::as_error(Core::ai_error_unsupported("No provider selected"));
  return object({{"response", provider->chat(request, options)}, {"routing", rec}});
}

std::vector<Value> ProviderRouter::stream(Value request) {
  Value rec = get_routing_recommendation(request);
  auto provider = service_for_name(Core::get(rec, "providerName"));
  if (!provider) throw Core::as_error(Core::ai_error_unsupported("No provider selected"));
  return provider->stream(std::move(request));
}

Value ProviderRouter::embed(Value request, Value options) {
  Value rec = get_routing_recommendation(request);
  auto provider = service_for_name(Core::get(rec, "providerName"));
  if (!provider) throw Core::as_error(Core::ai_error_unsupported("No provider selected"));
  return provider->embed(std::move(request), std::move(options));
}

Value ProviderRouter::transcribe(Value request, Value options) {
  Value rec = get_routing_recommendation(request);
  auto provider = service_for_name(Core::get(rec, "providerName"));
  if (!provider) throw Core::as_error(Core::ai_error_unsupported("No provider selected"));
  return provider->transcribe(std::move(request), std::move(options));
}

Value ProviderRouter::speak(Value request, Value options) {
  Value rec = get_routing_recommendation(request);
  auto provider = service_for_name(Core::get(rec, "providerName"));
  if (!provider) throw Core::as_error(Core::ai_error_unsupported("No provider selected"));
  return provider->speak(std::move(request), std::move(options));
}

Value to_json_schema(Value fields, const std::string& title, Value options) { return Core::to_json_schema(fields, title, options); }
Value validate_output(Value fields, Value values) { return Core::validate_output(fields, values); }
Value strip_internal(Value fields, Value values) { return Core::strip_internal(fields, values); }
Value render_prompt(Value signature, Value values, Value functions, Value options) { return Core::render_prompt(signature, values, functions, options); }
Value fold_stream(Value events) { return Core::fold_stream(events); }

}  // namespace axllm
