#include "axllm/runtime/quickjs/quickjs_runtime.hpp"

#include <chrono>
#include <cstring>
#include <vector>

namespace axllm::runtime::quickjs {

static std::vector<std::pair<std::string, Value>> value_entries(Value value) {
  std::vector<std::pair<std::string, Value>> out;
  for (const auto& key_value : Core::iter(Core::map_keys(value))) {
    std::string key = display(key_value);
    out.push_back({key, Core::get(value, key)});
  }
  return out;
}

static bool contains_name(Value values, const std::string& name) {
  for (const auto& item : Core::iter(values)) {
    if (display(item) == name) return true;
  }
  return false;
}

static bool is_host_callable(Value value) {
  return value.is_object() && Core::truthy(Core::get(value, "__ax_host_callable", Value(false)));
}

static int int_option(Value options, const std::string& key, int fallback) {
  Value value = Core::get(options, key);
  if (value.is_null()) return fallback;
  try {
    int parsed = static_cast<int>(std::stod(display(value)));
    return parsed < 1 ? 1 : parsed;
  } catch (...) {
    return fallback;
  }
}

static Value default_runtime_policy(Value overrides = Value::object()) {
  Value policy = object({
      {"allowFilesystem", false},
      {"allowNetwork", false},
      {"allowProcess", false},
      {"allowNativeHostAccess", false},
      {"maxSnapshotBytes", 262144},
      {"memoryLimitBytes", 32 * 1024 * 1024},
      {"timeoutMs", 5000},
  });
  for (const auto& entry : value_entries(overrides)) {
    Core::set(policy, entry.first, entry.second);
  }
  return policy;
}

static Value merge_runtime_policy(Value base, Value options) {
  Value policy = default_runtime_policy(std::move(base));
  Value overrides = Core::get(options, "runtimePolicy", Value::object());
  for (const auto& entry : value_entries(overrides)) {
    Core::set(policy, entry.first, entry.second);
  }
  return policy;
}

static const char* bootstrap_source = R"JS(
const __ax_builtin_reserved = [
  "Object", "Function", "Array", "Number", "parseFloat", "parseInt", "Infinity", "NaN",
  "undefined", "Boolean", "String", "Symbol", "Date", "Promise", "RegExp", "Error",
  "AggregateError", "EvalError", "RangeError", "ReferenceError", "SyntaxError", "TypeError",
  "URIError", "globalThis", "JSON", "Math", "Reflect", "Proxy", "eval", "isFinite",
  "isNaN", "decodeURI", "decodeURIComponent", "encodeURI", "encodeURIComponent",
  "console", "final", "askClarification", "discover", "recall", "used", "reportSuccess",
  "reportFailure", "guideAgent"
];
function __ax_has_name(values, name) {
  if (!Array.isArray(values)) return false;
  for (let i = 0; i < values.length; i++) {
    if (values[i] === name) return true;
  }
  return false;
}
function __ax_complete(value) { globalThis.__ax_completion = value; return value; }
function __ax_clone_json(value) {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value));
}
function __ax_make_host_callable(name, spec) {
  return function(params) {
    if (spec && spec.native === true) {
      const response = JSON.parse(globalThis.__ax_host_call(name, JSON.stringify(params === undefined ? null : params)));
      if (response.ok) return response.result;
      return {
        kind: "error",
        is_error: true,
        error_category: String(response.category || "runtime"),
        error: String(response.error || ("host callable failed: " + name))
      };
    }
    if (spec && spec.error) {
      return {
        kind: "error",
        is_error: true,
        error_category: String(spec.error.category || "runtime"),
        error: String(spec.error.message || spec.error.error || ("host callable failed: " + name))
      };
    }
    if (spec && Object.prototype.hasOwnProperty.call(spec, "result")) return __ax_clone_json(spec.result);
    return { kind: "result", result: null };
  };
}
function __ax_install_host_callables() {
  for (const key of Object.getOwnPropertyNames(globalThis)) {
    if (key.startsWith("__ax_")) continue;
    const value = globalThis[key];
    if (value && typeof value === "object" && value.__ax_host_callable === true) {
      globalThis[key] = __ax_make_host_callable(key, value);
    }
  }
}
function final() { return __ax_complete({ type: "final", args: Array.from(arguments) }); }
function askClarification() { return __ax_complete({ type: "askClarification", args: Array.from(arguments) }); }
function discover(request) { return __ax_complete({ kind: "discover", discover: request }); }
function recall(request) { return __ax_complete({ kind: "recall", recall: request }); }
function used(idOrRequest, reason) {
  const payload = (idOrRequest && typeof idOrRequest === "object") ? idOrRequest : { id: idOrRequest };
  if (reason !== undefined && reason !== null) payload.reason = String(reason);
  return __ax_complete({ kind: "used", used: payload });
}
function reportSuccess(message) { return __ax_complete({ kind: "status", status: { type: "success", message: String(message || "") } }); }
function reportFailure(message) { return __ax_complete({ kind: "status", status: { type: "failed", message: String(message || "") } }); }
function guideAgent(guidance) { return __ax_complete({ type: "guide_agent", guidance: String(guidance || "") }); }
function __ax_snapshot_json() {
  const out = {};
  const sessionReserved = Array.isArray(globalThis.__ax_session_reserved) ? globalThis.__ax_session_reserved : [];
  for (const key of Object.getOwnPropertyNames(globalThis)) {
    if (key.startsWith("__ax_")) continue;
    if (__ax_has_name(__ax_builtin_reserved, key) || __ax_has_name(sessionReserved, key)) continue;
    const value = globalThis[key];
    if (typeof value === "function" || typeof value === "undefined") continue;
    try { JSON.stringify(value); out[key] = value; } catch (_) {}
  }
  return JSON.stringify(out);
}
function __ax_clear_user_globals() {
  const sessionReserved = Array.isArray(globalThis.__ax_session_reserved) ? globalThis.__ax_session_reserved : [];
  for (const key of Object.getOwnPropertyNames(globalThis)) {
    if (key.startsWith("__ax_")) continue;
    if (__ax_has_name(__ax_builtin_reserved, key) || __ax_has_name(sessionReserved, key)) continue;
    try { delete globalThis[key]; } catch (_) {}
  }
}
)JS";

static int quickjs_interrupt_handler(JSRuntime*, void* opaque) {
  auto* deadline = static_cast<std::chrono::steady_clock::time_point*>(opaque);
  if (deadline == nullptr) return 0;
  return std::chrono::steady_clock::now() > *deadline ? 1 : 0;
}

static JSValue quickjs_host_call(JSContext* context, JSValueConst, int argc, JSValueConst* argv) {
  auto* session = static_cast<QuickJsCodeSession*>(JS_GetContextOpaque(context));
  if (session == nullptr || argc < 2) return JS_NewString(context, "{\"ok\":false,\"category\":\"runtime\",\"error\":\"invalid QuickJS host call\"}");
  const char* raw_name = JS_ToCString(context, argv[0]);
  const char* raw_params = JS_ToCString(context, argv[1]);
  std::string name = raw_name ? raw_name : "";
  std::string params = raw_params ? raw_params : "null";
  JS_FreeCString(context, raw_name);
  JS_FreeCString(context, raw_params);
  std::string out = session->call_host_json(name, params);
  return JS_NewString(context, out.c_str());
}

QuickJsCodeSession::QuickJsCodeSession(Value globals, Value options, Value runtime_policy, std::map<std::string, HostCallable> host_callables)
    : runtime_(JS_NewRuntime()), context_(nullptr), reserved_(Core::get(options, "reservedNames", Value::array())), runtime_policy_(merge_runtime_policy(std::move(runtime_policy), options)), host_callables_(std::move(host_callables)) {
  if (!runtime_) throw AxError("runtime", "failed to create QuickJS runtime");
  JS_SetMemoryLimit(runtime_, static_cast<size_t>(int_option(runtime_policy_, "memoryLimitBytes", 32 * 1024 * 1024)));
  context_ = JS_NewContext(runtime_);
  if (!context_) throw AxError("runtime", "failed to create QuickJS context");
  JS_SetContextOpaque(context_, this);
  JSValue global = JS_GetGlobalObject(context_);
  JS_SetPropertyStr(context_, global, "__ax_host_call", JS_NewCFunction(context_, quickjs_host_call, "__ax_host_call", 2));
  JS_FreeValue(context_, global);
  JS_FreeValue(context_, JS_Eval(context_, bootstrap_source, std::strlen(bootstrap_source), "<ax-bootstrap>", JS_EVAL_TYPE_GLOBAL));
  set_global("__ax_session_reserved", reserved_);
  for (const auto& entry : value_entries(globals)) {
    if (is_host_callable(entry.second) && !contains_name(reserved_, entry.first)) Core::append(reserved_, entry.first);
    set_global(entry.first, entry.second);
  }
  for (const auto& entry : host_callables_) {
    if (!contains_name(reserved_, entry.first)) Core::append(reserved_, entry.first);
    set_global(entry.first, object({{"__ax_host_callable", true}, {"native", true}}));
  }
  set_global("__ax_session_reserved", reserved_);
  JS_FreeValue(context_, JS_Eval(context_, "__ax_install_host_callables()", std::strlen("__ax_install_host_callables()"), "<ax-host-callables>", JS_EVAL_TYPE_GLOBAL));
}

QuickJsCodeSession::~QuickJsCodeSession() {
  if (context_) JS_FreeContext(context_);
  if (runtime_) JS_FreeRuntime(runtime_);
}

Value QuickJsCodeSession::execute(Value code, Value options) {
  if (closed_) return RuntimeEnvelope::session_closed("session closed");
  std::string source = display(code);
  int timeout_ms = int_option(options, "timeoutMs", int_option(runtime_policy_, "timeoutMs", 5000));
  auto deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(timeout_ms);
  JS_SetInterruptHandler(runtime_, quickjs_interrupt_handler, &deadline);
  JS_FreeValue(context_, JS_Eval(context_, "globalThis.__ax_completion = undefined; globalThis.__ax_error = undefined; __ax_install_host_callables();", std::strlen("globalThis.__ax_completion = undefined; globalThis.__ax_error = undefined; __ax_install_host_callables();"), "<ax-before-execute>", JS_EVAL_TYPE_GLOBAL));
  // RLM actor code uses top-level await (`await final(...)`), illegal in a plain script eval.
  // Pass the code in via a global string (avoids host-side JS escaping) and run it through the
  // AsyncFunction constructor so await is legal; then drain the job queue so awaited
  // continuations and the synchronous host primitives that set __ax_completion run.
  {
    JSValue global = JS_GetGlobalObject(context_);
    JS_SetPropertyStr(context_, global, "__ax_code", JS_NewStringLen(context_, source.c_str(), source.size()));
    JS_FreeValue(context_, global);
  }
  static const char kRunActor[] =
      "(async function(){}).constructor('with (globalThis) {\\n' + (globalThis.__ax_code || '') + '\\n}')()"
      ".then(function(){}, function(e){ globalThis.__ax_error = String((e && e.stack) ? e.stack : e); });";
  JSValue result = JS_Eval(context_, kRunActor, std::strlen(kRunActor), "<actor>", JS_EVAL_TYPE_GLOBAL);
  if (JS_IsException(result)) {
    JSValue exception = JS_GetException(context_);
    const char* text = JS_ToCString(context_, exception);
    std::string message = text ? text : "QuickJS exception";
    JS_FreeCString(context_, text);
    JS_FreeValue(context_, exception);
    JS_SetInterruptHandler(runtime_, nullptr, nullptr);
    if (std::chrono::steady_clock::now() > deadline || message.find("interrupted") != std::string::npos) {
      return RuntimeEnvelope::timeout("QuickJS execution timed out");
    }
    return RuntimeEnvelope::error(message, "runtime");
  }
  JS_FreeValue(context_, result);
  {
    JSContext* pending_ctx = nullptr;
    while (JS_ExecutePendingJob(runtime_, &pending_ctx) > 0) {
    }
  }
  JSValue actor_error = JS_Eval(context_, "globalThis.__ax_error === undefined ? null : globalThis.__ax_error", std::strlen("globalThis.__ax_error === undefined ? null : globalThis.__ax_error"), "<ax-error>", JS_EVAL_TYPE_GLOBAL);
  if (!JS_IsNull(actor_error) && !JS_IsUndefined(actor_error)) {
    const char* etext = JS_ToCString(context_, actor_error);
    std::string emsg = etext ? etext : "QuickJS actor error";
    JS_FreeCString(context_, etext);
    JS_FreeValue(context_, actor_error);
    JS_SetInterruptHandler(runtime_, nullptr, nullptr);
    if (std::chrono::steady_clock::now() > deadline || emsg.find("interrupted") != std::string::npos) {
      return RuntimeEnvelope::timeout("QuickJS execution timed out");
    }
    return RuntimeEnvelope::error(emsg, "runtime");
  }
  JS_FreeValue(context_, actor_error);
  result = JS_Eval(context_, "globalThis.__ax_completion === undefined ? {kind:'result', result:null} : globalThis.__ax_completion", std::strlen("globalThis.__ax_completion === undefined ? {kind:'result', result:null} : globalThis.__ax_completion"), "<ax-completion>", JS_EVAL_TYPE_GLOBAL);
  JSValue json = JS_JSONStringify(context_, result, JS_UNDEFINED, JS_UNDEFINED);
  const char* text = JS_ToCString(context_, json);
  std::string json_text = text ? text : "";
  JS_FreeCString(context_, text);
  JS_FreeValue(context_, json);
  JS_FreeValue(context_, result);
  JS_SetInterruptHandler(runtime_, nullptr, nullptr);
  if (json_text.empty() || json_text == "undefined") {
    return RuntimeEnvelope::error("QuickJS actor code did not return a JSON-compatible value", "runtime");
  }
  try {
    return parse_json(json_text);
  } catch (const std::exception& error) {
    return RuntimeEnvelope::error(std::string("malformed QuickJS actor output: ") + error.what(), "runtime");
  }
}

Value QuickJsCodeSession::inspect(Value) { return eval_json("__ax_snapshot_json()"); }

Value QuickJsCodeSession::snapshot_globals(Value) {
  Value bindings = inspect(Value::object());
  int max_bytes = int_option(runtime_policy_, "maxSnapshotBytes", 262144);
  if (static_cast<int>(stringify(bindings).size()) > max_bytes) {
    Value trimmed = Value::object();
    for (const auto& entry : value_entries(bindings)) {
      Core::set(trimmed, entry.first, entry.second);
      if (static_cast<int>(stringify(trimmed).size()) > max_bytes) {
        Core::set(trimmed, entry.first, Value());
        Core::set(trimmed, "__ax_snapshot_truncated", true);
        bindings = trimmed;
        break;
      }
    }
  }
  return object({{"version", 1}, {"bindings", bindings}, {"globals", bindings}});
}

Value QuickJsCodeSession::patch_globals(Value snapshot, Value) {
  Value bindings = Core::get(snapshot, "bindings", snapshot);
  JS_FreeValue(context_, JS_Eval(context_, "__ax_clear_user_globals()", std::strlen("__ax_clear_user_globals()"), "<ax-clear>", JS_EVAL_TYPE_GLOBAL));
  for (const auto& entry : value_entries(bindings)) {
    if (contains_name(reserved_, entry.first)) continue;
    set_global(entry.first, entry.second);
  }
  return snapshot_globals(Value::object());
}

Value QuickJsCodeSession::close() {
  closed_ = true;
  return object({{"closed", true}});
}

std::string QuickJsCodeSession::call_host_json(const std::string& name, const std::string& params_json) {
  auto it = host_callables_.find(name);
  if (it == host_callables_.end()) {
    return stringify(object({{"ok", false}, {"category", "runtime"}, {"error", "unknown QuickJS host callable: " + name}}));
  }
  try {
    Value params = params_json.empty() ? Value() : parse_json(params_json);
    return stringify(object({{"ok", true}, {"result", it->second(params)}}));
  } catch (const AxError& error) {
    return stringify(object({{"ok", false}, {"category", error.category.empty() ? "runtime" : error.category}, {"error", std::string(error.what())}}));
  } catch (const std::exception& error) {
    return stringify(object({{"ok", false}, {"category", "runtime"}, {"error", std::string(error.what())}}));
  }
}

Value QuickJsCodeSession::eval_json(const std::string& source) {
  JSValue result = JS_Eval(context_, source.c_str(), source.size(), "<ax-inspect>", JS_EVAL_TYPE_GLOBAL);
  const char* text = JS_ToCString(context_, result);
  Value out = text ? parse_json(text) : Value::object();
  JS_FreeCString(context_, text);
  JS_FreeValue(context_, result);
  return out;
}

void QuickJsCodeSession::set_global(const std::string& name, const Value& value) {
  std::string source = "globalThis[" + stringify(Value(name)) + "] = JSON.parse(" + stringify(stringify(value)) + ");";
  JS_FreeValue(context_, JS_Eval(context_, source.c_str(), source.size(), "<ax-set-global>", JS_EVAL_TYPE_GLOBAL));
}

std::string QuickJsCodeRuntime::usage_instructions() const {
  return "JavaScript QuickJS runtime profile. Use final(...), askClarification(...), discover(...), recall(...), used(...), reportSuccess(...), and reportFailure(...). Filesystem, network, and native host APIs are not exposed by default.";
}

QuickJsCodeRuntime::QuickJsCodeRuntime(Value runtime_policy) : runtime_policy_(default_runtime_policy(std::move(runtime_policy))) {}

QuickJsCodeRuntime& QuickJsCodeRuntime::register_callable(std::string name, HostCallable handler) {
  if (name.empty()) throw AxError("runtime", "QuickJS host callable name is required");
  if (!handler) throw AxError("runtime", "QuickJS host callable handler is required");
  host_callables_[std::move(name)] = std::move(handler);
  return *this;
}

AxCodeSession* QuickJsCodeRuntime::create_session(Value globals, Value options) {
  return new QuickJsCodeSession(globals, options, runtime_policy_, host_callables_);
}

Value QuickJsCodeRuntime::runtime_policy() const { return runtime_policy_; }

}  // namespace axllm::runtime::quickjs
