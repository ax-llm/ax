#include "axllm/axllm.hpp"
#include "axllm/mcp.hpp"
#ifdef AX_CONFORMANCE_QUICKJS
#include "axllm/runtime/quickjs/quickjs_runtime.hpp"
#endif

#include <algorithm>
#include <array>
#include <cctype>
#include <cmath>
#include <fstream>
#include <iostream>

using namespace axllm;

static Array as_array(Value value) {
  if (auto p = std::get_if<std::shared_ptr<Array>>(&value.data)) return **p;
  return {};
}

static Object as_object(Value value) {
  if (auto p = std::get_if<std::shared_ptr<Object>>(&value.data)) return **p;
  return {};
}

struct ConformanceScriptedAI : AIClient {
  Array responses;
  Array transcribe_responses;
  std::vector<Value> requests;
  int chat_calls = 0;

  explicit ConformanceScriptedAI(Value values) : responses(as_array(values)) {}

  Value complete(Value request) override {
    requests.push_back(request);
    if (responses.empty()) throw AxError("fixture", "scripted client exhausted");
    Value out = responses.front();
    responses.erase(responses.begin());
    return out;
  }

  Value chat(Value request) override {
    ++chat_calls;
    return Core::legacy_response_to_chat_response(complete(request));
  }

  Value transcribe(Value request, Value options) override {
    requests.push_back(request);
    (void)options;
    if (!transcribe_responses.empty()) {
      Value out = transcribe_responses.front();
      transcribe_responses.erase(transcribe_responses.begin());
      return out;
    }
    return object({{"text", std::string("")}});
  }
};

struct ScriptedTransport : Transport {
  Array responses;
  std::vector<Value> requests;

  explicit ScriptedTransport(Value values) : responses(as_array(values)) {}

  Value call(Value request) override {
    requests.push_back(request);
    if (responses.empty()) throw AxError("fixture", "scripted transport exhausted");
    Value out = responses.front();
    responses.erase(responses.begin());
    return out;
  }
};

static Value router_fixture_default_features() {
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

static AxError fixture_ai_service_error_cpp(Value spec) {
  std::string type = display(Core::get(spec, "type", "network"));
  std::string message = display(Core::get(spec, "message", "fixture error"));
  auto number = [](Value value, int fallback) {
    if (value.is_null()) return fallback;
    return static_cast<int>(std::stod(display(value)));
  };
  if (type == "status") return AxError("ai", message, "AxAIServiceStatusError", number(Core::get(spec, "status"), 500), "", true);
  if (type == "authentication") return AxError("ai", "Authentication failed", "AxAIServiceAuthenticationError", number(Core::get(spec, "status"), 401), "", false);
  if (type == "response") return AxError("ai", message, "AxAIServiceResponseError", 0, "", false);
  if (type == "timeout") return AxError("ai", message, "AxAIServiceTimeoutError", 0, "", true);
  if (type == "plain") return AxError("runtime", message);
  return AxError("ai", "Network Error: " + message, "AxAIServiceNetworkError", 0, "", true);
}

static double conf_number(Value value);

struct RouterFixtureService : AxBaseAI {
  std::string fixture_id;
  Value model_list;
  Value features;
  Value metrics;
  double estimated_cost;
  std::vector<Value> requests;
  Array responses;

  explicit RouterFixtureService(Value spec)
      : AxBaseAI(display(Core::get(spec, "name", "fixture")),
                 display(Core::get(spec, "model", "fixture-chat")),
                 display(Core::get(spec, "embedModel", Core::get(spec, "embed_model", "fixture-embed")))),
        fixture_id(display(Core::get(spec, "id", display(Core::get(spec, "name", "fixture")) + "-id"))),
        model_list(Core::get(spec, "modelList")),
        features(Core::get(spec, "features", router_fixture_default_features())),
        metrics(Core::get(spec, "metrics", object({{"service", display(Core::get(spec, "name", "fixture"))}, {"calls", 0}}))),
        estimated_cost(conf_number(Core::get(spec, "estimatedCost", Core::get(spec, "estimated_cost", 0)))),
        responses(as_array(Core::get(spec, "responses", Value::array()))) {}

  std::string get_id() override { return fixture_id; }
  Value get_model_list() override { return model_list; }
  Value get_features(Value = Value()) override { return features; }
  Value get_metrics() override {
    Value out(as_object(metrics));
    if (!Core::get(out, "calls").is_null()) Core::set(out, "calls", static_cast<double>(requests.size()));
    return out;
  }
  double get_estimated_cost(Value) override { return estimated_cost; }

 protected:
  Value do_chat(Value request, Value options) override {
    requests.push_back(object({{"method", "chat"}, {"opt", options}}));
    if (!responses.empty()) {
      Value out = responses.front();
      responses.erase(responses.begin());
      Value error = Core::get(out, "error");
      if (!error.is_null()) throw fixture_ai_service_error_cpp(error);
      return Core::get(out, "response", out);
    }
    return object({{"results", Value(Array{object({{"index", 0}, {"content", name_ + " chat"}})})}});
  }

  Value do_embed(Value request, Value options) override {
    requests.push_back(object({{"method", "embed"}, {"opt", options}}));
    return object({{"embeddings", Value(Array{Value(Array{1, 2})})}, {"modelUsage", object({{"ai", name_}})}});
  }

 public:
  Value transcribe(Value request) override {
    return transcribe(std::move(request), Value::object());
  }

  Value transcribe(Value request, Value options) override {
    requests.push_back(object({{"method", "transcribe"}, {"opt", options}}));
    return object({{"text", name_ + " transcript"}});
  }

  Value speak(Value request) override {
    return speak(std::move(request), Value::object());
  }

  Value speak(Value request, Value options) override {
    requests.push_back(object({{"method", "speak"}, {"opt", options}}));
    return object({{"audio", "pcm"}});
  }
};

static double conf_number(Value value) {
  if (auto p = std::get_if<double>(&value.data)) return *p;
  std::string text = display(value);
  return text.empty() ? 0.0 : std::stod(text);
}

struct ScriptedOptimizerEngine : OptimizerEngine {
  Value response;
  std::vector<Value> requests;
  std::vector<Value> evaluations;
  std::vector<Value> transcripts;

  explicit ScriptedOptimizerEngine(Value response_) : response(std::move(response_)) {}

  std::string name() const override { return "scripted"; }
  std::string version() const override { return "1"; }

  Value optimize(Value request) override {
    requests.push_back(request);
    return response;
  }

  Value optimize(Value request, OptimizerEvaluator* evaluator) override {
    requests.push_back(request);
    if (evaluator != nullptr && !Core::get(response, "referenceCandidates").is_null()) {
      Value best_map = Value::object();
      bool has_best = false;
      double best_score = 0.0;
      for (const auto& step : Core::iter(Core::get(response, "referenceCandidates", Value::array()))) {
        Value candidate_map = Core::get(step, "component_map", Core::get(step, "componentMap", Value::object()));
        Value eval_options = Core::get(step, "options", Value::object());
        Value result = evaluator->evaluate(candidate_map, eval_options);
        Value evidence = Core::_build_optimizer_evidence_batch(result, Core::get(request, "components", Value::array()));
        evaluations.push_back(result);
        transcripts.push_back(object({{"candidateMap", candidate_map}, {"options", eval_options}, {"result", result}, {"evidence", evidence}}));
        double score = conf_number(Core::get(result, "avg", Value(0)));
        if (!has_best || score > best_score) {
          has_best = true;
          best_score = score;
          best_map = candidate_map;
        }
      }
      return object({{"componentMap", best_map}, {"metadata", object({{"referenceEngine", true}, {"evaluations", Value(transcripts)}})}});
    }
    if (evaluator != nullptr && !Core::get(response, "evaluate").is_null()) {
      for (const auto& step : Core::iter(Core::get(response, "evaluate", Value::array()))) {
        Value candidate_map = Core::get(step, "component_map", Core::get(step, "componentMap", Value::object()));
        Value eval_options = Core::get(step, "options", Value::object());
        Value result = evaluator->evaluate(
            candidate_map,
            eval_options);
        Value evidence = Core::_build_optimizer_evidence_batch(result, Core::get(request, "components", Value::array()));
        evaluations.push_back(result);
        transcripts.push_back(object({{"candidateMap", candidate_map}, {"options", eval_options}, {"result", result}, {"evidence", evidence}}));
      }
    }
    return response;
  }
};

struct ScriptedGEPAEvaluator : OptimizerEvaluator {
  Value fixture;
  std::vector<Value> evaluations;

  explicit ScriptedGEPAEvaluator(Value fixture_) : fixture(std::move(fixture_)) {}

  std::string component_id(Value candidate_map) const {
    std::string explicit_id = display(Core::get(fixture, "score_component_id", Value("")));
    if (!explicit_id.empty()) return explicit_id;
    Array keys = Core::iter(Core::map_keys(candidate_map));
    return keys.empty() ? "component" : display(keys[0]);
  }

  Value evaluate(Value candidate_map, Value options) override {
    Value dataset_input = !Core::get(options, "dataset").is_null() ? Core::get(options, "dataset") : Core::get(fixture, "dataset", Value::array());
    Value normalized = Core::_normalize_optimization_dataset(dataset_input);
    Array examples = Core::iter(Core::get(normalized, "train", Value::array()));
    if (examples.empty()) examples.push_back(object({{"input", object({{"fixture", "gepa"}})}}));
    std::string id = component_id(candidate_map);
    Value value = Core::get(candidate_map, id, Core::get(fixture, "base_component_value", Value("")));
    bool has_score_map = !Core::get(fixture, "gepa_scores").is_null();
    Value score_map = Core::get(fixture, "gepa_scores", Value::object());
    Value raw_score = Core::get(score_map, display(value), Core::get(score_map, "*", Value(0)));
    Array score_list = as_array(raw_score);
    Value rows = Value::array();
    for (size_t i = 0; i < examples.size(); ++i) {
      Value item_score = has_score_map
                             ? (score_list.empty() ? raw_score : score_list[std::min(i, score_list.size() - 1)])
                             : Core::get(examples[i], "metric_score", Core::get(examples[i], "scores", Core::get(examples[i], "score", Value(0))));
      Value scores = Core::_normalize_optimization_metric_scores(item_score);
      Value scalar = Core::_scalarize_optimization_scores(scores, Core::get(fixture, "score_options", Value::object()));
      Value trace = object({{"componentValue", display(value)}});
      Value prediction = object({
          {"completionType", "final"},
          {"output", object({{"componentValue", display(value)}})},
          {"finalOutput", object({{"componentValue", display(value)}})},
          {"functionCalls", Value::array()},
          {"actionLog", Value::array()},
          {"usage", Value::object()},
          {"trace", trace},
      });
      Core::append(rows, Core::_build_optimization_eval_row(examples[i], prediction, scores, scalar, trace, Value()));
    }
    Value result = Core::_build_optimization_eval_result(rows, candidate_map, Core::get(options, "phase", "gepa"));
    evaluations.push_back(result);
    return result;
  }
};

static void assert_subset(Value actual, Value expected, const std::string& label);

struct ScriptedCodeRuntime;

struct ScriptedCodeSession : AxCodeSession {
  ScriptedCodeRuntime* runtime;
  Value globals;
  Value create_options;
  bool closed = false;

  ScriptedCodeSession(ScriptedCodeRuntime* runtime_, Value globals_, Value options_) : runtime(runtime_), globals(std::move(globals_)), create_options(std::move(options_)) {}

  Value execute(Value code, Value options = Value::object()) override;
  Value inspect(Value options = Value::object()) override;
  Value snapshot_globals(Value options = Value::object()) override;
  Value patch_globals(Value snapshot, Value options = Value::object()) override;
  Value export_state(Value options = Value::object()) override {
    return snapshot_globals(options);
  }
  Value restore_state(Value snapshot, Value options = Value::object()) override {
    return patch_globals(snapshot, options);
  }
  Value close() override {
    closed = true;
    return object({{"closed", true}});
  }
};

struct ScriptedCodeRuntime : AxCodeRuntime {
  Array script;
  std::vector<std::unique_ptr<ScriptedCodeSession>> sessions;
  std::vector<Value> executed;
  std::vector<Value> create_requests;
  std::vector<Value> execute_options;
  std::string runtime_language;
  std::string runtime_usage;
  Value capabilities;

  explicit ScriptedCodeRuntime(Value script_value, std::string language = "JavaScript", std::string usage = "", Value capabilities_ = Value::object())
      : script(as_array(script_value)), runtime_language(std::move(language)), runtime_usage(std::move(usage)), capabilities(object({{"inspect", true}, {"snapshot", true}, {"patch", true}})) {
    for (const auto& kv : as_object(capabilities_)) {
      if (kv.first != "__order") Core::set(capabilities, kv.first, kv.second);
    }
  }

  std::string language() const override { return runtime_language.empty() ? "JavaScript" : runtime_language; }
  std::string usage_instructions() const override { return runtime_usage; }

  AxCodeSession* create_session(Value globals, Value options = Value::object()) override {
    create_requests.push_back(object({{"globals", globals}, {"options", options}}));
    sessions.push_back(std::make_unique<ScriptedCodeSession>(this, std::move(globals), std::move(options)));
    return sessions.back().get();
  }
};

Value ScriptedCodeSession::inspect(Value) {
  if (!Core::truthy(Core::get(runtime->capabilities, "inspect", true))) {
    return Value("[runtime state inspection unavailable: runtime session does not implement inspect_globals()]");
  }
  return globals;
}

Value ScriptedCodeSession::snapshot_globals(Value) {
  if (!Core::truthy(Core::get(runtime->capabilities, "snapshot", true))) {
    throw AxError("runtime", "AxCodeSession.snapshot_globals() is required to export AxAgent state");
  }
  Array entries;
  for (const auto& kv : as_object(globals)) {
    if (kv.first == "__order") continue;
    entries.push_back(object({{"name", kv.first}, {"type", "json"}, {"preview", display(kv.second)}}));
  }
  return object({{"version", 1}, {"entries", entries}, {"bindings", globals}, {"globals", globals}, {"closed", closed}});
}

Value ScriptedCodeSession::patch_globals(Value snapshot, Value options) {
  if (!Core::truthy(Core::get(runtime->capabilities, "patch", true))) {
    throw AxError("runtime", "AxCodeSession.patch_globals() is required to restore AxAgent state");
  }
  Value raw = !Core::get(snapshot, "bindings", Value()).is_null() ? Core::get(snapshot, "bindings", Value::object()) : Core::get(snapshot, "globals", Value::object());
  globals = raw;
  closed = Core::truthy(Core::get(snapshot, "closed", false));
  return snapshot_globals(options);
}

Value ScriptedCodeSession::execute(Value code, Value options) {
  if (closed) return object({{"is_error", true}, {"error_category", "session_closed"}, {"error", "session closed"}});
  if (runtime->script.empty()) throw AxError("fixture", "scripted runtime exhausted");
  Value step = runtime->script.front();
  runtime->script.erase(runtime->script.begin());
  Value expected = Core::get(step, "expected_code", Value());
  if (!expected.is_null() && display(expected) != display(code)) {
    throw AxError("fixture", "expected code " + display(expected) + ", got " + display(code));
  }
  Value expected_options = Core::get(step, "expected_options_subset", Value());
  if (!expected_options.is_null()) {
    assert_subset(options, expected_options, "runtime execute options");
  }
  runtime->executed.emplace_back(display(code));
  runtime->execute_options.push_back(options);
  Value patch = Core::get(step, "bindings_patch", Value::object());
  for (const auto& kv : as_object(patch)) {
    if (kv.first != "__order") Core::set(globals, kv.first, kv.second);
  }
  if (Core::truthy(Core::get(step, "close_before_result", false))) closed = true;
  Value default_result = object({{"kind", "result"}, {"result", globals}});
  return Core::get(step, "result", default_result);
}

static std::vector<std::pair<std::string, Value>> conf_entries(Value value) {
  Object obj = as_object(value);
  std::vector<std::pair<std::string, Value>> out;
  std::set<std::string> seen;
  auto order_it = obj.find("__order");
  if (order_it != obj.end()) {
    for (const auto& item : as_array(order_it->second)) {
      std::string key = display(item);
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

static std::string read_file(const std::filesystem::path& path) {
  std::ifstream in(path);
  std::ostringstream ss;
  ss << in.rdbuf();
  return ss.str();
}

static std::vector<std::filesystem::path> expand(const std::filesystem::path& path) {
  if (!std::filesystem::is_directory(path)) return {path};
  std::vector<std::filesystem::path> out;
  for (const auto& entry : std::filesystem::directory_iterator(path)) {
    if (entry.path().extension() == ".json") out.push_back(entry.path());
  }
  std::sort(out.begin(), out.end());
  return out;
}

static Value field_from_spec(Value spec);

static Value string_array(Value value) {
  Array out;
  for (const auto& item : as_array(value)) out.emplace_back(display(item));
  return Value(out);
}

static Value field_from_spec(Value spec) {
  Object s = as_object(spec);
  std::string typ = s.count("type") ? display(s["type"]) : "string";
  Object type{{"name", typ}, {"isArray", Core::truthy(Core::get(spec, "array", false))}};
  if (typ == "class") type["options"] = s.count("options") ? s["options"] : Value::array();
  if (typ == "object") {
    Object nested;
    Array order;
    for (const auto& kv : conf_entries(Core::get(spec, "fields", Value::object()))) {
      Value nested_field = field_from_spec(kv.second);
      Core::set(nested_field, "name", kv.first);
      nested[kv.first] = Core::record_new("Field", nested_field);
      order.emplace_back(kv.first);
    }
    nested["__order"] = order;
    type["fields"] = Value(nested);
  }
  if (s.count("description") && (typ != "object" || Core::truthy(Core::get(spec, "array", false)))) type["description"] = s["description"];
  if (s.count("min")) {
    if (typ == "number") type["minimum"] = s["min"];
    else type["minLength"] = s["min"];
  }
  if (s.count("max")) {
    if (typ == "number") type["maximum"] = s["max"];
    else type["maxLength"] = s["max"];
  }
  if (Core::truthy(Core::get(spec, "email", false))) type["format"] = "email";
  if (Core::truthy(Core::get(spec, "url", false)) && typ == "string") type["format"] = "uri";
  if (s.count("pattern")) {
    type["pattern"] = s["pattern"];
    type["patternDescription"] = s.count("patternDescription") ? s["patternDescription"] : s["pattern"];
  }
  Object field{{"name", ""}, {"type", Core::record_new("FieldType", Value(type))},
               {"isOptional", Core::truthy(Core::get(spec, "optional", false))},
               {"isInternal", Core::truthy(Core::get(spec, "internal", false))},
               {"isCached", Core::truthy(Core::get(spec, "cache", false))}};
  if (s.count("arrayDescription")) field["description"] = s["arrayDescription"];
  else if (s.count("description")) field["description"] = s["description"];
  return Value(field);
}

static Value signature_from_spec(Value spec) {
  Object out{{"description", Core::get(spec, "description")}};
  Array inputs, outputs;
  for (const auto& kv : conf_entries(Core::get(spec, "inputs", Value::object()))) {
    Value f = field_from_spec(kv.second);
    Core::set(f, "name", kv.first);
    f = Core::record_new("Field", f);
    inputs.push_back(f);
  }
  for (const auto& kv : conf_entries(Core::get(spec, "outputs", Value::object()))) {
    Value f = field_from_spec(kv.second);
    Core::set(f, "name", kv.first);
    f = Core::record_new("Field", f);
    outputs.push_back(f);
  }
  out["inputs"] = inputs;
  out["outputs"] = outputs;
  Value sig(out);
  Core::validate_signature(sig);
  return sig;
}

static Value build_signature(Value fixture) {
  if (!Core::get(fixture, "signature_spec").is_null()) return signature_from_spec(Core::get(fixture, "signature_spec"));
  Value sig = Core::parse_signature(Core::get(fixture, "signature"));
  Core::validate_signature(sig);
  return sig;
}

static Value field_payload(Value field);
static Value type_payload(Value typ) {
  Object out{{"name", Core::get(typ, "name")}, {"isArray", Core::get(typ, "is_array", false)}};
  for (const auto& key : {"options", "description", "fields", "minLength", "maxLength", "minimum", "maximum", "pattern", "patternDescription", "format", "language"}) {
    Value value = Core::get(typ, key);
    if (!value.is_null()) {
      if (std::string(key) == "fields") {
        Object nested;
        Array order;
        for (const auto& kv : conf_entries(value)) {
          Value nested_field = kv.second;
          if (Core::get(nested_field, "name").is_null() || display(Core::get(nested_field, "name")).empty()) {
            Core::set(nested_field, "name", kv.first);
            nested_field = Core::record_new("Field", nested_field);
          }
          nested[kv.first] = field_payload(nested_field);
          order.emplace_back(kv.first);
        }
        nested["__order"] = order;
        out[key] = Value(nested);
      } else out[key] = value;
    }
  }
  return Value(out);
}
static Value field_payload(Value field) {
  Object out{{"name", Core::get(field, "name")}, {"title", Core::get(field, "title")}, {"type", type_payload(Core::get(field, "type"))},
             {"isOptional", Core::get(field, "is_optional", false)}, {"isInternal", Core::get(field, "is_internal", false)}, {"isCached", Core::get(field, "is_cached", false)}};
  if (!Core::get(field, "description").is_null()) out["description"] = Core::get(field, "description");
  return Value(out);
}
static Value signature_payload(Value sig) {
  Array inputs, outputs;
  for (const auto& f : as_array(Core::get(sig, "inputs"))) inputs.push_back(field_payload(f));
  for (const auto& f : as_array(Core::get(sig, "outputs"))) outputs.push_back(field_payload(f));
  return Value(Object{{"description", Core::get(sig, "description")}, {"inputs", inputs}, {"outputs", outputs}});
}

static void assert_equal(Value actual, Value expected, const std::string& label) {
  if (!equal(actual, expected)) throw AxError("fixture", label + " mismatch actual=" + stringify(actual) + " expected=" + stringify(expected));
}

static void assert_subset(Value actual, Value expected, const std::string& label) {
  if (expected.is_object()) {
    Object act = as_object(actual);
    for (const auto& kv : conf_entries(expected)) {
      auto it = act.find(kv.first);
      if (it == act.end()) throw AxError("fixture", label + " missing key " + kv.first);
      assert_subset(it->second, kv.second, label + "." + kv.first);
    }
    return;
  }
  if (expected.is_array()) {
    assert_equal(actual, expected, label);
    return;
  }
  if (!equal(actual, expected)) throw AxError("fixture", label + " expected " + stringify(expected) + ", got " + stringify(actual));
}

static void assert_list_subset(Value actual, Value expected, const std::string& label) {
  Array act = Core::iter(actual);
  size_t start = 0;
  for (const auto& item : Core::iter(expected)) {
    bool matched = false;
    for (size_t i = start; i < act.size(); ++i) {
      try {
        assert_subset(act[i], item, label + "[" + std::to_string(i) + "]");
        start = i + 1;
        matched = true;
        break;
      } catch (const AxError&) {
      }
    }
    if (!matched) throw AxError("fixture", label + " missing expected item " + stringify(item));
  }
}

static Value expect_maybe_error(const std::function<Value()>& fn, Value fixture) {
  try {
    Value out = fn();
    if (!Core::get(fixture, "expected_error_contains").is_null()) throw AxError("fixture", "expected operation to fail");
    return out;
  } catch (const AxError& e) {
    if (e.category == "fixture") throw;
    Value expected = Core::get(fixture, "expected_error_contains");
    if (expected.is_null()) throw;
    Value expected_category = Core::get(fixture, "expected_error_category");
    if (!expected_category.is_null() && e.category != display(expected_category)) {
      throw AxError("fixture", std::string("expected error category ") + display(expected_category) + ", got " + e.category);
    }
    if (std::string(e.what()).find(display(expected)) == std::string::npos) throw AxError("fixture", std::string("expected error containing ") + display(expected) + ", got " + e.what());
    return Value();
  }
}

struct ToolBuild {
  std::vector<Tool> tools;
  Value values = Value::array();
  Value calls = Value::array();
};

static ToolBuild build_tools(Value specs) {
  ToolBuild out;
  for (const auto& item : as_array(specs)) {
    Value spec = item;
    std::string name = display(Core::get(spec, "name"));
    Value args = Value::array();
    for (const auto& kv : conf_entries(Core::get(spec, "args", Value::object()))) {
      Value field = field_from_spec(kv.second);
      Core::set(field, "name", kv.first);
      Core::append(args, Core::record_new("Field", field));
    }
    Value returns = Value::array();
    for (const auto& kv : conf_entries(Core::get(spec, "returns", Value::object()))) {
      Value field = field_from_spec(kv.second);
      Core::set(field, "name", kv.first);
      Core::append(returns, Core::record_new("Field", field));
    }
    Value parameters = Core::to_json_schema(args, name + "Args", Value::object());
    Value calls = out.calls;
    Tool tool(
        name,
        display(Core::get(spec, "description", name)),
        parameters,
        [calls, spec, name](Value params) mutable {
          Value call = Value::object();
          Core::set(call, "name", name);
          Core::set(call, "args", params);
          Core::append(calls, call);
          Value error = Core::get(spec, "error");
          if (!error.is_null() && Core::truthy(error)) throw AxError("runtime", display(error));
          return Core::get(spec, "result");
        },
        args,
        returns);
    Core::append(out.values, tool.value());
    out.tools.push_back(std::move(tool));
  }
  return out;
}

static void run_forward(Value fixture) {
  Value sig = build_signature(fixture);
  ToolBuild tool_build = build_tools(Core::get(fixture, "tools", Value::array()));
  Value options = Core::map_merge(Core::get(fixture, "options", Value::object()), Value(Object{{"functions", tool_build.values}}));
  AxGen gen(sig, options);
  if (!Core::get(fixture, "examples").is_null()) gen.set_examples(Core::get(fixture, "examples"));
  if (!Core::get(fixture, "demos").is_null()) gen.set_demos(Core::get(fixture, "demos"));
  for (const auto& assertion : Core::iter(Core::get(fixture, "assertions", Value::array()))) gen.add_assert(assertion);
  for (const auto& processor : Core::iter(Core::get(fixture, "field_processors", Core::get(fixture, "fieldProcessors", Value::array())))) {
    gen.add_field_processor(display(Core::get(processor, "field")), display(Core::get(processor, "processor", Core::get(processor, "op"))));
  }
  if (!Core::get(fixture, "stop_functions", Core::get(fixture, "stopFunctions")).is_null()) {
    gen.set_stop_functions(Core::get(fixture, "stop_functions", Core::get(fixture, "stopFunctions", Value::array())));
  }
  ConformanceScriptedAI client(Core::get(fixture, "responses", Value::array()));
  Value input = Core::get(fixture, "input", Core::get(fixture, "values", Value::object()));
  Value output = expect_maybe_error([&] { return gen.forward(client, input, Core::get(fixture, "forward_options", Value::object())); }, fixture);
  if (Core::get(fixture, "expected_error_contains").is_null() && !Core::get(fixture, "expected_output").is_null()) {
    assert_equal(output, Core::get(fixture, "expected_output"), "forward output");
  }
  Value expected_count = Core::get(fixture, "expected_request_count");
  if (!expected_count.is_null() && client.requests.size() != static_cast<size_t>(std::stoul(display(expected_count)))) {
    throw AxError("fixture", "expected request count mismatch");
  }
  if (Core::truthy(Core::get(fixture, "expect_chat_path", true)) && client.chat_calls == 0) {
    throw AxError("fixture", "expected AxGen to use AIClient.chat()");
  }
  Value expected_request = Core::get(fixture, "expected_request");
  if (!expected_request.is_null()) {
    if (client.requests.empty()) throw AxError("fixture", "fixture expected a request but none were sent");
    assert_subset(client.requests[0], expected_request, "request");
  }
  Value expected_contains = Core::get(fixture, "expected_request_contains");
  if (!expected_contains.is_null()) {
    std::string request_text = stringify(Value(client.requests));
    for (const auto& item : Core::iter(expected_contains)) {
      if (request_text.find(display(item)) == std::string::npos) throw AxError("fixture", "request missing " + display(item) + ": " + request_text);
    }
  }
  Value expected_tool_calls = Core::get(fixture, "expected_tool_calls");
  if (!expected_tool_calls.is_null()) assert_equal(tool_build.calls, expected_tool_calls, "tool calls");
  Value expected_trace = Core::get(fixture, "expected_trace");
  if (!expected_trace.is_null()) {
    Value traces = gen.get_traces();
    Array trace_items = Core::iter(traces);
    if (trace_items.empty()) throw AxError("fixture", "expected trace but none was recorded");
    assert_subset(trace_items.back(), expected_trace, "trace");
  }
  Value expected_memory_count = Core::get(fixture, "expected_memory_history_count");
  if (!expected_memory_count.is_null() && Core::iter(gen.get_memory().history()).size() != static_cast<size_t>(std::stoul(display(expected_memory_count)))) {
    throw AxError("fixture", "expected memory history count mismatch");
  }
  if (!Core::get(fixture, "expected_memory_history_subset").is_null()) assert_list_subset(gen.get_memory().history(), Core::get(fixture, "expected_memory_history_subset"), "memory history");
  if (!Core::get(fixture, "expected_chat_log_subset").is_null()) assert_list_subset(gen.get_chat_log(), Core::get(fixture, "expected_chat_log_subset"), "chat log");
  if (!Core::get(fixture, "expected_function_traces_subset").is_null()) assert_list_subset(gen.get_function_call_traces(), Core::get(fixture, "expected_function_traces_subset"), "function call traces");
  if (!Core::get(fixture, "expected_chat_prompt").is_null()) {
    if (client.requests.empty()) throw AxError("fixture", "fixture expected a request but none were sent");
    assert_equal(Core::get(client.requests[0], "chat_prompt"), Core::get(fixture, "expected_chat_prompt"), "chat prompt");
  }
  if (!Core::get(fixture, "expected_chat_prompt_contains").is_null()) {
    if (client.requests.empty()) throw AxError("fixture", "fixture expected a request but none were sent");
    std::string prompt_text = stringify(Core::get(client.requests[0], "chat_prompt"));
    for (const auto& item : Core::iter(Core::get(fixture, "expected_chat_prompt_contains"))) {
      if (prompt_text.find(display(item)) == std::string::npos) throw AxError("fixture", "chat prompt missing " + display(item) + ": " + prompt_text);
    }
  }
}

static void run_stream(Value fixture) {
  Value chunks = Value::array();
  try {
    for (const auto& event : Core::iter(Core::get(fixture, "stream_events", Value::array()))) {
      Core::append(chunks, event);
      for (const auto& raw : Core::iter(Core::get(fixture, "streaming_assertions", Value::array()))) {
        Value needle = Core::get(raw, "not_contains", Core::get(raw, "notContains"));
        if (needle.is_null()) continue;
        if (display(Core::fold_stream(chunks)).find(display(needle)) != std::string::npos) {
          throw AxError("runtime", display(Core::get(raw, "message", "streaming assertion failed")));
        }
      }
    }
  } catch (const std::exception& e) {
    std::string expected = display(Core::get(fixture, "expected_error_contains", ""));
    if (!expected.empty() && std::string(e.what()).find(expected) != std::string::npos) return;
    throw;
  }
  if (!Core::get(fixture, "expected_error_contains").is_null()) throw AxError("fixture", "expected stream assertion to fail");
  assert_equal(Core::fold_stream(chunks), Core::get(fixture, "expected_folded", ""), "stream");
}

static Value optimize_component_ids(Value components) {
  Value ids = Value::array();
  for (const auto& component : Core::iter(components)) Core::append(ids, Core::get(component, "id"));
  return ids;
}

static AxFlow build_flow(Value fixture, std::vector<std::unique_ptr<AxGen>>& programs, std::vector<std::unique_ptr<AxFlow>>& flows, std::vector<std::unique_ptr<AxAgent>>& agents);
static Value verification_instruments_summary();

static void run_optimize(Value fixture) {
  std::string program_kind = display(Core::get(fixture, "program", "agent"));
  Value options = Core::get(fixture, "options", Value::object());
  ToolBuild tool_build = build_tools(Core::get(fixture, "tools", Value::array()));
  if (!as_array(tool_build.values).empty()) Core::set(options, "functions", tool_build.values);
  std::string op = display(Core::get(fixture, "operation", "components"));
  try {
    if (op == "verification") {
      assert_equal(verification_instruments_summary(), Core::get(fixture, "expected_output"), "verification instruments");
      return;
    }
    if (op == "dataset") {
      Value normalized = Core::_normalize_optimization_dataset(Core::get(fixture, "dataset", Value::array()));
      assert_equal(normalized, Core::get(fixture, "expected_dataset"), "normalized dataset");
      return;
    }
    if (op == "playbook-empty") {
      Value playbook = Core::_ace_empty_playbook(Core::get(fixture, "description"), Core::get(fixture, "now", Value("")));
      assert_equal(playbook, Core::get(fixture, "expected_playbook"), "ace empty playbook");
      return;
    }
    if (op == "playbook-render") {
      Value rendered = Core::_ace_render_playbook(Core::get(fixture, "playbook", Value::object()));
      assert_equal(rendered, Core::get(fixture, "expected_render"), "ace rendered playbook");
      return;
    }
    if (op == "playbook-stats") {
      Value playbook = Core::_ace_recompute_playbook_stats(Core::get(fixture, "playbook", Value::object()));
      assert_equal(playbook, Core::get(fixture, "expected_playbook"), "ace recomputed stats");
      return;
    }
    if (op == "playbook-dedupe") {
      Value playbook = Core::_ace_dedupe_playbook(Core::get(fixture, "playbook", Value::object()));
      assert_equal(playbook, Core::get(fixture, "expected_playbook"), "ace deduped playbook");
      return;
    }
    if (op == "playbook-feedback") {
      Value playbook = Core::_ace_update_bullet_feedback(Core::get(fixture, "playbook", Value::object()), Core::get(fixture, "bullet_id", Value("")), Core::get(fixture, "tag", Value("")), Core::get(fixture, "now", Value("")));
      assert_equal(playbook, Core::get(fixture, "expected_playbook"), "ace bullet feedback");
      return;
    }
    if (op == "playbook-apply-ops") {
      Value result = Core::_ace_apply_curator_operations(Core::get(fixture, "playbook", Value::object()), Core::get(fixture, "operations", Value::array()), Core::get(fixture, "apply_options", Value::object()), Core::get(fixture, "now", Value("")));
      assert_equal(result, Core::get(fixture, "expected_result"), "ace applied operations");
      return;
    }
    if (op == "ace-compile" || op == "ace-online-update") {
      auto reflections = std::make_shared<Array>(as_array(Core::get(fixture, "reflection_responses", Value::array())));
      auto curators = std::make_shared<Array>(as_array(Core::get(fixture, "curator_responses", Value::array())));
      auto predictions = std::make_shared<Array>(as_array(Core::get(fixture, "generator_predictions", Value::array())));
      auto scores = std::make_shared<Array>(as_array(Core::get(fixture, "metric_scores", Value::array())));
      auto ri = std::make_shared<size_t>(0);
      auto ci = std::make_shared<size_t>(0);
      auto gi = std::make_shared<size_t>(0);
      auto si = std::make_shared<size_t>(0);
      AxACE::AceCallable reflector = [reflections, ri](const Value&) -> Value {
        if (*ri >= reflections->size()) return Value();
        return (*reflections)[(*ri)++];
      };
      AxACE::AceCallable curator = [curators, ci](const Value&) -> Value {
        if (*ci >= curators->size()) return Value();
        return (*curators)[(*ci)++];
      };
      AxACE::AceCallable generator = [predictions, gi](const Value&) -> Value {
        if (*gi >= predictions->size()) return Value::object();
        return (*predictions)[(*gi)++];
      };
      AxACE::AceCallable metric = [scores, si](const Value&) -> Value {
        if (*si >= scores->size()) return Value(0);
        return (*scores)[(*si)++];
      };
      Value ace_options = Core::get(fixture, "ace_options", Value::object());
      Core::set(ace_options, "now", Core::get(fixture, "now", Value("1970-01-01T00:00:00.000Z")));
      if (!Core::get(fixture, "initial_playbook").is_null()) Core::set(ace_options, "initialPlaybook", Core::get(fixture, "initial_playbook"));
      AxACE ace(ace_options);
      ace.set_callables(reflector, curator, generator);
      if (op == "ace-compile") {
        Array examples = as_array(Core::get(fixture, "examples", Value::array()));
        Value result = ace.compile(examples, metric, Value::object());
        if (!Core::get(fixture, "expected_playbook").is_null()) assert_equal(ace.get_playbook(), Core::get(fixture, "expected_playbook"), "ace compile playbook");
        if (!Core::get(fixture, "expected_artifact").is_null()) assert_equal(ace.get_artifact(), Core::get(fixture, "expected_artifact"), "ace compile artifact");
        if (!Core::get(fixture, "expected_artifact_subset").is_null()) assert_subset(ace.get_artifact(), Core::get(fixture, "expected_artifact_subset"), "ace compile artifact");
        if (!Core::get(fixture, "expected_result_subset").is_null()) assert_subset(result, Core::get(fixture, "expected_result_subset"), "ace compile result");
        return;
      }
      Value update_args = Core::get(fixture, "update", Value::object());
      if (Core::get(update_args, "prediction").is_null()) Core::set(update_args, "prediction", generator(Core::get(update_args, "example")));
      Value curator_result = ace.apply_online_update(update_args);
      if (!Core::get(fixture, "expected_playbook").is_null()) assert_equal(ace.get_playbook(), Core::get(fixture, "expected_playbook"), "ace online playbook");
      if (!Core::get(fixture, "expected_artifact").is_null()) assert_equal(ace.get_artifact(), Core::get(fixture, "expected_artifact"), "ace online artifact");
      if (!Core::get(fixture, "expected_artifact_subset").is_null()) assert_subset(ace.get_artifact(), Core::get(fixture, "expected_artifact_subset"), "ace online artifact");
      if (!Core::get(fixture, "expected_curator").is_null()) assert_equal(curator_result, Core::get(fixture, "expected_curator"), "ace online curator");
      return;
    }
    if (op == "score") {
      Value scores = Core::_normalize_optimization_metric_scores(Core::get(fixture, "metric_score"));
      Value scalar = Core::_scalarize_optimization_scores(scores, Core::get(fixture, "score_options", Value::object()));
      Value adjusted = Core::_adjust_optimization_score_for_actions(scalar, Core::get(fixture, "task", Value::object()), Core::get(fixture, "prediction", object({{"functionCalls", Value::array()}})));
      if (!Core::get(fixture, "expected_scores").is_null()) assert_equal(scores, Core::get(fixture, "expected_scores"), "metric scores");
      if (!Core::get(fixture, "expected_scalar").is_null()) assert_equal(adjusted, Core::get(fixture, "expected_scalar"), "metric scalar");
      if (!Core::get(fixture, "quality").is_null()) assert_equal(Core::_map_optimization_judge_quality_to_score(Core::get(fixture, "quality")), Core::get(fixture, "expected_quality_score"), "judge quality score");
      return;
    }
    if (op == "judge_payload") {
      Value payload = Core::_build_optimization_judge_payload(Core::get(fixture, "task", Value::object()), Core::get(fixture, "prediction", Value::object()), Core::get(fixture, "criteria", Value("")));
      if (!Core::get(fixture, "expected_judge_payload_subset").is_null()) assert_subset(payload, Core::get(fixture, "expected_judge_payload_subset"), "judge payload");
      return;
    }
    if (op == "evidence") {
      Value evidence = Core::_build_optimizer_evidence_batch(Core::get(fixture, "eval_result", Value::object()), Core::get(fixture, "components", Value::array()));
      if (!Core::get(fixture, "expected_evidence_subset").is_null()) assert_subset(evidence, Core::get(fixture, "expected_evidence_subset"), "optimizer evidence");
      return;
    }
    if (op == "gepa") {
      Value components = Core::get(fixture, "components", Value::array());
      Value request = object({
          {"contractVersion", "axir-optimize-v1"},
          {"programId", program_kind},
          {"programKind", program_kind},
          {"components", components},
          {"targetComponents", components},
          {"dataset", Core::_normalize_optimization_dataset(Core::get(fixture, "dataset", Value::array()))},
          {"options", Core::get(fixture, "optimize_options", Value::object())},
          {"evidence", object({{"source", "fixture"}})},
      });
      std::unique_ptr<ConformanceScriptedAI> reflection;
      AIClient* reflection_ptr = nullptr;
      if (!Core::get(fixture, "reflection_responses").is_null()) {
        reflection = std::make_unique<ConformanceScriptedAI>(Core::get(fixture, "reflection_responses", Value::array()));
        reflection_ptr = reflection.get();
      }
      AxGEPA engine(reflection_ptr, Core::get(fixture, "gepa_options", Value::object()));
      ScriptedGEPAEvaluator evaluator(fixture);
      Value artifact = engine.optimize(request, &evaluator);
      if (!Core::get(fixture, "expected_artifact_subset").is_null()) assert_subset(artifact, Core::get(fixture, "expected_artifact_subset"), "GEPA artifact");
      if (!Core::get(fixture, "expected_gepa_evaluations_subset").is_null()) assert_list_subset(Value(evaluator.evaluations), Core::get(fixture, "expected_gepa_evaluations_subset"), "GEPA evaluations");
      return;
    }
    if (op == "bootstrap") {
      Value components = Core::get(fixture, "components", Value::array());
      Value request = object({
          {"contractVersion", "axir-optimize-v1"},
          {"programId", program_kind},
          {"programKind", program_kind},
          {"components", components},
          {"targetComponents", components},
          {"dataset", Core::_normalize_optimization_dataset(Core::get(fixture, "dataset", Value::array()))},
          {"options", Core::get(fixture, "optimize_options", Value::object())},
          {"evidence", object({{"source", "fixture"}})},
      });
      AxBootstrapFewShot engine(Core::get(fixture, "optimize_options", Value::object()));
      ScriptedGEPAEvaluator evaluator(fixture);
      Value artifact = engine.optimize(request, &evaluator);
      if (!Core::get(fixture, "expected_artifact_subset").is_null()) assert_subset(artifact, Core::get(fixture, "expected_artifact_subset"), "BootstrapFewShot artifact");
      if (!Core::get(fixture, "expected_demo_count").is_null()) {
        size_t actual_demos = Core::iter(Core::get(artifact, "demos", Value::array())).size();
        size_t expected_demos = static_cast<size_t>(std::stoul(display(Core::get(fixture, "expected_demo_count"))));
        if (actual_demos != expected_demos) throw AxError("fixture", "unexpected demo count for " + display(Core::get(fixture, "name", "fixture")) + ": got " + std::to_string(actual_demos) + ", expected " + std::to_string(expected_demos));
      }
      if (!Core::get(fixture, "expected_gepa_evaluations_subset").is_null()) assert_list_subset(Value(evaluator.evaluations), Core::get(fixture, "expected_gepa_evaluations_subset"), "BootstrapFewShot evaluations");
      return;
    }
    if (program_kind == "axgen") {
      AxGen gen(build_signature(fixture), options);
      if (op == "components") {
        Value components = gen.get_optimizable_components();
        if (!Core::get(fixture, "expected_components_subset").is_null()) assert_list_subset(components, Core::get(fixture, "expected_components_subset"), "optimizable components");
        if (!Core::get(fixture, "expected_component_ids").is_null()) assert_equal(optimize_component_ids(components), Core::get(fixture, "expected_component_ids"), "component ids");
        return;
      }
      if (op == "apply") {
        Value before = gen.get_optimizable_components();
        Value artifact = Core::_optimized_artifact("fixture", "1", Core::get(fixture, "component_map", Value::object()), Core::get(fixture, "metadata", object({{"source", "fixture"}})));
        Value validated = Core::_validate_optimized_artifact(artifact, before);
        Value payload = Core::truthy(Core::get(fixture, "serialized_artifact", false)) ? Core::_serialize_optimized_artifact(validated) : validated;
        gen.apply_optimization(payload);
        Value after = gen.get_optimizable_components();
        if (!Core::get(fixture, "expected_components_subset").is_null()) assert_list_subset(after, Core::get(fixture, "expected_components_subset"), "optimized components");
        if (!Core::get(fixture, "expected_changed_components").is_null()) assert_equal(Core::_optimization_changed_components(before, Core::get(fixture, "component_map", Value::object())), Core::get(fixture, "expected_changed_components"), "changed components");
        return;
      }
      if (op == "evaluate") {
        ConformanceScriptedAI client(Core::get(fixture, "responses", Value::array()));
        Value result = gen.evaluate_optimization(client, Core::get(fixture, "dataset", Value::array()), Core::get(fixture, "candidate_map", Value::object()), Core::get(fixture, "eval_options", Value::object()));
        if (!Core::get(fixture, "expected_evaluation_subset").is_null()) assert_subset(result, Core::get(fixture, "expected_evaluation_subset"), "optimization evaluation");
        if (!Core::get(fixture, "expected_evaluation_rows_subset").is_null()) assert_list_subset(Core::get(result, "rows", Value::array()), Core::get(fixture, "expected_evaluation_rows_subset"), "optimization evaluation rows");
        if (!Core::get(fixture, "expected_components_subset_after").is_null()) assert_list_subset(gen.get_optimizable_components(), Core::get(fixture, "expected_components_subset_after"), "post-eval components");
        return;
      }
      if (op == "engine") {
        ScriptedOptimizerEngine engine(Core::get(fixture, "engine_response", Value::object()));
        Value artifact;
        if (Core::truthy(Core::get(fixture, "engine_uses_evaluator", false))) {
          ConformanceScriptedAI client(Core::get(fixture, "responses", Value::array()));
          artifact = gen.optimize_with(engine, client, Core::get(fixture, "dataset", Value::array()), Core::get(fixture, "optimize_options", Value::object()));
        } else {
          artifact = gen.optimize_with(engine, Core::get(fixture, "dataset", Value::array()), Core::get(fixture, "optimize_options", Value::object()));
        }
        if (!Core::get(fixture, "expected_engine_request_subset").is_null()) {
          if (engine.requests.empty()) throw AxError("fixture", "optimizer engine was not called");
          assert_subset(engine.requests[0], Core::get(fixture, "expected_engine_request_subset"), "optimizer engine request");
        }
        if (!Core::get(fixture, "expected_engine_evaluations_subset").is_null()) assert_list_subset(Value(engine.evaluations), Core::get(fixture, "expected_engine_evaluations_subset"), "optimizer engine evaluations");
        if (!Core::get(fixture, "expected_engine_transcripts_subset").is_null()) assert_list_subset(Value(engine.transcripts), Core::get(fixture, "expected_engine_transcripts_subset"), "optimizer engine transcripts");
        if (!Core::get(fixture, "expected_artifact_subset").is_null()) assert_subset(artifact, Core::get(fixture, "expected_artifact_subset"), "optimizer artifact");
        if (!Core::get(fixture, "expected_components_subset").is_null()) assert_list_subset(gen.get_optimizable_components(), Core::get(fixture, "expected_components_subset"), "optimized components");
        return;
      }
      if (op == "helper") {
        ConformanceScriptedAI client(Core::get(fixture, "responses", Value::array()));
        Value artifact = optimize(gen, client, Core::get(fixture, "dataset", Value::array()), Core::get(fixture, "optimize_options", Value::object()), &client);
        if (!Core::get(fixture, "expected_artifact_subset").is_null()) assert_subset(artifact, Core::get(fixture, "expected_artifact_subset"), "optimize helper artifact");
        if (!Core::get(fixture, "expected_demo_count").is_null()) {
          size_t actual_demos = Core::iter(Core::get(artifact, "demos", Value::array())).size();
          size_t expected_demos = static_cast<size_t>(std::stoul(display(Core::get(fixture, "expected_demo_count"))));
          if (actual_demos != expected_demos) throw AxError("fixture", "unexpected demo count for " + display(Core::get(fixture, "name", "fixture")) + ": got " + std::to_string(actual_demos) + ", expected " + std::to_string(expected_demos));
        }
        if (!Core::get(fixture, "expected_components_subset").is_null()) assert_list_subset(gen.get_optimizable_components(), Core::get(fixture, "expected_components_subset"), "post-helper components");
        return;
      }
    }
    if (program_kind == "flow") {
      std::vector<std::unique_ptr<AxGen>> programs;
      std::vector<std::unique_ptr<AxFlow>> flows;
      std::vector<std::unique_ptr<AxAgent>> agents;
      AxFlow fl = build_flow(fixture, programs, flows, agents);
      if (op == "components") {
        Value components = fl.get_optimizable_components();
        if (!Core::get(fixture, "expected_components_subset").is_null()) assert_list_subset(components, Core::get(fixture, "expected_components_subset"), "optimizable components");
        if (!Core::get(fixture, "expected_component_ids").is_null()) assert_equal(optimize_component_ids(components), Core::get(fixture, "expected_component_ids"), "component ids");
        return;
      }
      if (op == "filter") {
        Value filtered = Core::_filter_optimization_components(fl.get_optimizable_components(), Core::get(fixture, "target", "all"));
        assert_equal(optimize_component_ids(filtered), Core::get(fixture, "expected_component_ids", Value::array()), "filtered component ids");
        return;
      }
      if (op == "apply") {
        Value before = fl.get_optimizable_components();
        Value artifact = Core::_optimized_artifact("fixture", "1", Core::get(fixture, "component_map", Value::object()), Core::get(fixture, "metadata", object({{"source", "fixture"}})));
        Value validated = Core::_validate_optimized_artifact(artifact, before);
        Value payload = Core::truthy(Core::get(fixture, "serialized_artifact", false)) ? Core::_serialize_optimized_artifact(validated) : validated;
        fl.apply_optimization(payload);
        Value after = fl.get_optimizable_components();
        if (!Core::get(fixture, "expected_components_subset").is_null()) assert_list_subset(after, Core::get(fixture, "expected_components_subset"), "optimized components");
        if (!Core::get(fixture, "expected_changed_components").is_null()) assert_equal(Core::_optimization_changed_components(before, Core::get(fixture, "component_map", Value::object())), Core::get(fixture, "expected_changed_components"), "changed components");
        return;
      }
      if (op == "evaluate") {
        ConformanceScriptedAI client(Core::get(fixture, "responses", Value::array()));
        Value result = fl.evaluate_optimization(client, Core::get(fixture, "dataset", Value::array()), Core::get(fixture, "candidate_map", Value::object()), Core::get(fixture, "eval_options", Value::object()));
        if (!Core::get(fixture, "expected_evaluation_subset").is_null()) assert_subset(result, Core::get(fixture, "expected_evaluation_subset"), "optimization evaluation");
        if (!Core::get(fixture, "expected_evaluation_rows_subset").is_null()) assert_list_subset(Core::get(result, "rows", Value::array()), Core::get(fixture, "expected_evaluation_rows_subset"), "optimization evaluation rows");
        if (!Core::get(fixture, "expected_components_subset_after").is_null()) assert_list_subset(fl.get_optimizable_components(), Core::get(fixture, "expected_components_subset_after"), "post-eval components");
        return;
      }
      if (op == "engine") {
        ScriptedOptimizerEngine engine(Core::get(fixture, "engine_response", Value::object()));
        Value artifact;
        if (Core::truthy(Core::get(fixture, "engine_uses_evaluator", false))) {
          ConformanceScriptedAI client(Core::get(fixture, "responses", Value::array()));
          artifact = fl.optimize_with(engine, client, Core::get(fixture, "dataset", Value::array()), Core::get(fixture, "optimize_options", Value::object()));
        } else {
          artifact = fl.optimize_with(engine, Core::get(fixture, "dataset", Value::array()), Core::get(fixture, "optimize_options", Value::object()));
        }
        if (!Core::get(fixture, "expected_engine_request_subset").is_null()) {
          if (engine.requests.empty()) throw AxError("fixture", "optimizer engine was not called");
          assert_subset(engine.requests[0], Core::get(fixture, "expected_engine_request_subset"), "optimizer engine request");
        }
        if (!Core::get(fixture, "expected_engine_evaluations_subset").is_null()) assert_list_subset(Value(engine.evaluations), Core::get(fixture, "expected_engine_evaluations_subset"), "optimizer engine evaluations");
        if (!Core::get(fixture, "expected_engine_transcripts_subset").is_null()) assert_list_subset(Value(engine.transcripts), Core::get(fixture, "expected_engine_transcripts_subset"), "optimizer engine transcripts");
        if (!Core::get(fixture, "expected_artifact_subset").is_null()) assert_subset(artifact, Core::get(fixture, "expected_artifact_subset"), "optimizer artifact");
        if (!Core::get(fixture, "expected_components_subset").is_null()) assert_list_subset(fl.get_optimizable_components(), Core::get(fixture, "expected_components_subset"), "optimized components");
        return;
      }
      if (op == "helper") {
        ConformanceScriptedAI client(Core::get(fixture, "responses", Value::array()));
        Value artifact = optimize(fl, client, Core::get(fixture, "dataset", Value::array()), Core::get(fixture, "optimize_options", Value::object()), &client);
        if (!Core::get(fixture, "expected_artifact_subset").is_null()) assert_subset(artifact, Core::get(fixture, "expected_artifact_subset"), "optimize helper artifact");
        if (!Core::get(fixture, "expected_demo_count").is_null()) {
          size_t actual_demos = Core::iter(Core::get(artifact, "demos", Value::array())).size();
          size_t expected_demos = static_cast<size_t>(std::stoul(display(Core::get(fixture, "expected_demo_count"))));
          if (actual_demos != expected_demos) throw AxError("fixture", "unexpected demo count for " + display(Core::get(fixture, "name", "fixture")) + ": got " + std::to_string(actual_demos) + ", expected " + std::to_string(expected_demos));
        }
        if (!Core::get(fixture, "expected_components_subset").is_null()) assert_list_subset(fl.get_optimizable_components(), Core::get(fixture, "expected_components_subset"), "post-helper components");
        return;
      }
    }
    AxAgent ag(Core::get(fixture, "signature", "question:string -> answer:string"), options);
    if (op == "components") {
      Value components = ag.get_optimizable_components();
      if (!Core::get(fixture, "expected_components_subset").is_null()) assert_list_subset(components, Core::get(fixture, "expected_components_subset"), "optimizable components");
      if (!Core::get(fixture, "expected_component_ids").is_null()) assert_equal(optimize_component_ids(components), Core::get(fixture, "expected_component_ids"), "component ids");
      return;
    }
    if (op == "filter") {
      Value filtered = Core::_filter_optimization_components(ag.get_optimizable_components(), Core::get(fixture, "target", "all"));
      assert_equal(optimize_component_ids(filtered), Core::get(fixture, "expected_component_ids", Value::array()), "filtered component ids");
      return;
    }
    if (op == "apply") {
      Value before = ag.get_optimizable_components();
      Value artifact = Core::_optimized_artifact("fixture", "1", Core::get(fixture, "component_map", Value::object()), Core::get(fixture, "metadata", object({{"source", "fixture"}})));
      Value validated = Core::_validate_optimized_artifact(artifact, before);
      Value payload = Core::truthy(Core::get(fixture, "serialized_artifact", false)) ? Core::_serialize_optimized_artifact(validated) : validated;
      ag.apply_optimization(payload);
      Value after = ag.get_optimizable_components();
      if (!Core::get(fixture, "expected_components_subset").is_null()) assert_list_subset(after, Core::get(fixture, "expected_components_subset"), "optimized components");
      if (!Core::get(fixture, "expected_changed_components").is_null()) assert_equal(Core::_optimization_changed_components(before, Core::get(fixture, "component_map", Value::object())), Core::get(fixture, "expected_changed_components"), "changed components");
      return;
    }
    if (op == "artifact") {
      Value components = ag.get_optimizable_components();
      Value artifact = Core::_optimized_artifact("fixture", "1", Core::get(fixture, "component_map", Value::object()), Core::get(fixture, "metadata", Value::object()));
      Value decoded = Core::_deserialize_optimized_artifact(Core::_serialize_optimized_artifact(Core::_validate_optimized_artifact(artifact, components)), components);
      if (!Core::get(fixture, "expected_artifact_subset").is_null()) assert_subset(decoded, Core::get(fixture, "expected_artifact_subset"), "optimized artifact");
      return;
    }
    if (op == "engine") {
      ScriptedOptimizerEngine engine(Core::get(fixture, "engine_response", Value::object()));
      Value artifact;
      if (Core::truthy(Core::get(fixture, "engine_uses_evaluator", false))) {
        ConformanceScriptedAI client(Core::get(fixture, "responses", Value::array()));
        artifact = ag.optimize_with(engine, client, Core::get(fixture, "dataset", Value::array()), Core::get(fixture, "optimize_options", Value::object()));
      } else {
        artifact = ag.optimize_with(engine, Core::get(fixture, "dataset", Value::array()), Core::get(fixture, "optimize_options", Value::object()));
      }
      if (!Core::get(fixture, "expected_engine_request_subset").is_null()) {
        if (engine.requests.empty()) throw AxError("fixture", "optimizer engine was not called");
        assert_subset(engine.requests[0], Core::get(fixture, "expected_engine_request_subset"), "optimizer engine request");
      }
      if (!Core::get(fixture, "expected_engine_evaluations_subset").is_null()) assert_list_subset(Value(engine.evaluations), Core::get(fixture, "expected_engine_evaluations_subset"), "optimizer engine evaluations");
      if (!Core::get(fixture, "expected_engine_transcripts_subset").is_null()) assert_list_subset(Value(engine.transcripts), Core::get(fixture, "expected_engine_transcripts_subset"), "optimizer engine transcripts");
      if (!Core::get(fixture, "expected_artifact_subset").is_null()) assert_subset(artifact, Core::get(fixture, "expected_artifact_subset"), "optimizer artifact");
      if (!Core::get(fixture, "expected_components_subset").is_null()) assert_list_subset(ag.get_optimizable_components(), Core::get(fixture, "expected_components_subset"), "optimized components");
      return;
    }
    if (op == "helper") {
      ConformanceScriptedAI client(Core::get(fixture, "responses", Value::array()));
      Value artifact = optimize(ag, client, Core::get(fixture, "dataset", Value::array()), Core::get(fixture, "optimize_options", Value::object()), &client);
      if (!Core::get(fixture, "expected_artifact_subset").is_null()) assert_subset(artifact, Core::get(fixture, "expected_artifact_subset"), "optimize helper artifact");
      if (!Core::get(fixture, "expected_demo_count").is_null()) {
        size_t actual_demos = Core::iter(Core::get(artifact, "demos", Value::array())).size();
        size_t expected_demos = static_cast<size_t>(std::stoul(display(Core::get(fixture, "expected_demo_count"))));
        if (actual_demos != expected_demos) throw AxError("fixture", "unexpected demo count for " + display(Core::get(fixture, "name", "fixture")) + ": got " + std::to_string(actual_demos) + ", expected " + std::to_string(expected_demos));
      }
      if (!Core::get(fixture, "expected_components_subset").is_null()) assert_list_subset(ag.get_optimizable_components(), Core::get(fixture, "expected_components_subset"), "post-helper components");
      return;
    }
    if (op == "evaluate") {
      ConformanceScriptedAI client(Core::get(fixture, "responses", Value::array()));
      Value result = ag.evaluate_optimization(client, Core::get(fixture, "dataset", Value::array()), Core::get(fixture, "candidate_map", Value::object()), Core::get(fixture, "eval_options", Value::object()));
      if (!Core::get(fixture, "expected_evaluation_subset").is_null()) assert_subset(result, Core::get(fixture, "expected_evaluation_subset"), "optimization evaluation");
      if (!Core::get(fixture, "expected_evaluation_rows_subset").is_null()) assert_list_subset(Core::get(result, "rows", Value::array()), Core::get(fixture, "expected_evaluation_rows_subset"), "optimization evaluation rows");
      if (!Core::get(fixture, "expected_components_subset_after").is_null()) assert_list_subset(ag.get_optimizable_components(), Core::get(fixture, "expected_components_subset_after"), "post-eval components");
      return;
    }
    if (op == "eval") {
      ConformanceScriptedAI client(Core::get(fixture, "responses", Value::array()));
      Value prediction = ag.evaluate_optimization_task(client, Core::get(fixture, "task", object({{"input", Core::get(fixture, "input", Value::object())}})), Core::get(fixture, "eval_options", Value::object()));
      if (!Core::get(fixture, "expected_prediction_subset").is_null()) assert_subset(prediction, Core::get(fixture, "expected_prediction_subset"), "eval prediction");
      return;
    }
  } catch (const AxError& error) {
    Value expected = Core::get(fixture, "expected_error_contains");
    if (!expected.is_null() && std::string(error.what()).find(display(expected)) != std::string::npos) return;
    throw;
  }
  throw AxError("fixture", "unknown optimize operation " + op);
}

static Value verification_instruments_summary() {
  Array prompt_var_items = Core::iter(Core::collect_template_variable_names("Hello {{name}} and {{count}}", "verification"));
  std::sort(prompt_var_items.begin(), prompt_var_items.end(), [](const Value& left, const Value& right) {
    return display(left) < display(right);
  });
  Value prompt_vars = Value(prompt_var_items);
  Value chat_request = object({{"model", "gpt-fixture"}, {"chat_prompt", Value(Array{object({{"role", "user"}, {"content", "hello"}})})}, {"model_config", Value::object()}});
  Value chat_payload = Core::build_chat_request(Value(), chat_request, Value::object());
  Value chat_response = Core::normalize_chat_response(object({
      {"id", "chat-1"},
      {"model", "gpt-fixture"},
      {"choices", Value(Array{object({{"index", 0}, {"message", object({{"content", "hello"}})}, {"finish_reason", "stop"}})})},
      {"usage", object({{"prompt_tokens", 1}, {"completion_tokens", 2}, {"total_tokens", 3}})},
  }));
  Value embed_payload = Core::build_embed_request(Value(), object({{"embedModel", "embed-fixture"}, {"texts", Value(Array{"hello"})}}), Value::object());
  Value embed_response = Core::normalize_embed_response(object({
      {"id", "embed-1"},
      {"model", "embed-fixture"},
      {"data", Value(Array{object({{"embedding", Value(Array{0.1, 0.2})}})})},
      {"usage", object({{"prompt_tokens", 1}, {"total_tokens", 1}})},
  }));
  Value stream_response = Core::normalize_stream_delta(object({
      {"id", "stream-1"},
      {"model", "gpt-fixture"},
      {"choices", Value(Array{object({{"index", 0}, {"delta", object({{"content", "delta"}})}})})},
  }), Value::object());
  Value tool_call = Core::_openai_tool_call_to_provider_impl(object({{"id", "call-1"}, {"function", object({{"name", "lookup"}, {"params", object({{"term", "ax"}})}})}}));
  Value profile = Core::provider_resolve_profile("openai");
  (void)Core::_gemini_build_transcribe_request(object({{"audio", object({{"data", "audio-bytes"}, {"mimeType", "audio/wav"}})}}));
  (void)Core::_gemini_build_speak_request(object({{"text", "speak"}, {"voice", "Kore"}, {"format", "wav"}}));
  Value gemini_transcript = Core::_gemini_normalize_transcribe_response(object({{"candidates", Value(Array{object({{"content", object({{"parts", Value(Array{object({{"text", "transcript"}})})}})}})})}}));
  Value gemini_speech = Core::_gemini_normalize_speak_response(object({{"candidates", Value(Array{object({{"content", object({{"parts", Value(Array{object({{"inlineData", object({{"data", "audio-bytes"}})}})})}})}})})}}), object({{"format", "wav"}}));
  Value grok_transcribe = Core::_grok_build_transcribe_request(object({{"audio", "audio-bytes"}, {"language", "en"}, {"prompt", "names"}}));
  Value grok_speak = Core::_grok_build_speak_request(object({{"text", "speak"}, {"voice", object({{"id", "eve"}})}, {"format", "pcm16"}, {"sampleRate", 16000}}));
  Value registry = object({
      {"flags", object({{"skillsMode", true}})},
      {"protocol_actions", Value(Array{object({{"id", "respond"}})})},
      {"runtime_globals", Value(Array{object({{"id", "runtime"}})})},
      {"actor_primitives", Value(Array{object({{"id", "speak"}, {"effect", "fixture guidance"}, {"stages", Value(Array{"actor"})}, {"availability_condition", "always"}})})},
  });
  (void)Core::_validate_policy_reserved_names(registry, "fixtureCallable");
  Value guidance = Core::_render_actor_primitive_guidance(registry, "actor");
  Value policy_state = Value::object();
  (void)Core::_record_policy_event(policy_state, "respond", object({{"ok", true}}));
  Value policy_result = Core::_normalize_policy_action_result("respond", object({{"ok", true}}));
  Value descriptor = Core::_program_descriptor("fixture", "core", object({{"source", "verification"}}));
  Value merged = Core::_flow_merge_parallel_results(object({{"base", "keep"}}), object({{"answer", "ok"}}));
  Value gen_marker = Value::object();
  (void)Core::_set_examples(gen_marker, Value(Array{object({{"input", object({{"question", "q"}})}, {"output", object({{"answer", "a"}})}})}));
  (void)Core::_set_demos(gen_marker, Value(Array{object({{"traces", Value::array()}})}));
  Value constants = Core::mcp_protocol_constants();
  Value request = Core::mcp_jsonrpc_request("1", "ping", object({{"ok", true}}));
  Value notification = Core::mcp_jsonrpc_notification("progress", object({{"pct", 1}}));
  Value mcp_error = Core::mcp_normalize_error(object({{"jsonrpc", "2.0"}, {"id", "1"}, {"error", object({{"code", -32000}, {"message", "nope"}})}}));
  return object({
      {"promptVars", prompt_vars},
      {"chatModel", Core::get(chat_payload, "model", Value())},
      {"chatContent", Core::get(Core::get(Core::get(chat_response, "results", Value::array()), 0, Value::object()), "content", Value())},
      {"embedModel", Core::get(embed_payload, "model", Value())},
      {"embedCount", static_cast<int>(Core::iter(Core::get(embed_response, "embeddings", Value::array())).size())},
      {"streamContent", Core::get(Core::get(Core::get(stream_response, "results", Value::array()), 0, Value::object()), "content", Value())},
      {"toolName", Core::get(Core::get(tool_call, "function", Value::object()), "name", Value())},
      {"profileId", Core::get(profile, "id", Value())},
      {"geminiText", Core::get(gemini_transcript, "text", Value())},
      {"geminiAudio", Core::get(gemini_speech, "audio", Value())},
      {"grokCodec", Core::get(Core::get(grok_speak, "output_format", Value::object()), "codec", Value())},
      {"grokFormat", Core::get(grok_transcribe, "format", Value())},
      {"policyActions", static_cast<int>(Core::iter(Core::_select_protocol_actions(registry)).size())},
      {"runtimeGlobals", static_cast<int>(Core::iter(Core::_select_runtime_globals(registry)).size())},
      {"qualityScore", Core::_map_optimization_judge_quality_to_score("good")},
      {"policyTrace", static_cast<int>(Core::iter(Core::get(policy_state, "policy_trace", Value::array())).size())},
      {"policyEffectOnly", Core::get(policy_result, "effect_only", Value())},
      {"guidance", guidance},
      {"programKind", Core::get(descriptor, "kind", Value())},
      {"flowAnswer", Core::get(merged, "answer", Value())},
      {"mcpVersion", Core::get(constants, "protocolVersion", Value())},
      {"mcpRequest", Core::get(request, "method", Value())},
      {"mcpNotification", Core::get(notification, "method", Value())},
      {"mcpError", Core::get(mcp_error, "code", Value())},
      {"genExamples", static_cast<int>(Core::iter(Core::get(gen_marker, "examples", Value::array())).size())},
      {"genDemos", static_cast<int>(Core::iter(Core::get(gen_marker, "demos", Value::array())).size())},
  });
}

static void assert_agent_trace(AxAgent& ag, Value fixture);

// Prompt-parity gate (G3): build a real agent and assert the RLM stage instructions
// were rendered into agent state. A hollow agent has empty description keys, so this
// fails -- catching the defect that slipped a non-functional agent() past every gate.
static void run_agent_prompt(Value fixture) {
  // Read the RAW factory state (get_state() returns the curated runtime_state which omits
  // the rendered stage descriptions); the constructor builds state the same way.
  Value state = Core::_agent_factory(Core::get(fixture, "signature", "question:string -> answer:string"), Core::get(fixture, "options", Value::object()));
  Object st = as_object(state);
  Value expects = Core::get(fixture, "expected_description_contains", Value::object());
  for (const auto& kv : conf_entries(expects)) {
    if (kv.first == "__order") continue;
    auto it = st.find(kv.first);
    std::string desc = (it != st.end()) ? display(it->second) : "";
    if (desc.find_first_not_of(" \t\r\n") == std::string::npos) {
      throw AxError("fixture", "agent stage description " + kv.first + " is empty; RLM prompt was not rendered into agent state");
    }
    for (const auto& needle_val : Core::iter(kv.second)) {
      std::string needle = display(needle_val);
      if (desc.find(needle) == std::string::npos) {
        throw AxError("fixture", "agent stage description " + kv.first + " missing \"" + needle + "\": " + desc);
      }
    }
  }
}

static void run_agent_playbook_coverage(Value fixture) {
  for (const auto& test_case : Core::iter(Core::get(fixture, "cases", Value::array()))) {
    Value actual = Core::_agent_collect_covered_failure_signatures(Core::get(test_case, "snapshot", Value::object()));
    assert_equal(actual, Core::get(test_case, "expected_covered", Value::array()), "playbook coverage " + display(Core::get(test_case, "name", Value("case"))));
  }
}

static void run_agent_playbook_evolve(Value fixture) {
  Array source_responses = Core::iter(Core::get(fixture, "responses", Value::array()));
  Value scripted_response = source_responses.empty() ? Value::object() : source_responses.front();
  for (const auto& test_case : Core::iter(Core::get(fixture, "cases", Value::array()))) {
    Array responses;
    for (int i = 0; i < 32; ++i) responses.push_back(scripted_response);
    ConformanceScriptedAI client{Value(responses)};
    ScriptedCodeRuntime runtime(
        Core::get(fixture, "runtime_script", Value::array()),
        display(Core::get(fixture, "runtime_language", "Python")),
        "");
    Value agent_options = Core::get(fixture, "options", Value::object());
    Core::set(agent_options, "runtime", Core::code_runtime_ref(runtime));
    AxAgent ag(Core::get(fixture, "signature", "question:string -> answer:string"), agent_options);
    AxPlaybook& playbook = ag.playbook(client, object({
        {"target", "responder"}, {"maxEpochs", 1},
    }));
    Value seed = Core::get(fixture, "seed");
    if (!seed.is_null()) playbook.load(seed);
    std::string before = stringify(playbook.to_json());
    Value actual = playbook.evolve(
        Core::get(fixture, "dataset", Value::object()),
        Core::get(test_case, "options", Value::object()));
    Array outcomes = Core::iter(Core::get(actual, "outcomes", Value::array()));
    std::string label = "playbook evolve " + display(Core::get(test_case, "name", "case"));
    if (outcomes.empty()) throw AxError("fixture", label + " produced no outcome: " + stringify(actual));
    Value outcome = outcomes.front();
    Value expected = Core::get(test_case, "expected", Value::object());
    if (!Core::get(expected, "accepted").is_null()) assert_equal(Core::get(outcome, "accepted"), Core::get(expected, "accepted"), label + " accepted");
    if (!Core::get(expected, "metricCallsUsed").is_null()) assert_equal(Core::get(actual, "metricCallsUsed"), Core::get(expected, "metricCallsUsed"), label + " metric calls");
    if (!Core::get(expected, "heldIn").is_null()) assert_subset(Core::get(outcome, "heldIn", Value::object()), Core::get(expected, "heldIn"), label + " held-in");
    Value reason_contains = Core::get(expected, "reason_contains");
    if (!reason_contains.is_null() && display(Core::get(outcome, "reason", "")).find(display(reason_contains)) == std::string::npos) {
      throw AxError("fixture", label + " reason missing " + display(reason_contains) + ": " + stringify(outcome));
    }
    Value after_state = playbook.to_json();
    if (Core::truthy(Core::get(test_case, "expected_rollback", false))) assert_equal(stringify(after_state), before, label + " byte-exact rollback");
    if (!Core::get(test_case, "expected_exported_state_subset").is_null()) assert_subset(after_state, Core::get(test_case, "expected_exported_state_subset"), label + " exported state");
  }
}

static const std::array<std::string, 14> semantic_prompt_field_labels = {
    "Query",
    "Executor Request",
    "Distilled Context Summary",
    "Context Metadata",
    "Context Map",
    "Discovered Tool Docs",
    "Loaded Skills",
    "Memories",
    "Relevance Hints",
    "Summarized Actor Log",
    "Guidance Log",
    "Action Log",
    "Live Runtime State",
    "Context Pressure",
};

static std::string normalize_semantic_prompt_text(const std::string& text) {
  std::string unix_text;
  unix_text.reserve(text.size());
  for (char ch : text) {
    if (ch != '\r') unix_text.push_back(ch);
  }
  std::string normalized;
  size_t cursor = 0;
  while (cursor <= unix_text.size()) {
    size_t next = unix_text.find('\n', cursor);
    std::string line = unix_text.substr(cursor, next == std::string::npos ? std::string::npos : next - cursor);
    while (!line.empty() && (line.back() == ' ' || line.back() == '\t')) line.pop_back();
    if (!normalized.empty()) normalized += "\n";
    normalized += line;
    if (next == std::string::npos) break;
    cursor = next + 1;
  }
  size_t start = 0;
  while (start < normalized.size() && std::isspace(static_cast<unsigned char>(normalized[start]))) ++start;
  size_t end = normalized.size();
  while (end > start && std::isspace(static_cast<unsigned char>(normalized[end - 1]))) --end;
  return normalized.substr(start, end - start);
}

static std::string semantic_prompt_field(const std::string& user, const std::string& label) {
  std::string normalized = normalize_semantic_prompt_text(user);
  std::string marker = label + ": ";
  size_t start = normalized.find(marker);
  if (start == std::string::npos) return "";
  size_t body_start = start + marker.size();
  size_t end = normalized.size();
  for (const auto& candidate : semantic_prompt_field_labels) {
    if (candidate == label) continue;
    size_t next = normalized.find("\n\n" + candidate + ": ", body_start);
    if (next != std::string::npos && next < end) end = next;
  }
  return normalize_semantic_prompt_text(label + ": " + normalized.substr(body_start, end - body_start));
}

static std::string semantic_available_skills_index(const std::string& system) {
  std::string normalized = normalize_semantic_prompt_text(system);
  const std::string heading = "### Available Skills";
  size_t start = normalized.find(heading);
  if (start == std::string::npos) return "";
  std::vector<std::string> entries;
  size_t cursor = start + heading.size();
  while (cursor <= normalized.size()) {
    size_t next = normalized.find('\n', cursor);
    std::string line = normalized.substr(cursor, next == std::string::npos ? std::string::npos : next - cursor);
    if (line.empty() && entries.empty()) {
      // Skip the blank line between the heading and the first index item.
    } else if (line.rfind("- `", 0) == 0) {
      entries.push_back(line);
    } else {
      break;
    }
    if (next == std::string::npos) break;
    cursor = next + 1;
  }
  if (entries.empty()) return "";
  std::string out = heading + "\n\n";
  for (size_t index = 0; index < entries.size(); ++index) {
    if (index > 0) out += "\n";
    out += entries[index];
  }
  return out;
}

static void run_agent_forward(Value fixture) {
  ConformanceScriptedAI client(Core::get(fixture, "responses", Value::array()));
  client.transcribe_responses = as_array(Core::get(fixture, "transcribe_responses", Value::array()));
  Value agent_options = Core::get(fixture, "options", Value::object());
  Value semantic_observer_transcript = Value::array();
  bool semantic_observers_enabled = !Core::get(fixture, "expected_observer_transcript").is_null();
  auto install_semantic_observer = [&](Value& target, const std::string& key, const std::string& label, bool throws_error) {
    if (!semantic_observers_enabled || Core::get(target, key).is_null()) return;
    Core::set(target, key, register_agent_observer([&, label, throws_error](Value payload) {
      Core::append(semantic_observer_transcript, object({{"callback", label}, {"payload", payload}}));
      if (throws_error) throw std::runtime_error("semantic parity observer failure");
    }));
  };
  install_semantic_observer(agent_options, "onLoadedSkills", "loaded_skills", true);
  install_semantic_observer(agent_options, "onLoadedMemories", "loaded_memories", true);
  install_semantic_observer(agent_options, "onUsedSkills", "constructor.used_skills", false);
  install_semantic_observer(agent_options, "onUsedMemories", "constructor.used_memories", false);
  std::unique_ptr<ScriptedCodeRuntime> runtime;
  if (!Core::get(fixture, "runtime_script").is_null()) {
    Value runtime_config = Core::get(agent_options, "runtime", Value::object());
    runtime = std::make_unique<ScriptedCodeRuntime>(
        Core::get(fixture, "runtime_script", Value::array()),
        display(Core::get(runtime_config, "language", Core::get(fixture, "runtime_language", "JavaScript"))),
        display(Core::get(runtime_config, "usageInstructions", Core::get(runtime_config, "usage_instructions", ""))));
    Core::set(agent_options, "runtime", Core::code_runtime_ref(*runtime));
  }
#ifdef AX_CONFORMANCE_QUICKJS
  std::unique_ptr<axllm::runtime::quickjs::QuickJsCodeRuntime> real_runtime;
  if (!Core::get(fixture, "runtime_engine").is_null()) {
    real_runtime = std::make_unique<axllm::runtime::quickjs::QuickJsCodeRuntime>();
    Core::set(agent_options, "runtime", Core::code_runtime_ref(*real_runtime));
  }
#else
  if (!Core::get(fixture, "runtime_engine").is_null()) {
    throw AxError("fixture", "agent_runtime_real requires building conformance with -DAX_CONFORMANCE_QUICKJS and the quickjs runtime");
  }
#endif
  std::unique_ptr<AxAgent> ag;
  bool observer_called = false;
  Value run_state_projections = Value::array();
  Value saved_runtime_state;
  Value state_roundtrip_projection = Value::object();
  try {
    ag = std::make_unique<AxAgent>(Core::get(fixture, "signature"), agent_options);
    if (!Core::get(fixture, "set_instruction").is_null()) ag->set_instruction(Core::get(fixture, "set_instruction"));
    if (!Core::get(fixture, "add_actor_instruction").is_null()) ag->add_actor_instruction(Core::get(fixture, "add_actor_instruction"));
    if (Core::truthy(Core::get(fixture, "observer_throws", false))) {
      ag->set_citations_observer([&observer_called](Value) {
        observer_called = true;
        throw std::runtime_error("citation observer failed");
      });
    }
    if (!Core::get(fixture, "set_state").is_null()) ag->set_state(Core::get(fixture, "set_state"));
    if (!Core::get(fixture, "restore_runtime_state").is_null()) ag->restore_runtime_state(Core::get(fixture, "restore_runtime_state"));
    Value output;
    Value forward_runs = Core::get(fixture, "forward_runs");
    if (!forward_runs.is_null()) {
      output = Value::array();
      for (const auto& run : Core::iter(forward_runs)) {
        Value state_action = Core::get(run, "state_action", "");
        if (display(state_action) == "reset") {
          ag->restore_runtime_state(Value::object());
        } else if (display(state_action) == "restore_saved") {
          if (saved_runtime_state.is_null()) throw AxError("fixture", "restore_saved requires an earlier save_runtime_state run");
          Value restored = ag->restore_runtime_state(saved_runtime_state);
          Core::set(state_roundtrip_projection, "restored", object({
              {"loaded_skill_docs", Core::get(restored, "loaded_skill_docs", Value::array())},
          }));
        }
        Value forward_options = Core::get(run, "forward_options", Value::object());
        install_semantic_observer(forward_options, "onUsedSkills", "forward.used_skills", false);
        install_semantic_observer(forward_options, "onUsedMemories", "forward.used_memories", false);
        Core::append(output, ag->forward(client, Core::get(run, "input", Value::object()), forward_options));
        Value run_exported = ag->export_runtime_state();
        if (Core::truthy(Core::get(run, "save_runtime_state", false))) {
          saved_runtime_state = run_exported;
          Core::set(state_roundtrip_projection, "saved", object({
              {"loaded_skill_docs", Core::get(run_exported, "loaded_skill_docs", Value::array())},
          }));
        }
        Core::append(run_state_projections, object({
            {"loaded_skill_docs", Core::get(run_exported, "loaded_skill_docs", Value::array())},
            {"loaded_memories", Core::get(run_exported, "loaded_memories", Value::array())},
            {"used_skills", Core::get(run_exported, "used_skills", Value::array())},
            {"used_memories", Core::get(run_exported, "used_memories", Value::array())},
        }));
      }
    } else {
      Value forward_options = Core::get(fixture, "forward_options", Value::object());
      install_semantic_observer(forward_options, "onUsedSkills", "forward.used_skills", false);
      install_semantic_observer(forward_options, "onUsedMemories", "forward.used_memories", false);
      output = ag->forward(client, Core::get(fixture, "input", Value::object()), forward_options);
    }
    if (!Core::get(fixture, "expected_error_contains").is_null()) throw AxError("fixture", "expected agent forward to fail");
    if (!Core::get(fixture, "expected_output").is_null()) assert_equal(output, Core::get(fixture, "expected_output"), "agent output");
    if (!Core::get(fixture, "expected_run_state_projections").is_null()) assert_equal(run_state_projections, Core::get(fixture, "expected_run_state_projections"), "agent run state projections");
    if (!Core::get(fixture, "expected_state_roundtrip_projection").is_null()) assert_equal(state_roundtrip_projection, Core::get(fixture, "expected_state_roundtrip_projection"), "agent state roundtrip projection");
    if (!Core::get(fixture, "expected_observer_transcript").is_null()) assert_equal(semantic_observer_transcript, Core::get(fixture, "expected_observer_transcript"), "agent observer transcript");
    if (Core::truthy(Core::get(fixture, "observer_throws", false)) && !observer_called) throw AxError("fixture", "citation observer was not called");
  } catch (const AxError& error) {
    Value expected = Core::get(fixture, "expected_error_contains");
    if (expected.is_null()) throw;
    if (std::string(error.what()).find(display(expected)) == std::string::npos) throw AxError("fixture", std::string("expected error containing ") + display(expected) + ", got " + error.what());
    if (ag) assert_agent_trace(*ag, fixture);
    return;
  }
  Value expected_count = Core::get(fixture, "expected_request_count");
  if (!expected_count.is_null() && client.requests.size() != static_cast<size_t>(std::stoul(display(expected_count)))) {
    throw AxError("fixture", "expected agent request count mismatch");
  }
  Value exact_projection = Core::get(fixture, "exact_observable_projection", Value::object());
  if (!Core::get(exact_projection, "stateRoundtrip").is_null()) assert_equal(state_roundtrip_projection, Core::get(exact_projection, "stateRoundtrip"), "exact agent state roundtrip projection");
  if (!Core::get(exact_projection, "ranking").is_null()) {
    std::string executor_system;
    std::string executor_user;
    for (const auto& request : client.requests) {
      Value prompt = Core::get(request, "chat_prompt", Core::get(request, "chatPrompt", Value::array()));
      std::string system_text;
      std::string user_text;
      for (const auto& raw_message : Core::iter(prompt)) {
        std::string role = display(Core::get(raw_message, "role", ""));
        std::string content = display(Core::get(raw_message, "content", ""));
        if (role == "system") system_text += content + "\n";
        if (role == "user") user_text += content + "\n";
      }
      if (system_text.find("You (`executor`)") != std::string::npos) {
        executor_system = system_text;
        executor_user = user_text;
        break;
      }
    }
    Value matches = Value::object();
    for (const auto& probe : Core::iter(Core::get(fixture, "ranking_probe", Value::array()))) {
      std::string label = display(Core::get(probe, "label", ""));
      std::string needle = display(Core::get(probe, "needle", ""));
      Core::set(matches, label, executor_user.find(needle) != std::string::npos);
    }
    Value actual_ranking = object({
        {"hasLikelyRelevant", executor_system.find("Likely Relevant") != std::string::npos},
        {"matches", matches},
    });
    assert_equal(actual_ranking, Core::get(exact_projection, "ranking"), "exact agent ranking projection");
  }
  Value expected_stage_requests = Core::get(exact_projection, "stageRequests");
  if (!expected_stage_requests.is_null()) {
    Value actual_stage_requests = Value::array();
    for (const auto& request : client.requests) {
      Value prompt = Core::get(request, "chat_prompt", Core::get(request, "chatPrompt", Value::array()));
      std::string system_text;
      std::string user_text;
      for (const auto& raw_message : Core::iter(prompt)) {
        std::string role = display(Core::get(raw_message, "role", ""));
        Value raw_content = Core::get(raw_message, "content", "");
        std::string content = raw_content.is_string() ? display(raw_content) : stringify(raw_content);
        if (role == "system") system_text += content + "\n";
        if (role == "user") user_text += content + "\n";
      }
      std::string stage = system_text.find("You (`distiller`)") != std::string::npos ? "distiller"
          : system_text.find("You (`executor`)") != std::string::npos ? "executor" : "responder";
      Core::append(actual_stage_requests, object({
          {"stage", stage},
          {"availableSkills", semantic_available_skills_index(system_text)},
          {"loadedSkills", semantic_prompt_field(user_text, "Loaded Skills")},
          {"memories", semantic_prompt_field(user_text, "Memories")},
          {"relevanceHints", semantic_prompt_field(user_text, "Relevance Hints")},
      }));
    }
    assert_equal(actual_stage_requests, expected_stage_requests, "exact agent stage request projection");
  }
  Value expected_contains = Core::get(fixture, "expected_request_contains");
  if (!expected_contains.is_null()) {
    std::string request_text = stringify(Value(client.requests));
    for (const auto& item : Core::iter(expected_contains)) {
      if (request_text.find(display(item)) == std::string::npos) throw AxError("fixture", "agent request missing " + display(item) + ": " + request_text);
    }
  }
  Value expected_absent = Core::get(fixture, "expected_stage_request_not_contains");
  if (!expected_absent.is_null()) {
    for (const auto& raw : Core::iter(expected_absent)) {
      int index = static_cast<int>(std::stoul(display(Core::get(raw, "index", 0))));
      std::string text = index < static_cast<int>(client.requests.size()) ? stringify(client.requests[static_cast<size_t>(index)]) : "";
      for (const auto& item : Core::iter(Core::get(raw, "absent", Value::array()))) {
        if (text.find(display(item)) != std::string::npos) throw AxError("fixture", "agent request unexpectedly contained " + display(item));
      }
    }
  }
  Value expected_cached = Core::get(fixture, "expected_cached_request_indices");
  if (!expected_cached.is_null()) {
    for (const auto& raw_index : Core::iter(expected_cached)) {
      int index = static_cast<int>(std::stoul(display(raw_index)));
      if (index >= static_cast<int>(client.requests.size())) throw AxError("fixture", "missing cached request index " + std::to_string(index));
      bool has_cache = false;
      for (const auto& raw_message : Core::iter(Core::get(client.requests[static_cast<size_t>(index)], "chat_prompt", Value::array()))) {
        if (Core::truthy(Core::get(raw_message, "cache", false))) {
          has_cache = true;
          break;
        }
      }
      if (!has_cache) throw AxError("fixture", "agent request did not contain a cached prompt message");
    }
  }
  if (!Core::get(fixture, "expected_chat_log_subset").is_null()) assert_list_subset(ag->get_chat_log(), Core::get(fixture, "expected_chat_log_subset"), "agent chat log");
  if (!Core::get(fixture, "expected_state").is_null()) assert_subset(ag->get_state(), Core::get(fixture, "expected_state"), "agent state");
  Value exported = ag->export_runtime_state();
  if (!Core::get(fixture, "expected_runtime_contract_subset").is_null()) assert_subset(ag->get_runtime_contract(), Core::get(fixture, "expected_runtime_contract_subset"), "runtime contract");
  if (!Core::get(fixture, "expected_exported_state_subset").is_null()) assert_subset(exported, Core::get(fixture, "expected_exported_state_subset"), "runtime state");
  for (const auto& spec : std::vector<std::array<std::string, 3>>{
           {"expected_loaded_skill_docs", "loaded_skill_docs", "loaded skills exact"},
           {"expected_loaded_memories", "loaded_memories", "loaded memories exact"},
           {"expected_used_skills", "used_skills", "used skills exact"},
           {"expected_used_memories", "used_memories", "used memories exact"}}) {
    if (!Core::get(fixture, spec[0]).is_null()) assert_equal(Core::get(exported, spec[1], Value::array()), Core::get(fixture, spec[0]), spec[2]);
  }
  if (!Core::get(fixture, "expected_context_events_subset").is_null()) assert_list_subset(Core::get(exported, "context_events", Value::array()), Core::get(fixture, "expected_context_events_subset"), "agent context events");
  if (!Core::get(fixture, "expected_action_log_subset").is_null()) assert_list_subset(Core::get(exported, "action_log", Value::array()), Core::get(fixture, "expected_action_log_subset"), "action log");
  if (runtime && !Core::get(fixture, "expected_executed").is_null()) assert_equal(Value(runtime->executed), Core::get(fixture, "expected_executed"), "executed code");
  assert_agent_trace(*ag, fixture);
}

static void assert_agent_trace(AxAgent& ag, Value fixture) {
  Value trace = ag.export_trace();
  if (!Core::get(fixture, "expected_trace_subset").is_null()) assert_subset(trace, Core::get(fixture, "expected_trace_subset"), "agent trace");
  if (!Core::get(fixture, "expected_trace_event_kinds").is_null()) {
    Value kinds = Value::array();
    for (const auto& event : Core::iter(Core::get(trace, "events", Value::array()))) {
      Core::append(kinds, Core::get(event, "kind", ""));
    }
    assert_equal(kinds, Core::get(fixture, "expected_trace_event_kinds"), "agent trace event kinds");
  }
  if (Core::truthy(Core::get(fixture, "replay_trace", false))) {
    Value replay_fixtures = Core::get(fixture, "replay_fixtures", Value::object());
    if (!Core::get(fixture, "expected_trace_event_kinds").is_null() && Core::get(replay_fixtures, "expected_event_kinds").is_null()) {
      Core::set(replay_fixtures, "expected_event_kinds", Core::get(fixture, "expected_trace_event_kinds"));
    }
    if (!Core::get(fixture, "expected_output").is_null() && Core::get(replay_fixtures, "expected_output").is_null()) {
      Core::set(replay_fixtures, "expected_output", Core::get(fixture, "expected_output"));
    }
    Value replayed = ag.replay_trace(trace, replay_fixtures);
    if (!Core::get(fixture, "expected_replay_result_subset").is_null()) assert_subset(replayed, Core::get(fixture, "expected_replay_result_subset"), "agent replay");
    else assert_subset(replayed, object({{"ok", true}, {"status", "replayed"}}), "agent replay");
  }
}

static void run_agent_runtime_policy(Value fixture) {
  std::unique_ptr<AxAgent> ag;
  try {
    ag = std::make_unique<AxAgent>(Core::get(fixture, "signature", "question:string -> answer:string"), Core::get(fixture, "options", Value::object()));
    if (!Core::get(fixture, "set_signature").is_null()) ag->set_signature(Core::get(fixture, "set_signature"));
    if (!Core::get(fixture, "discover").is_null()) {
      Value result = ag->discover(Core::get(fixture, "discover", Value::object()));
      if (!Core::get(fixture, "expected_discover_result").is_null()) assert_equal(result, Core::get(fixture, "expected_discover_result"), "discover result");
    }
    if (!Core::get(fixture, "recall").is_null()) {
      Value result = ag->recall(Core::get(fixture, "recall", Value::array()));
      if (!Core::get(fixture, "expected_recall_result").is_null()) assert_equal(result, Core::get(fixture, "expected_recall_result"), "recall result");
    }
    if (!Core::get(fixture, "used").is_null()) {
      Value used = Core::get(fixture, "used");
      Value result = ag->used(Core::get(used, "id"), Core::get(used, "reason", ""), Core::get(used, "stage", "executor"));
      if (!Core::get(fixture, "expected_used_result").is_null()) assert_equal(result, Core::get(fixture, "expected_used_result"), "used result");
    }
    if (!Core::get(fixture, "invoke_callable").is_null()) {
      Value call = Core::get(fixture, "invoke_callable");
      Value result = ag->invoke_callable(Core::get(call, "qualified_name", Core::get(call, "name", "")), Core::get(call, "args", Value::object()));
      if (!Core::get(fixture, "expected_callable_result_subset").is_null()) assert_subset(result, Core::get(fixture, "expected_callable_result_subset"), "callable result");
    }
    if (!Core::get(fixture, "replay_trace_input").is_null()) {
      Value result = ag->replay_trace(Core::get(fixture, "replay_trace_input", Value::object()), Core::get(fixture, "replay_fixtures", Value::object()));
      if (!Core::get(fixture, "expected_replay_result_subset").is_null()) assert_subset(result, Core::get(fixture, "expected_replay_result_subset"), "agent replay");
    }
    if (!Core::get(fixture, "restore_runtime_state").is_null()) ag->restore_runtime_state(Core::get(fixture, "restore_runtime_state"));
    if (!Core::get(fixture, "context_operation").is_null()) {
      Value context_state = ag->export_runtime_state();
      Value result = Core::_agent_context_fixture_result(context_state, fixture);
      if (!Core::get(fixture, "expected_context_result").is_null()) assert_equal(result, Core::get(fixture, "expected_context_result"), "agent context result");
      if (!Core::get(fixture, "expected_context_result_subset").is_null()) assert_subset(result, Core::get(fixture, "expected_context_result_subset"), "agent context result");
      if (!Core::get(fixture, "expected_context_events_subset").is_null()) {
        Value exported_context = Core::get(result, "exported", Value::object());
        assert_list_subset(Core::get(exported_context, "context_events", Value::array()), Core::get(fixture, "expected_context_events_subset"), "agent context events");
      }
    }
    if (!Core::get(fixture, "final_payload").is_null()) assert_equal(Core::_normalize_agent_final_payload(Core::get(fixture, "final_payload")), Core::get(fixture, "expected_final_payload"), "final payload");
    if (!Core::get(fixture, "clarification_payload").is_null()) assert_equal(Core::_normalize_agent_clarification_payload(Core::get(fixture, "clarification_payload")), Core::get(fixture, "expected_clarification_payload"), "clarification payload");
  } catch (const AxError& error) {
    Value expected = Core::get(fixture, "expected_error_contains");
    if (expected.is_null()) throw;
    if (std::string(error.what()).find(display(expected)) == std::string::npos) throw AxError("fixture", std::string("expected error containing ") + display(expected) + ", got " + error.what());
    return;
  }
  if (!Core::get(fixture, "expected_error_contains").is_null()) throw AxError("fixture", "expected agent runtime policy fixture to fail");
  if (!Core::get(fixture, "expected_runtime_contract_subset").is_null()) assert_subset(ag->get_runtime_contract(), Core::get(fixture, "expected_runtime_contract_subset"), "runtime contract");
  if (!Core::get(fixture, "expected_policy_subset").is_null()) assert_subset(ag->get_policy(), Core::get(fixture, "expected_policy_subset"), "agent policy");
  if (!Core::get(fixture, "expected_policy_registry_subset").is_null()) assert_subset(ag->get_policy_registry(), Core::get(fixture, "expected_policy_registry_subset"), "policy registry");
  if (!Core::get(fixture, "expected_state_subset").is_null()) assert_subset(ag->get_state(), Core::get(fixture, "expected_state_subset"), "agent state");
  Value registry = ag->get_policy_registry();
  if (!Core::get(fixture, "expected_actor_primitives_subset").is_null()) assert_list_subset(Core::get(registry, "actor_primitives", Value::array()), Core::get(fixture, "expected_actor_primitives_subset"), "actor primitives");
  if (!Core::get(fixture, "expected_protocol_actions_subset").is_null()) assert_list_subset(Core::get(registry, "protocol_actions", Value::array()), Core::get(fixture, "expected_protocol_actions_subset"), "protocol actions");
  if (!Core::get(fixture, "expected_runtime_globals_subset").is_null()) assert_list_subset(Core::get(registry, "runtime_globals", Value::array()), Core::get(fixture, "expected_runtime_globals_subset"), "runtime globals");
  if (!Core::get(fixture, "expected_host_boundaries_subset").is_null()) assert_list_subset(Core::get(registry, "host_boundaries", Value::array()), Core::get(fixture, "expected_host_boundaries_subset"), "host boundaries");
  if (!Core::get(fixture, "expected_callable_inventory_subset").is_null()) assert_list_subset(ag->get_callable_inventory(), Core::get(fixture, "expected_callable_inventory_subset"), "callable inventory");
  if (!Core::get(fixture, "expected_discovery_catalog_subset").is_null()) assert_list_subset(ag->get_discovery_catalog(), Core::get(fixture, "expected_discovery_catalog_subset"), "discovery catalog");
  Value exported = ag->export_runtime_state();
  if (!Core::get(fixture, "expected_discovered_tool_docs_subset").is_null()) assert_list_subset(Core::get(exported, "discovered_tool_docs", Value::array()), Core::get(fixture, "expected_discovered_tool_docs_subset"), "discovered tools");
  if (!Core::get(fixture, "expected_loaded_skill_docs_subset").is_null()) assert_list_subset(Core::get(exported, "loaded_skill_docs", Value::array()), Core::get(fixture, "expected_loaded_skill_docs_subset"), "loaded skills");
  if (!Core::get(fixture, "expected_loaded_memories_subset").is_null()) assert_list_subset(Core::get(exported, "loaded_memories", Value::array()), Core::get(fixture, "expected_loaded_memories_subset"), "loaded memories");
  if (!Core::get(fixture, "expected_used_memories_subset").is_null()) assert_list_subset(Core::get(exported, "used_memories", Value::array()), Core::get(fixture, "expected_used_memories_subset"), "used memories");
  if (!Core::get(fixture, "expected_used_skills_subset").is_null()) assert_list_subset(Core::get(exported, "used_skills", Value::array()), Core::get(fixture, "expected_used_skills_subset"), "used skills");
  if (!Core::get(fixture, "expected_guidance_log_subset").is_null()) assert_list_subset(Core::get(exported, "guidance_log", Value::array()), Core::get(fixture, "expected_guidance_log_subset"), "guidance log");
  if (!Core::get(fixture, "expected_function_call_traces_subset").is_null()) assert_list_subset(Core::get(exported, "function_call_traces", Value::array()), Core::get(fixture, "expected_function_call_traces_subset"), "function call traces");
  if (!Core::get(fixture, "expected_policy_trace_subset").is_null()) assert_list_subset(Core::get(exported, "policy_trace", Value::array()), Core::get(fixture, "expected_policy_trace_subset"), "policy trace");
  if (!Core::get(fixture, "expected_exported_state_subset").is_null()) assert_subset(exported, Core::get(fixture, "expected_exported_state_subset"), "exported runtime state");
  if (!Core::get(fixture, "expected_optimizer_metadata_subset").is_null()) assert_subset(ag->get_optimizer_metadata(), Core::get(fixture, "expected_optimizer_metadata_subset"), "optimizer metadata");
  assert_agent_trace(*ag, fixture);
}

static void run_agent_runtime_session(Value fixture) {
  AxAgent ag(Core::get(fixture, "signature", "question:string -> answer:string"), Core::get(fixture, "options", Value::object()));
  ScriptedCodeRuntime runtime(Core::get(fixture, "runtime_script", Value::array()), "JavaScript", "", Core::get(fixture, "runtime_capabilities", Value::object()));
  Value result;
  bool caught_expected_error = false;
  try {
    std::string operation = display(Core::get(fixture, "operation", "test"));
    if (operation == "test") {
      result = ag.test(runtime, Core::get(fixture, "code", ""), Core::get(fixture, "context_values", Core::get(fixture, "input", Value::object())), Core::get(fixture, "runtime_options", Value::object()));
    } else if (operation == "steps") {
      for (const auto& raw_step : as_array(Core::get(fixture, "steps", Value::array()))) {
        Value step = raw_step;
        if (!Core::get(step, "restore_session_state").is_null()) ag.restore_session_state(Core::get(step, "restore_session_state"));
        result = ag.execute_actor_step(runtime, Core::get(step, "code", ""), Core::get(step, "values", Core::get(fixture, "context_values", Core::get(fixture, "input", Value::object()))), Core::get(step, "options", Value::object()));
        if (Core::truthy(Core::get(step, "inspect", false))) ag.inspect_runtime();
        if (Core::truthy(Core::get(step, "export_session_state", false))) ag.export_session_state();
      }
      if (Core::truthy(Core::get(fixture, "close_runtime_session", false))) ag.close_runtime_session();
    } else if (operation == "reserved") {
      result = ag.test(runtime, Core::get(fixture, "code", ""), Core::get(fixture, "context_values", Value::object()), Value::object());
    } else {
      throw AxError("fixture", "unknown agent runtime session operation " + operation);
    }
  } catch (const AxError& error) {
    Value expected = Core::get(fixture, "expected_error_contains");
    if (expected.is_null()) throw;
    if (std::string(error.what()).find(display(expected)) == std::string::npos) throw AxError("fixture", std::string("expected error containing ") + display(expected) + ", got " + error.what());
    caught_expected_error = true;
  }
  if (!Core::get(fixture, "expected_error_contains").is_null() && !caught_expected_error) throw AxError("fixture", "expected agent runtime session fixture to fail");
  if (!Core::get(fixture, "expected_result_subset").is_null()) assert_subset(result, Core::get(fixture, "expected_result_subset"), "runtime result");
  if (!Core::get(fixture, "expected_result").is_null()) assert_equal(result, Core::get(fixture, "expected_result"), "runtime result");
  Value exported = ag.export_runtime_state();
  if (!Core::get(fixture, "expected_exported_state_subset").is_null()) assert_subset(exported, Core::get(fixture, "expected_exported_state_subset"), "runtime state");
  if (!Core::get(fixture, "expected_action_log_subset").is_null()) assert_list_subset(Core::get(exported, "action_log", Value::array()), Core::get(fixture, "expected_action_log_subset"), "action log");
  if (!Core::get(fixture, "expected_status_log_subset").is_null()) assert_list_subset(Core::get(exported, "status_log", Value::array()), Core::get(fixture, "expected_status_log_subset"), "status log");
  if (!Core::get(fixture, "expected_session_count").is_null() && runtime.sessions.size() != static_cast<size_t>(std::stoi(display(Core::get(fixture, "expected_session_count"))))) {
    throw AxError("fixture", "expected session count mismatch");
  }
  if (!Core::get(fixture, "expected_closed_session_count").is_null()) {
    size_t closed_count = 0;
    for (const auto& session : runtime.sessions) if (session->closed) closed_count++;
    if (closed_count != static_cast<size_t>(std::stoi(display(Core::get(fixture, "expected_closed_session_count"))))) {
      throw AxError("fixture", "expected closed session count mismatch");
    }
  }
  if (!Core::get(fixture, "expected_executed").is_null()) assert_equal(Value(runtime.executed), Core::get(fixture, "expected_executed"), "executed code");
  if (!Core::get(fixture, "expected_create_globals_subset").is_null()) {
    if (runtime.create_requests.empty()) throw AxError("fixture", "expected at least one runtime create_session request");
    assert_subset(Core::get(runtime.create_requests.back(), "globals", Value::object()), Core::get(fixture, "expected_create_globals_subset"), "runtime create globals");
  }
  if (!Core::get(fixture, "expected_create_options_subset").is_null()) {
    if (runtime.create_requests.empty()) throw AxError("fixture", "expected at least one runtime create_session request");
    assert_subset(Core::get(runtime.create_requests.back(), "options", Value::object()), Core::get(fixture, "expected_create_options_subset"), "runtime create options");
  }
  if (!Core::get(fixture, "expected_execute_options_subset").is_null()) {
    if (runtime.execute_options.empty()) throw AxError("fixture", "expected at least one runtime execute request");
    assert_subset(runtime.execute_options.back(), Core::get(fixture, "expected_execute_options_subset"), "runtime execute options");
  }
  if (!Core::get(fixture, "expected_runtime_inspection").is_null()) assert_equal(Core::get(exported, "runtime_inspection", Value()), Core::get(fixture, "expected_runtime_inspection"), "runtime inspection");
  if (!Core::get(fixture, "expected_runtime_inspection_contains").is_null()) {
    std::string actual_inspection = display(Core::get(exported, "runtime_inspection", Value()));
    std::string expected_fragment = display(Core::get(fixture, "expected_runtime_inspection_contains"));
    if (actual_inspection.find(expected_fragment) == std::string::npos) throw AxError("fixture", "runtime inspection expected fragment missing");
  }
  if (!Core::get(fixture, "expected_absent_runtime_session_globals").is_null()) {
    Value globals = Core::get(Core::get(exported, "runtime_session_state", Value::object()), "globals", Value::object());
    for (const auto& key : as_array(Core::get(fixture, "expected_absent_runtime_session_globals", Value::array()))) {
      if (!Core::get(globals, display(key), Value()).is_null()) throw AxError("fixture", "runtime session globals unexpectedly contained " + display(key));
    }
  }
  assert_agent_trace(ag, fixture);
}

static Value runtime_adapter_call(Value spec) {
  std::string name = display(Core::get(spec, "name", ""));
  Value args = Core::get(spec, "args", Value::array());
  Value kwargs = Core::get(spec, "kwargs", Value::object());
  if (name == "result") return RuntimeEnvelope::result(Core::get(args, 0));
  if (name == "error") return RuntimeEnvelope::error(Core::get(args, 0, ""), Core::get(args, 1, Core::get(kwargs, "category", "runtime")));
  if (name == "session_closed") return RuntimeEnvelope::session_closed(Core::get(args, 0, "session closed"));
  if (name == "timeout") return RuntimeEnvelope::timeout(Core::get(args, 0, "execution timed out"));
  if (name == "final") return RuntimeEnvelope::final_payload(args);
  if (name == "ask_clarification") return RuntimeEnvelope::ask_clarification(args);
  if (name == "discover") return RuntimeEnvelope::discover(Core::get(args, 0, Value::object()));
  if (name == "recall") return RuntimeEnvelope::recall(Core::get(args, 0, Value::array()));
  if (name == "used") return RuntimeEnvelope::used(Core::get(args, 0, Value::object()), Core::get(kwargs, "reason"), Core::get(kwargs, "stage"));
  if (name == "status") return RuntimeEnvelope::status(Core::get(args, 0, "success"), Core::get(args, 1, ""));
  if (name == "guide_agent") return RuntimeEnvelope::guide_agent(Core::get(args, 0, ""), Core::get(args, 1));
  throw AxError("fixture", "unknown runtime adapter helper " + name);
}

static void run_agent_runtime_adapter(Value fixture) {
  if (!Core::get(fixture, "capabilities").is_null()) {
    Value raw = Core::get(fixture, "capabilities", Value::object());
    RuntimeCapabilities capabilities;
    capabilities.inspect = Core::truthy(Core::get(raw, "inspect", true));
    capabilities.snapshot = Core::truthy(Core::get(raw, "snapshot", true));
    capabilities.patch = Core::truthy(Core::get(raw, "patch", true));
    capabilities.abort = Core::truthy(Core::get(raw, "abort", false));
    capabilities.language = display(Core::get(raw, "language", "JavaScript"));
    capabilities.usage_instructions = display(Core::get(raw, "usage_instructions", ""));
    if (!Core::get(fixture, "expected_capabilities").is_null()) assert_subset(capabilities.to_value(), Core::get(fixture, "expected_capabilities"), "runtime capabilities");
  }
  for (const auto& raw_spec : Core::iter(Core::get(fixture, "helper_calls", Value::array()))) {
    Value spec = raw_spec;
    Value actual = runtime_adapter_call(spec);
    if (!Core::get(spec, "expected").is_null()) assert_equal(actual, Core::get(spec, "expected"), "runtime helper");
    if (!Core::get(spec, "expected_subset").is_null()) assert_subset(actual, Core::get(spec, "expected_subset"), "runtime helper");
    if (Core::truthy(Core::get(spec, "normalize", false))) {
      Value normalized = Core::_normalize_agent_runtime_step_result(actual, Core::get(spec, "code", "<adapter>"));
      if (!Core::get(spec, "expected_normalized_subset").is_null()) assert_subset(normalized, Core::get(spec, "expected_normalized_subset"), "normalized runtime helper");
    }
  }
  if (!Core::get(fixture, "run_session").is_null()) {
    Value session_fixture = Value::object();
    Core::set(session_fixture, "signature", Core::get(fixture, "signature", "question:string -> answer:string"));
    Core::set(session_fixture, "operation", "test");
    Core::set(session_fixture, "code", "adapter()");
    Core::set(session_fixture, "context_values", Core::get(fixture, "context_values", object({{"question", "adapter"}})));
    Core::set(session_fixture, "runtime_script", array({object({{"expected_code", "adapter()"}, {"result", runtime_adapter_call(Core::get(fixture, "run_session"))}})}));
    if (!Core::get(fixture, "expected_result_subset").is_null()) Core::set(session_fixture, "expected_result_subset", Core::get(fixture, "expected_result_subset"));
    if (!Core::get(fixture, "expected_action_log_subset").is_null()) Core::set(session_fixture, "expected_action_log_subset", Core::get(fixture, "expected_action_log_subset"));
    if (!Core::get(fixture, "expected_trace_event_kinds").is_null()) Core::set(session_fixture, "expected_trace_event_kinds", Core::get(fixture, "expected_trace_event_kinds"));
    if (!Core::get(fixture, "expected_closed_session_count").is_null()) Core::set(session_fixture, "expected_closed_session_count", Core::get(fixture, "expected_closed_session_count"));
    run_agent_runtime_session(session_fixture);
  }
}

struct ProtocolFixtureTransport : RuntimeTransport {
  std::string mode;
  int next_session = 0;
  Object sessions;

  explicit ProtocolFixtureTransport(Value fixture_mode) : mode(display(fixture_mode.is_null() ? Value("normal") : fixture_mode)) {}

  Value fail(Value id, const std::string& category, const std::string& message) {
    return object({{"id", std::move(id)}, {"ok", false}, {"error", object({{"category", category}, {"message", message}})}});
  }

  Value ok(Value id, Value result, Value session_id = Value()) {
    Value out = object({{"id", std::move(id)}, {"ok", true}, {"result", std::move(result)}});
    if (!session_id.is_null()) Core::set(out, "session_id", std::move(session_id));
    return out;
  }

  Value snapshot(Value session) {
    Value bindings = Core::get(session, "globals", Value::object());
    Value entry_list = Value::array();
    for (const auto& key : Core::iter(Core::map_keys(bindings))) {
      Core::append(entry_list, object({{"name", key}, {"type", "json"}, {"preview", display(Core::get(bindings, key))}}));
    }
    return object({{"version", 1}, {"entries", entry_list}, {"bindings", bindings}, {"globals", bindings}, {"closed", Core::get(session, "closed", false)}});
  }

  Value call(Value message) override {
    if (mode == "eof") throw AxError("runtime", "runtime protocol process closed without a response (exit code 0)");
    if (mode == "nonzero") throw AxError("runtime", "runtime protocol process closed without a response (exit code 7): fixture stderr before nonzero exit");
    if (mode == "malformed_json") return Value("not an object");
    Value id = mode == "id_mismatch" ? Value("mismatch") : Core::get(message, "id");
    std::string op = display(Core::get(message, "op"));
    if (op == "capabilities") {
      return ok(id, object({
        {"language", "JavaScript"},
        {"usage_instructions", "fixture protocol runtime"},
        {"inspect", mode != "unavailable"},
        {"snapshot", mode != "unavailable"},
        {"patch", mode != "unavailable"},
        {"abort", true}
      }));
    }
    if (op == "create_session") {
      std::string session_id = "s" + std::to_string(++next_session);
      Value payload = Core::get(message, "payload", Value::object());
      Value globals = Core::get(payload, "globals", Value::object());
      Core::set(globals, "__create_options", Core::get(payload, "options", Value::object()));
      sessions[session_id] = object({{"globals", globals}, {"closed", false}});
      return ok(id, object({{"session_id", session_id}}), session_id);
    }
    if (op == "execute") {
      std::string session_id = display(Core::get(message, "session_id"));
      Value session = sessions.count(session_id) ? sessions[session_id] : Value();
      if (session.is_null() || Core::truthy(Core::get(session, "closed", false))) return fail(Core::get(message, "id"), "session_closed", "session closed or unknown");
      Value payload = Core::get(message, "payload", Value::object());
      Value globals = Core::get(session, "globals", Value::object());
      Core::set(globals, "__last_execute_options", Core::get(payload, "options", Value::object()));
      Core::set(session, "globals", globals);
      sessions[session_id] = session;
      std::string code = display(Core::get(payload, "code", ""));
      if (code == "timeout()") return fail(Core::get(message, "id"), "timeout", "fixture timeout");
      if (code == "sessionClosed()") return fail(Core::get(message, "id"), "session_closed", "fixture session closed");
      if (code == "abort()") return fail(Core::get(message, "id"), "abort", "fixture abort");
      if (code == "userError()") return fail(Core::get(message, "id"), "user_error", "fixture user error");
      Core::set(globals, "answer", "fixture");
      Core::set(session, "globals", globals);
      sessions[session_id] = session;
      Value response = ok(id, object({{"type", "final"}, {"args", array({object({{"answer", "fixture"}})})}}), session_id);
      if (mode == "session_mismatch") Core::set(response, "session_id", "wrong-session");
      return response;
    }
    if (op == "inspect_globals") {
      if (mode == "unavailable") return fail(Core::get(message, "id"), "unavailable", "inspectGlobals unavailable");
      Value session_id = Core::get(message, "session_id");
      Value session = sessions.count(display(session_id)) ? sessions[display(session_id)] : Value::object();
      return ok(id, Core::get(session, "globals", Value::object()), session_id);
    }
    if (op == "snapshot_globals") {
      if (mode == "unavailable") return fail(Core::get(message, "id"), "unavailable", "snapshotGlobals unavailable");
      Value session_id = Core::get(message, "session_id");
      Value session = sessions.count(display(session_id)) ? sessions[display(session_id)] : Value::object();
      return ok(id, snapshot(session), session_id);
    }
    if (op == "patch_globals") {
      if (mode == "unavailable") return fail(Core::get(message, "id"), "unavailable", "patchGlobals unavailable");
      std::string session_id = display(Core::get(message, "session_id"));
      Value session = sessions.count(session_id) ? sessions[session_id] : Value::object();
      Value raw = Core::get(Core::get(message, "payload", Value::object()), "globals", Value::object());
      Value bindings = Core::get(raw, "bindings", raw);
      Core::set(session, "globals", bindings);
      sessions[session_id] = session;
      return ok(id, snapshot(session), Value(session_id));
    }
    if (op == "close") {
      std::string session_id = display(Core::get(message, "session_id"));
      Value session = sessions.count(session_id) ? sessions[session_id] : Value::object();
      Core::set(session, "closed", true);
      sessions[session_id] = session;
      return ok(id, object({{"closed", true}}), Value(session_id));
    }
    if (op == "shutdown") return ok(id, object({{"shutdown", true}}));
    return fail(Core::get(message, "id"), "protocol", "unknown runtime protocol op: " + op);
  }
};

static void run_agent_runtime_protocol(Value fixture) {
  ProtocolFixtureTransport transport(Core::get(fixture, "mode", "normal"));
  RuntimeProtocolClient runtime(transport);
  AxCodeSession* session = nullptr;
  try {
    std::string operation = display(Core::get(fixture, "operation", "roundtrip"));
    if (operation == "roundtrip") {
      Value capabilities = Core::get(runtime.request("capabilities", Value(), Value::object(), true), "result");
      if (!Core::get(fixture, "expected_capabilities_subset").is_null()) assert_subset(capabilities, Core::get(fixture, "expected_capabilities_subset"), "protocol capabilities");
      session = runtime.create_session(Core::get(fixture, "create_globals", Value::object()), Core::get(fixture, "create_options", Value::object()));
      Value result = session->execute(Core::get(fixture, "execute_code", "final()"), Core::get(fixture, "execute_options", Value::object()));
      if (!Core::get(fixture, "expected_execute_subset").is_null()) assert_subset(result, Core::get(fixture, "expected_execute_subset"), "protocol execute");
      Value inspected = session->inspect(Value::object());
      if (!Core::get(fixture, "expected_inspect_subset").is_null()) assert_subset(inspected, Core::get(fixture, "expected_inspect_subset"), "protocol inspect");
      Value snapshot = session->snapshot_globals(Value::object());
      if (!Core::get(fixture, "expected_snapshot_subset").is_null()) assert_subset(snapshot, Core::get(fixture, "expected_snapshot_subset"), "protocol snapshot");
      Value patched = session->patch_globals(Core::get(fixture, "patch_globals", Value::object()), Value::object());
      if (!Core::get(fixture, "expected_patch_subset").is_null()) assert_subset(patched, Core::get(fixture, "expected_patch_subset"), "protocol patch");
      Value closed = session->close();
      if (!Core::get(fixture, "expected_close_subset").is_null()) assert_subset(closed, Core::get(fixture, "expected_close_subset"), "protocol close");
      return;
    }
    if (operation == "execute_error") {
      session = runtime.create_session(Core::get(fixture, "create_globals", Value::object()), Core::get(fixture, "create_options", Value::object()));
      Value result = session->execute(Core::get(fixture, "execute_code", "timeout()"), Core::get(fixture, "execute_options", Value::object()));
      if (!Core::get(fixture, "expected_execute_subset").is_null()) assert_subset(result, Core::get(fixture, "expected_execute_subset"), "protocol execute error");
      return;
    }
    if (operation == "unknown_op") {
      runtime.request("unknown_op", Value(), Value::object(), true);
      throw AxError("fixture", "expected unknown protocol op to fail");
    }
    if (operation == "capabilities_error") {
      runtime.request("capabilities", Value(), Value::object(), true);
      throw AxError("fixture", "expected protocol capabilities request to fail");
    }
    if (operation == "unavailable") {
      session = runtime.create_session(Core::get(fixture, "create_globals", Value::object()), Core::get(fixture, "create_options", Value::object()));
      std::string method = display(Core::get(fixture, "method", "inspect_globals"));
      if (method == "snapshot_globals") session->snapshot_globals(Value::object());
      else if (method == "patch_globals") session->patch_globals(Value::object(), Value::object());
      else session->inspect(Value::object());
      throw AxError("fixture", "expected unavailable protocol method to fail");
    }
    if (operation == "session_mismatch") {
      session = runtime.create_session(Core::get(fixture, "create_globals", Value::object()), Core::get(fixture, "create_options", Value::object()));
      runtime.request("execute", "s1", object({{"code", Core::get(fixture, "execute_code", "final()")}, {"options", Value::object()}}), true);
      throw AxError("fixture", "expected protocol session mismatch to fail");
    }
    throw AxError("fixture", "unknown runtime protocol operation " + operation);
  } catch (const AxError& error) {
    Value expected = Core::get(fixture, "expected_error_contains");
    if (!expected.is_null() && std::string(error.what()).find(display(expected)) != std::string::npos) return;
    throw;
  }
}

struct ClientFixture {
  ScriptedTransport transport;
  std::unique_ptr<OpenAICompatibleClient> client;

  explicit ClientFixture(Value fixture)
      : transport(Core::get(fixture, "transport_responses", Core::get(fixture, "responses", Value::array()))),
        client(make_client(fixture, &transport)) {}

  static std::unique_ptr<OpenAICompatibleClient> make_client(Value fixture, ScriptedTransport* transport) {
    std::string provider = display(Core::provider_normalize_profile(Core::get(fixture, "provider", "openai-compatible")));
    if (provider == "google-gemini") return std::make_unique<GoogleGeminiClient>(options(fixture), transport);
    if (provider == "anthropic") return std::make_unique<AnthropicClient>(options(fixture), transport);
    if (provider == "openai-responses") return std::make_unique<OpenAIResponsesClient>(options(fixture), transport);
    if (provider == "azure-openai") return std::make_unique<AzureOpenAIClient>(options(fixture), transport);
    if (provider == "deepseek") return std::make_unique<DeepSeekClient>(options(fixture), transport);
    if (provider == "mistral") return std::make_unique<MistralClient>(options(fixture), transport);
    if (provider == "reka") return std::make_unique<RekaClient>(options(fixture), transport);
    if (provider == "cohere") return std::make_unique<CohereClient>(options(fixture), transport);
    if (provider == "grok") return std::make_unique<GrokClient>(options(fixture), transport);
    return std::make_unique<OpenAICompatibleClient>(options(fixture), transport);
  }

  static Value options(Value fixture) {
    Value out = Value::object();
    std::string provider = display(Core::provider_normalize_profile(Core::get(fixture, "provider", "openai-compatible")));
    bool responses_provider = provider == "openai-responses";
    bool gemini_provider = provider == "google-gemini";
    bool anthropic_provider = provider == "anthropic";
    bool azure_provider = provider == "azure-openai";
    bool deepseek_provider = provider == "deepseek";
    bool mistral_provider = provider == "mistral";
    bool reka_provider = provider == "reka";
    bool cohere_provider = provider == "cohere";
    bool grok_provider = provider == "grok";
    std::string default_model = anthropic_provider ? "claude-3-7-sonnet-latest" : gemini_provider ? "gemini-2.5-flash" : responses_provider ? "gpt-4o" : azure_provider ? "gpt-5-mini" : deepseek_provider ? "deepseek-v4-flash" : mistral_provider ? "mistral-small-latest" : reka_provider ? "reka-core" : cohere_provider ? "command-r-plus" : grok_provider ? "grok-4.3" : "gpt-4.1-mini";
    std::string default_embed_model = anthropic_provider || deepseek_provider || reka_provider || grok_provider ? "" : gemini_provider ? "gemini-embedding-2" : responses_provider ? "text-embedding-ada-002" : mistral_provider ? "mistral-embed" : cohere_provider ? "embed-english-v3.0" : "text-embedding-3-small";
    Core::set(out, "model", Core::get(fixture, "model", default_model));
    Core::set(out, "embed_model", Core::get(fixture, "embed_model", default_embed_model));
    Core::set(out, "api_key", "test-key");
    Core::set(out, "model_config", Core::get(fixture, "model_config", Value::object()));
    Core::set(out, "options", Core::get(fixture, "options", Value::object()));
    for (const std::string& key : {"base_url", "baseUrl", "resource_name", "resourceName", "deployment_name", "deploymentName", "api_version", "apiVersion", "version"}) {
      Value value = Core::get(fixture, key);
      if (!value.is_null()) Core::set(out, key, value);
    }
    return out;
  }
};

static bool json_path_exists(Value value, const std::string& path) {
  std::size_t start = 0;
  while (start <= path.size()) {
    const std::size_t dot = path.find('.', start);
    const std::string segment = path.substr(start, dot == std::string::npos ? std::string::npos : dot - start);
    if (!Core::truthy(Core::map_contains(value, Value(segment)))) return false;
    value = Core::get(value, segment);
    if (dot == std::string::npos) return true;
    start = dot + 1;
  }
  return true;
}

static void assert_transport(Value fixture, const ScriptedTransport& transport) {
  Value expected = Core::get(fixture, "expected_transport_request");
  Value expected_absent = Core::get(fixture, "expected_transport_json_absent");
  if (expected.is_null() && expected_absent.is_null()) return;
  if (transport.requests.empty()) throw AxError("fixture", "expected provider transport request but none were sent");
  if (!expected.is_null()) assert_subset(transport.requests[0], expected, "provider request");
  Value request_json = Core::get(transport.requests[0], "json", Value::object());
  for (const auto& raw_key : Core::iter(expected_absent)) {
    std::string key = display(raw_key);
    if (json_path_exists(request_json, key)) throw AxError("fixture", "provider request json unexpectedly contained " + key);
  }
}

static void assert_ai_error(const AxError& error, Value fixture, const ScriptedTransport& transport) {
  Value expected = Core::get(fixture, "expected_error_contains");
  if (!expected.is_null() && std::string(error.what()).find(display(expected)) == std::string::npos) {
    throw AxError("fixture", "expected error containing " + display(expected) + ", got " + error.what());
  }
  Value expected_type = Core::get(fixture, "expected_error_type");
  if (!expected_type.is_null() && error.type != display(expected_type)) {
    throw AxError("fixture", "expected error type " + display(expected_type) + ", got " + error.type);
  }
  Value expected_status = Core::get(fixture, "expected_status");
  if (!expected_status.is_null() && error.status != static_cast<int>(std::stoul(display(expected_status)))) {
    throw AxError("fixture", "expected status " + display(expected_status) + ", got " + std::to_string(error.status));
  }
  assert_transport(fixture, transport);
}

static void run_ai_chat(Value fixture) {
  ClientFixture cf(fixture);
  Value result = cf.client->chat(Core::get(fixture, "request", Value::object()));
  Value expected = Core::get(fixture, "expected_output");
  if (!expected.is_null()) assert_equal(result, expected, "ai chat output");
  assert_transport(fixture, cf.transport);
}

static void run_ai_embed(Value fixture) {
  ClientFixture cf(fixture);
  Value result = cf.client->embed(Core::get(fixture, "request", Value::object()));
  Value expected = Core::get(fixture, "expected_output");
  if (!expected.is_null()) assert_equal(result, expected, "ai embed output");
  assert_transport(fixture, cf.transport);
}

static void run_ai_stream(Value fixture) {
  ClientFixture cf(fixture);
  Value out = Value::array();
  for (const auto& item : cf.client->stream(Core::get(fixture, "request", Value::object()))) Core::append(out, item);
  Value expected = Core::get(fixture, "expected_output");
  if (!expected.is_null()) assert_equal(out, expected, "ai stream output");
  assert_transport(fixture, cf.transport);
}

static void run_ai_error(Value fixture) {
  ClientFixture cf(fixture);
  try {
    std::string method = display(Core::get(fixture, "method", "chat"));
    if (method == "stream") {
      for (const auto& ignored : cf.client->stream(Core::get(fixture, "request", Value::object()))) (void)ignored;
    } else if (method == "embed") {
      cf.client->embed(Core::get(fixture, "request", Value::object()));
    } else if (method == "transcribe") {
      cf.client->transcribe(Core::get(fixture, "request", Value::object()));
    } else if (method == "speak") {
      cf.client->speak(Core::get(fixture, "request", Value::object()));
    } else {
      cf.client->chat(Core::get(fixture, "request", Value::object()));
    }
  } catch (const AxError& error) {
    assert_ai_error(error, fixture, cf.transport);
    return;
  }
  throw AxError("fixture", "expected AxAI call to fail");
}

static void run_ai_unsupported(Value fixture) {
  ClientFixture cf(fixture);
  try {
    std::string method = display(Core::get(fixture, "method", "transcribe"));
    if (method == "speak") cf.client->speak(Core::get(fixture, "request", Value::object()));
    else cf.client->transcribe(Core::get(fixture, "request", Value::object()));
  } catch (const AxError& error) {
    Value expected = Core::get(fixture, "expected_error_contains");
    if (!expected.is_null() && std::string(error.what()).find(display(expected)) == std::string::npos) {
      throw AxError("fixture", "expected error containing " + display(expected) + ", got " + error.what());
    }
    return;
  }
  throw AxError("fixture", "expected unsupported capability error");
}

static void run_ai_provider_descriptor(Value fixture) {
  Value descriptor = Core::provider_descriptor(Core::get(fixture, "provider", "openai-compatible"));
  Value expected = Core::get(fixture, "expected_output");
  if (!expected.is_null()) assert_subset(descriptor, expected, "provider descriptor");
}

static void run_ai_provider_registry(Value fixture) {
  Value registry = Core::provider_profile_registry();
  Value expected = Core::get(fixture, "expected_output");
  if (!expected.is_null()) assert_subset(registry, expected, "provider profile registry");
  Value aliases = Core::get(fixture, "alias_expectations", Value::object());
  for (const auto& kv : as_object(aliases)) {
    if (kv.first == "__order") continue;
    assert_equal(Core::provider_normalize_profile(kv.first), kv.second, "provider alias " + kv.first);
  }
}

static void run_ai_model_catalog_audit(Value fixture) {
  Value summary = Core::provider_model_catalog_summary();
  Value expected = Core::get(fixture, "expected_output");
  if (!expected.is_null()) assert_subset(summary, expected, "provider model catalog audit");
}

static void run_ai_model_catalog_runtime(Value fixture) {
  Value type = Core::get(fixture, "model_type");
  Value result = type.is_null() ? get_supported_ai_models(Value::object()) : get_supported_ai_models(object({{"type", type}}));
  Value expected = Core::get(fixture, "expected_output");
  if (!expected.is_null()) {
    Value provider_names = Value::array();
    std::set<std::string> openai_types;
    int model_count = 0;
    Value openai_first;
    for (const auto& raw : as_array(result)) {
      Core::append(provider_names, Core::get(raw, "name"));
      Value models = Core::get(raw, "models", Value::array());
      model_count += static_cast<int>(as_array(models).size());
      if (display(Core::get(raw, "name")) == "openai") {
        if (!as_array(models).empty()) openai_first = Core::get(as_array(models).front(), "name");
        for (const auto& model : as_array(models)) openai_types.insert(display(Core::get(model, "type")));
      }
    }
    Value type_values = Value::array();
    for (const auto& item : openai_types) Core::append(type_values, item);
    Value actual = object({{"providerCount", static_cast<double>(as_array(result).size())}, {"providerNames", provider_names}, {"modelCount", model_count}, {"openaiFirstModel", openai_first}, {"openaiModelTypes", type_values}, {"catalog", result}});
    assert_subset(actual, expected, "provider model catalog runtime");
  }
}

static std::vector<std::shared_ptr<RouterFixtureService>> router_services(Value fixture) {
  std::vector<std::shared_ptr<RouterFixtureService>> services;
  for (const auto& spec : as_array(Core::get(fixture, "services", Value::array()))) {
    services.push_back(std::make_shared<RouterFixtureService>(spec));
  }
  return services;
}

static void run_ai_multiservice_router(Value fixture) {
  auto services = router_services(fixture);
  MultiServiceRouter router;
  bool use_vector_constructor = true;
  for (const auto& raw : as_array(Core::get(fixture, "router_entries", Value::array()))) {
    if (display(Core::get(raw, "kind", "")) == "key") use_vector_constructor = false;
  }
  try {
    if (use_vector_constructor) {
      std::vector<std::shared_ptr<AxAIService>> base;
      for (const auto& raw : as_array(Core::get(fixture, "router_entries", Value::array()))) {
        int index = static_cast<int>(conf_number(Core::get(raw, "service_index", 0)));
        base.push_back(services.at(index));
      }
      router = MultiServiceRouter(base);
    } else {
      for (const auto& raw : as_array(Core::get(fixture, "router_entries", Value::array()))) {
        int index = static_cast<int>(conf_number(Core::get(raw, "service_index", 0)));
        router.set_service_entry(display(Core::get(raw, "key")), services.at(index), display(Core::get(raw, "description", "")), Core::truthy(Core::get(raw, "isInternal", Core::get(raw, "is_internal", false))));
      }
    }
    Value outputs = Value::object();
    for (const auto& raw : as_array(Core::get(fixture, "operations", Value::array()))) {
      std::string name = display(Core::get(raw, "name"));
      Value request = Core::get(raw, "request", Value::object());
      Value options = Core::get(raw, "options", Value::object());
      if (name == "chat") Core::set(outputs, name, router.chat(request, options));
      else if (name == "embed") Core::set(outputs, name, router.embed(request, options));
      else if (name == "transcribe") Core::set(outputs, name, router.transcribe(request, options));
      else if (name == "speak") Core::set(outputs, name, router.speak(request, options));
      else if (name == "set_options") router.set_options(options);
    }
    Value service_calls = Value::array();
    for (const auto& service : services) {
      Value calls = Value::array();
      for (const auto& call : service->requests) Core::append(calls, call);
      if (!as_array(calls).empty()) Core::append(service_calls, calls);
    }
    Value actual = object({{"outputs", outputs}, {"lastChat", router.get_last_used_chat_model()}, {"lastEmbed", router.get_last_used_embed_model()}, {"lastConfig", router.get_last_used_model_config()}, {"metrics", router.get_metrics()}, {"options", router.get_options()}, {"serviceCalls", service_calls}});
    if (!Core::get(fixture, "expected_error_contains").is_null()) throw AxError("fixture", "expected multi-service router to fail");
    Value expected = Core::get(fixture, "expected_output");
    if (!Core::get(expected, "modelList").is_null()) Core::set(actual, "modelList", router.get_model_list());
    if (!expected.is_null()) assert_subset(actual, expected, "multi-service router");
  } catch (const AxError& error) {
    Value expected = Core::get(fixture, "expected_error_contains");
    if (expected.is_null()) throw;
    if (std::string(error.what()).find(display(expected)) == std::string::npos) throw AxError("fixture", "expected error containing " + display(expected) + ", got " + error.what());
  }
}

static void run_ai_provider_router(Value fixture) {
  auto services = router_services(fixture);
  std::vector<std::shared_ptr<AxAIService>> providers;
  if (!services.empty()) providers.push_back(services.at(static_cast<int>(conf_number(Core::get(fixture, "primary_index", 0)))));
  for (const auto& index : as_array(Core::get(fixture, "alternative_indices", Value::array()))) providers.push_back(services.at(static_cast<int>(conf_number(index))));
  Value routing = Core::get(Core::get(fixture, "routing", object({{"capability", object({{"requireExactMatch", false}, {"allowDegradation", true}})}})), "capability", Value::object());
  ProviderRouter router(providers, routing, Core::get(fixture, "processing", Value::object()));
  Value request = Core::get(fixture, "request", Value::object());
  Value rec = router.get_routing_recommendation(request);
  Value recommendation = object({{"provider", Core::get(rec, "providerName")}, {"processingApplied", Core::get(rec, "processingApplied")}, {"degradations", Core::get(rec, "degradations")}, {"warnings", Core::get(rec, "warnings")}});
  Value actual = object({{"recommendation", recommendation}, {"validation", router.validate_request(request)}, {"stats", router.get_routing_stats()}});
  Value expected = Core::get(fixture, "expected_output");
  if (!expected.is_null()) assert_subset(actual, expected, "provider router");
}

class ConformanceThrowingBalancerStatsStore final : public AxBalancerStatsStore {
 public:
  int gets = 0;
  int observes = 0;
  AxBalancerRouteStats get(const AxBalancerStatsKey&) override {
    ++gets;
    throw AxError("fixture", "fixture store read failed");
  }
  void observe(const AxBalancerStatsKey&, const AxBalancerStatsObservation&) override {
    ++observes;
    throw AxError("fixture", "fixture store write failed");
  }
};

static void run_ai_balancer(Value fixture) {
  auto services = router_services(fixture);
  std::vector<std::shared_ptr<AxAIService>> base;
  for (const auto& service : services) base.push_back(service);
  auto best_effort_store = std::make_shared<ConformanceThrowingBalancerStatsStore>();
  int best_effort_events = 0;
  try {
    AxBalancer balancer = [&]() {
      if (!Core::truthy(Core::get(fixture, "adaptive_best_effort", false))) return AxBalancer(base, Core::get(fixture, "options", Value::object()));
      Value raw = Core::get(Core::get(fixture, "options", Value::object()), "strategy", Value::object());
      auto strategy = std::make_shared<AxBalancerAdaptiveStrategy>();
      strategy->deadline_ms = conf_number(Core::get(raw, "deadlineMs", 1));
      strategy->bad_outcome_cost = conf_number(Core::get(raw, "badOutcomeCost", 0));
      strategy->name_space = display(Core::get(raw, "namespace", "default"));
      strategy->route_key = [](const std::shared_ptr<AxAIService>&, size_t) { return "best-effort-route"; };
      strategy->stats_store = best_effort_store;
      strategy->on_routing_event = [&](Value) { ++best_effort_events; throw std::runtime_error("fixture event hook failed"); };
      AxBalancerOptions options; options.strategy = strategy;
      return AxBalancer(base, options);
    }();
    Value outputs = Value::object();
    for (const auto& raw : Core::iter(Core::get(fixture, "operations", Value::array()))) {
      std::string name = display(Core::get(raw, "name"));
      Value request = Core::get(raw, "request", Value::object());
      Value options = Core::get(raw, "options", Value::object());
      if (name == "chat") Core::set(outputs, name, balancer.chat(request, options));
      else if (name == "stream") {
        Value deltas = Value::array();
        for (const auto& delta : balancer.stream(request)) Core::append(deltas, delta);
        Core::set(outputs, name, deltas);
      }
      else if (name == "embed") Core::set(outputs, name, balancer.embed(request, options));
      else if (name == "transcribe") Core::set(outputs, name, balancer.transcribe(request, options));
      else if (name == "speak") Core::set(outputs, name, balancer.speak(request, options));
      else if (name == "set_options") balancer.set_options(options);
      else if (name == "adaptive_stats") {
        Value stats = create_balancer_route_stats();
        for (const auto& observation : Core::iter(Core::get(raw, "observations", Value::array()))) stats = update_balancer_route_stats(stats, observation);
        std::vector<double> random_values; for (const auto& value : Core::iter(Core::get(raw, "random_values", Value::array()))) random_values.push_back(conf_number(value)); Core::set_math_random_values(std::move(random_values));
        Value health = sample_balancer_route_health(stats, conf_number(Core::get(raw, "deadline_ms", 1)));
        double score = conf_number(Core::provider_balancer_adaptive_score(conf_number(Core::get(raw, "estimated_cost", 0)), conf_number(Core::get(raw, "bad_outcome_cost", 0)), conf_number(Core::get(health, "failureProbability")), conf_number(Core::get(health, "deadlineMissProbability"))));
        auto round9 = [](double value) { return std::round(value * 1000000000.0) / 1000000000.0; };
        Core::set(outputs, name, object({
          {"stats", object({{"version", Core::get(stats, "version")}, {"observations", Core::get(stats, "observations")}, {"successes", Core::get(stats, "successes")}, {"failureEwma", round9(conf_number(Core::get(stats, "failureEwma")))}, {"logLatencyMean", round9(conf_number(Core::get(stats, "logLatencyMean")))}, {"logLatencyM2", round9(conf_number(Core::get(stats, "logLatencyM2")))}})},
          {"health", object({{"failureProbability", round9(conf_number(Core::get(health, "failureProbability")))}, {"deadlineMissProbability", round9(conf_number(Core::get(health, "deadlineMissProbability")))}})},
          {"score", round9(score)},
        }));
      }
      else if (name == "adaptive_store") {
        AxInMemoryBalancerStatsStore store;
        for (const auto& write : Core::iter(Core::get(raw, "writes", Value::array()))) {
          store.observe(Core::get(write, "key"), Core::get(write, "observation"));
        }
        Value states = Value::array();
        for (const auto& key : Core::iter(Core::get(raw, "reads", Value::array()))) Core::append(states, store.get(key));
        Core::set(outputs, name, object({{"states", states}}));
      }
    }
    Value service_calls = Value::array();
    for (const auto& service : services) {
      Value calls = Value::array();
      for (const auto& call : service->requests) Core::append(calls, call);
      if (!Core::iter(calls).empty()) Core::append(service_calls, calls);
    }
    Value actual = object({
        {"id", balancer.get_id()},
        {"name", balancer.get_name()},
        {"outputs", outputs},
        {"lastChat", balancer.get_last_used_chat_model()},
        {"lastEmbed", balancer.get_last_used_embed_model()},
        {"lastConfig", balancer.get_last_used_model_config()},
        {"metrics", balancer.get_metrics()},
        {"options", balancer.get_options()},
        {"serviceCalls", service_calls}
    });
    if (!Core::get(fixture, "expected_error_contains").is_null()) throw AxError("fixture", "expected balancer to fail");
    Value expected = Core::get(fixture, "expected_output");
    if (!Core::get(expected, "modelList").is_null()) Core::set(actual, "modelList", balancer.get_model_list());
    if (!Core::get(expected, "features").is_null()) Core::set(actual, "features", balancer.get_features());
    if (Core::truthy(Core::get(fixture, "adaptive_best_effort", false))) Core::set(actual, "bestEffort", object({{"storeGets", best_effort_store->gets}, {"storeObserves", best_effort_store->observes}, {"eventCalls", best_effort_events}}));
    if (!expected.is_null()) assert_subset(actual, expected, "balancer");
  } catch (const AxError& error) {
    Value expected = Core::get(fixture, "expected_error_contains");
    if (expected.is_null()) throw;
    if (std::string(error.what()).find(display(expected)) == std::string::npos) throw AxError("fixture", "expected error containing " + display(expected) + ", got " + error.what());
  }
}

static void run_ai_transcribe(Value fixture) {
  ClientFixture cf(fixture);
  Value result = cf.client->transcribe(Core::get(fixture, "request", Value::object()));
  Value expected = Core::get(fixture, "expected_output");
  if (!expected.is_null()) assert_equal(result, expected, "ai transcribe output");
  assert_transport(fixture, cf.transport);
}

static void run_ai_speak(Value fixture) {
  ClientFixture cf(fixture);
  Value result = cf.client->speak(Core::get(fixture, "request", Value::object()));
  Value expected = Core::get(fixture, "expected_output");
  if (!expected.is_null()) assert_equal(result, expected, "ai speak output");
  assert_transport(fixture, cf.transport);
}

static void run_ai_realtime(Value fixture) {
  ClientFixture cf(fixture);
  try {
    Value request = Core::get(fixture, "request", Value::object());
    Value expected_setup = Core::get(fixture, "expected_setup");
    if (!expected_setup.is_null()) assert_equal(cf.client->realtime_audio_setup(request), expected_setup, "ai realtime setup");
    Value expected_input = Core::get(fixture, "expected_input");
    if (!expected_input.is_null()) assert_equal(cf.client->realtime_audio_input(request), expected_input, "ai realtime input");
    Value out = Value::array();
    for (const auto& item : cf.client->realtime(Core::get(fixture, "events", Value::array()))) Core::append(out, item);
    if (!Core::get(fixture, "expected_error_contains").is_null()) throw AxError("fixture", "expected ai realtime fixture to fail");
    Value expected = Core::get(fixture, "expected_output");
    if (!expected.is_null()) assert_equal(out, expected, "ai realtime output");
  } catch (const AxError& error) {
    Value expected = Core::get(fixture, "expected_error_contains");
    if (expected.is_null()) throw;
    if (std::string(error.what()).find(display(expected)) == std::string::npos) throw AxError("fixture", "expected error containing " + display(expected) + ", got " + error.what());
  }
}

static Value flow_state_value(Value state, Value field, Value fallback = Value()) {
  if (field.is_null()) return fallback;
  Value cur = state;
  std::stringstream ss(display(field));
  std::string part;
  while (std::getline(ss, part, '.')) cur = Core::get(cur, part, fallback);
  return cur;
}

static Value flow_condition_from_spec(Value spec) {
  return flow_callback([spec](Value state) {
    std::string op = display(Core::get(spec, "op", Value("truthy")));
    if (op == "field") return flow_state_value(state, Core::get(spec, "field"), Core::get(spec, "default"));
    if (op == "lt") return Core::lt(flow_state_value(state, Core::get(spec, "field"), Value(0)), Core::get(spec, "value", Value(0)));
    if (op == "eq") return Core::eq(flow_state_value(state, Core::get(spec, "field")), Core::get(spec, "value"));
    if (op == "always") return Value(Core::truthy(Core::get(spec, "value", Value(true))));
    return Value(Core::truthy(flow_state_value(state, Core::get(spec, "field"))));
  });
}

static Value flow_mapper_from_spec(Value spec) {
  return flow_callback([spec](Value state) {
    Value out = Core::map_merge(Value::object(), state);
    std::string op = display(Core::get(spec, "op", Value("set")));
    if (op == "increment") {
      Value field = Core::get(spec, "field");
      Core::set(out, field, Core::add(flow_state_value(out, field, Value(0)), Core::get(spec, "by", Value(1))));
    } else if (op == "append") {
      Value field = Core::get(spec, "field");
      Value values = flow_state_value(out, field, Value::array());
      Core::append(values, Core::get(spec, "valueField").is_null() ? Core::get(spec, "value") : flow_state_value(out, Core::get(spec, "valueField")));
      Core::set(out, field, values);
    } else if (op == "copy") {
      Core::set(out, Core::get(spec, "to"), flow_state_value(out, Core::get(spec, "from")));
    } else if (op == "upper") {
      std::string s = display(flow_state_value(out, Core::get(spec, "from", Value("__item")), Value("")));
      for (auto& ch : s) { if (ch >= 'a' && ch <= 'z') ch = static_cast<char>(ch - 'a' + 'A'); }
      Core::set(out, Core::get(spec, "to", Value("__derived")), Value(s));
    } else {
      out = Core::map_update(out, Core::get(spec, "values", Value::object()));
    }
    return out;
  });
}

static Value build_flow_step(Value step, Value fixture, std::vector<std::unique_ptr<AxGen>>& programs, std::vector<std::unique_ptr<AxFlow>>& flows, std::vector<std::unique_ptr<AxAgent>>& agents) {
  std::string kind = display(Core::get(step, "kind", Value("execute")));
  std::string name = display(Core::get(step, "name"));
  Value options = Core::get(step, "options", Value::object());
  if (kind == "map" || kind == "derive") {
    Value mapper = Core::get(step, "mapper").is_null()
      ? flow_callback([output = Core::get(step, "output", Value::object())](Value) { return output; })
      : flow_mapper_from_spec(Core::get(step, "mapper"));
    return Core::_flow_step(Value(kind), Value(name), mapper, options);
  }
  if (kind == "branch") {
    Core::set(options, "predicate", flow_condition_from_spec(Core::get(step, "predicate", Core::get(options, "predicate", Value::object()))));
    Value branches = Value::array();
    for (const auto& raw_branch : Core::iter(Core::get(step, "branches", Core::get(options, "branches", Value::array())))) {
      Value branch_steps = Value::array();
      for (const auto& raw_child : Core::iter(Core::get(raw_branch, "steps", Value::array()))) {
        Core::append(branch_steps, build_flow_step(raw_child, fixture, programs, flows, agents));
      }
      Core::append(branches, object({{"when", Core::get(raw_branch, "when")}, {"steps", branch_steps}}));
    }
    Core::set(options, "branches", branches);
    return Core::_flow_step(Value("branch"), Value(name), Value(), options);
  }
  if (kind == "while" || kind == "feedback") {
    Core::set(options, "condition", flow_condition_from_spec(Core::get(step, "condition", Core::get(options, "condition", Value::object()))));
    Value body_steps = Value::array();
    for (const auto& raw_child : Core::iter(Core::get(step, "steps", Core::get(options, "steps", Value::array())))) {
      Core::append(body_steps, build_flow_step(raw_child, fixture, programs, flows, agents));
    }
    Core::set(options, "steps", body_steps);
    return Core::_flow_step(Value(kind), Value(name), Value(), options);
  }
  if (kind == "parallel" || kind == "parallelMerge") return Core::_flow_step(Value(kind), Value(name), Value(), options);
  Value step_options = Core::map_merge(Core::get(step, "forward_options", Value::object()), options);
  if (display(Core::get(step, "program", Value(""))) == "flow") {
    Value nested = object({
      {"flow_options", Core::get(step, "flow_options", object({{"id", Core::get(step, "program_id", Value("root." + name))}}))},
      {"steps", Core::get(step, "steps", Value::array())},
      {"returns", Core::get(step, "returns", Value::object())},
      {"signature", Core::get(step, "signature", Core::get(fixture, "signature", Value("question:string -> answer:string")))}
    });
    flows.push_back(std::make_unique<AxFlow>(build_flow(nested, programs, flows, agents)));
    return Core::_flow_step(Value(kind), Value(name), Core::agent_stage_ref(*flows.back()), step_options);
  }
  if (display(Core::get(step, "program", Value(""))) == "agent") {
    agents.push_back(std::make_unique<AxAgent>(
        Core::get(step, "signature", Core::get(fixture, "signature", Value("question:string -> answer:string"))),
        Core::get(step, "options", Value::object())));
    return Core::_flow_step(Value(kind), Value(name), Core::agent_stage_ref(*agents.back()), step_options);
  }
  Value signature = Core::get(step, "extended_signature", Core::get(step, "extendedSignature", Core::get(step, "signature", Core::get(fixture, "signature", Value("question:string -> answer:string")))));
  programs.push_back(std::make_unique<AxGen>(Core::parse_signature(signature), Core::get(step, "options", Value::object())));
  return Core::_flow_step(Value(kind), Value(name), Core::agent_stage_ref(*programs.back()), step_options);
}

static AxFlow build_flow(Value fixture, std::vector<std::unique_ptr<AxGen>>& programs, std::vector<std::unique_ptr<AxFlow>>& flows, std::vector<std::unique_ptr<AxAgent>>& agents) {
  Value flow_options = Core::get(fixture, "flow_options", object({{"id", Core::get(fixture, "program_id", Value("root.flow"))}}));
  AxFlow fl(flow_options);
  for (const auto& raw_step : Core::iter(Core::get(fixture, "steps", Value::array()))) {
    fl.add_raw_step(build_flow_step(raw_step, fixture, programs, flows, agents));
  }
  if (!Core::get(fixture, "returns").is_null()) fl.returns(Core::get(fixture, "returns", Value::object()));
  if (!Core::get(fixture, "demos").is_null()) fl.set_demos(Core::get(fixture, "demos", Value::object()));
  return fl;
}

static void run_program_contract(Value fixture) {
  std::vector<std::unique_ptr<AxGen>> programs;
  std::vector<std::unique_ptr<AxFlow>> flows;
  std::vector<std::unique_ptr<AxAgent>> agents;
  Value components;
  if (display(Core::get(fixture, "program", Value("axgen"))) == "flow") {
    AxFlow fl = build_flow(fixture, programs, flows, agents);
    components = fl.get_optimizable_components();
  } else {
    AxGen gen(Core::parse_signature(Core::get(fixture, "signature", Value("question:string -> answer:string"))), Core::get(fixture, "options", Value::object()));
    components = gen.get_optimizable_components();
  }
  if (!Core::get(fixture, "expected_component_ids").is_null()) {
    Value ids = Value::array();
    for (const auto& component : Core::iter(components)) Core::append(ids, Core::get(component, "id"));
    assert_equal(ids, Core::get(fixture, "expected_component_ids"), "program component ids");
  }
  if (!Core::get(fixture, "expected_components_subset").is_null()) assert_list_subset(components, Core::get(fixture, "expected_components_subset"), "program components");
}

static void run_flow(Value fixture) {
  try {
    std::vector<std::unique_ptr<AxGen>> programs;
    std::vector<std::unique_ptr<AxFlow>> flows;
    std::vector<std::unique_ptr<AxAgent>> agents;
    AxFlow fl = build_flow(fixture, programs, flows, agents);
    if (display(Core::get(fixture, "operation", Value(""))) == "cache_key") {
      std::set<std::string> keys;
      size_t count = 0;
      for (const auto& item : Core::iter(Core::get(fixture, "cache_key_inputs", Value::array()))) {
        keys.insert(display(Core::_flow_cache_key(item)));
        count++;
      }
      if (Core::truthy(Core::get(fixture, "expected_cache_keys_equal", Value(false))) && keys.size() != 1) throw AxError("fixture", "expected equal flow cache keys");
      if (Core::truthy(Core::get(fixture, "expected_cache_keys_distinct", Value(false))) && keys.size() != count) throw AxError("fixture", "expected distinct flow cache keys");
      return;
    }
    if (!Core::get(fixture, "expected_plan").is_null()) assert_equal(fl.get_plan(), Core::get(fixture, "expected_plan"), "flow plan");
    if (!Core::get(fixture, "expected_plan_subset").is_null()) assert_list_subset(fl.get_plan(), Core::get(fixture, "expected_plan_subset"), "flow plan");
    if (display(Core::get(fixture, "operation", Value(""))) == "plan") return;
    ConformanceScriptedAI client(Core::get(fixture, "responses", Value::array()));
    Value forward_options = Core::get(fixture, "forward_options", Value::object());
    if (!Core::get(fixture, "cache_seed_value").is_null()) {
      Value cache_store = Core::get(forward_options, "cache_store", Value::object());
      Core::set(cache_store, Core::_flow_cache_key(Core::get(fixture, "input", Value::object())), Core::get(fixture, "cache_seed_value"));
      Core::set(forward_options, "cache_store", cache_store);
    }
    Value output = display(Core::get(fixture, "operation", Value(""))) == "streaming"
      ? fl.streaming_forward(client, Core::get(fixture, "input", Value::object()), forward_options)
      : fl.forward(client, Core::get(fixture, "input", Value::object()), forward_options);
    if (!Core::get(fixture, "expected_output").is_null()) assert_equal(output, Core::get(fixture, "expected_output"), "flow output");
    if (!Core::get(fixture, "expected_streaming_output").is_null()) assert_equal(output, Core::get(fixture, "expected_streaming_output"), "flow streaming output");
    Value expected_count = Core::get(fixture, "expected_request_count");
    if (!expected_count.is_null() && client.requests.size() != static_cast<size_t>(std::stoul(display(expected_count)))) throw AxError("fixture", "expected request count mismatch");
    if (!Core::get(fixture, "expected_request_contains").is_null()) {
      std::string text = stringify(Value(client.requests));
      for (const auto& item : Core::iter(Core::get(fixture, "expected_request_contains"))) {
        if (text.find(display(item)) == std::string::npos) throw AxError("fixture", "flow request missing " + display(item) + ": " + text);
      }
    }
    if (!Core::get(fixture, "expected_chat_log_subset").is_null()) assert_list_subset(fl.get_chat_log(), Core::get(fixture, "expected_chat_log_subset"), "flow chat log");
    if (!Core::get(fixture, "expected_trace_kinds").is_null()) {
      Value kinds = Value::array();
      for (const auto& event : Core::iter(fl.get_traces())) Core::append(kinds, Core::get(event, "kind"));
      assert_equal(kinds, Core::get(fixture, "expected_trace_kinds"), "flow trace kinds");
    }
    if (!Core::get(fixture, "expected_trace_subset").is_null()) assert_list_subset(fl.get_traces(), Core::get(fixture, "expected_trace_subset"), "flow traces");
    if (!Core::get(fixture, "expected_usage_subset").is_null()) assert_subset(fl.get_usage(), Core::get(fixture, "expected_usage_subset"), "flow usage");
    if (!Core::get(fixture, "expected_cache_store_subset").is_null()) assert_subset(Core::get(forward_options, "cache_store", Core::get(forward_options, "cacheStore", Value::object())), Core::get(fixture, "expected_cache_store_subset"), "flow cache store");
    if (!Core::get(fixture, "expected_cache_value_for_input").is_null()) assert_equal(Core::get(Core::get(forward_options, "cache_store", Core::get(forward_options, "cacheStore", Value::object())), Core::_flow_cache_key(Core::get(fixture, "input", Value::object()))), Core::get(fixture, "expected_cache_value_for_input"), "flow cache value");
    if (!Core::get(fixture, "expected_components_subset").is_null()) assert_list_subset(fl.get_optimizable_components(), Core::get(fixture, "expected_components_subset"), "flow components");
    if (!Core::get(fixture, "expected_error_contains").is_null()) throw AxError("fixture", "expected flow fixture to fail");
  } catch (const AxError& e) {
    Value expected = Core::get(fixture, "expected_error_contains");
    if (!expected.is_null() && std::string(e.what()).find(display(expected)) != std::string::npos) return;
    throw;
  }
}

static void run_flow_mermaid(Value fixture) {
  std::string operation = display(Core::get(fixture, "operation", ""));
  Value conditions = Value::object();
  for (const auto& raw : Core::iter(Core::get(fixture, "condition_names", Value::array()))) {
    Core::set(conditions, display(raw), flow_callback([](Value) { return Value(false); }));
  }
  Value bindings = object({{"conditions", conditions}});
  if (operation == "error") {
    try {
      AxFlow ignored(display(Core::get(fixture, "document", "")), bindings);
    } catch (const std::exception& error) {
      std::string expected = display(Core::get(fixture, "expected_error_contains", ""));
      if (std::string(error.what()).find(expected) == std::string::npos) throw;
      return;
    }
    throw AxError("fixture", "expected mermaid compilation to fail");
  }
  if (operation == "builder_render") {
    AxFlow built;
    std::vector<std::unique_ptr<AxGen>> programs;
    for (const auto& raw : Core::iter(Core::get(fixture, "builder_steps", Value::array()))) {
      Value options = object({{"reads", Core::get(raw, "reads", Value::array())}});
      auto program = std::make_unique<AxGen>(s(display(Core::get(raw, "signature"))));
      built.execute(display(Core::get(raw, "name")), *program, options);
      programs.push_back(std::move(program));
    }
    assert_equal(built.str(), Core::get(fixture, "expected_rendered"), "flow mermaid builder render");
    return;
  }
  AxFlow first(display(Core::get(fixture, "document")), bindings);
  Value expected = Core::get(fixture, "expected_rerendered", Core::get(fixture, "expected_rendered"));
  assert_equal(first.str(), expected, "flow mermaid render");
  AxFlow second(first.str(), bindings);
  assert_equal(second.str(), expected, "flow mermaid canonical roundtrip");
}

static void run(Value fixture) {
  std::string kind = display(Core::get(fixture, "kind", "forward"));
  if (kind == "signature_error") {
    expect_maybe_error([&] { return build_signature(fixture); }, fixture);
  } else if (kind == "signature") {
    Value sig = build_signature(fixture);
    assert_equal(signature_payload(sig), Core::get(fixture, "expected_signature"), "signature");
    if (!Core::get(fixture, "expected_to_string").is_null()) {
      std::string rendered = axllm::to_string(sig);
      assert_equal(rendered, Core::get(fixture, "expected_to_string"), "signature toString");
      assert_equal(signature_payload(axllm::s(rendered)), Core::get(fixture, "expected_signature"), "signature round-trip");
    }
  } else if (kind == "json_schema") {
    Value sig = build_signature(fixture);
    Value fields = display(Core::get(fixture, "target", "outputs")) == "inputs" ? Core::get(sig, "inputs") : Core::get(sig, "outputs");
    assert_equal(Core::to_json_schema(fields, Core::get(fixture, "schema_title", "Schema"), Core::get(fixture, "schema_options", Value::object())), Core::get(fixture, "expected_schema"), "json schema");
  } else if (kind == "validate_value") {
    Value field = field_from_spec(Core::get(fixture, "field", Value::object()));
    Core::set(field, "name", Core::get(fixture, "field_name", "value"));
    field = Core::record_new("Field", field);
    expect_maybe_error([&] { return Core::validate_value(field, Core::get(fixture, "value"), Value()); }, fixture);
  } else if (kind == "validate_output") {
    Value sig = build_signature(fixture);
    Value result = expect_maybe_error([&] { return Core::validate_output(Core::get(sig, "outputs"), Core::get(fixture, "values", Value::object())); }, fixture);
    if (Core::get(fixture, "expected_error_contains").is_null()) assert_equal(result, Core::get(fixture, "expected_values", Core::get(fixture, "values", Value::object())), "validated output");
  } else if (kind == "strip_internal") {
    Value sig = build_signature(fixture);
    assert_equal(Core::strip_internal(Core::get(sig, "outputs"), Core::get(fixture, "values", Value::object())), Core::get(fixture, "expected_output"), "strip internal");
  } else if (kind == "template") {
    assert_equal(Core::render_template_content(Core::get(fixture, "template"), Core::get(fixture, "vars", Value::object()), Core::get(fixture, "context", "fixture-template")), Core::get(fixture, "expected_output", ""), "template");
  } else if (kind == "template_error") {
    expect_maybe_error([&] {
      if (display(Core::get(fixture, "operation")) == "validate") {
        Value result = Core::validate_prompt_template_syntax(Core::get(fixture, "template"), Core::get(fixture, "context", "fixture-template"), Core::get(fixture, "required_variables", Value::array()));
        if (!result.is_bool() || !Core::truthy(result)) throw AxError("template", display(result));
        return result;
      }
      return Core::render_template_content(Core::get(fixture, "template"), Core::get(fixture, "vars", Value::object()), Core::get(fixture, "context", "fixture-template"));
    }, fixture);
  } else if (kind == "template_validate") {
    assert_equal(Core::validate_prompt_template_syntax(Core::get(fixture, "template"), Core::get(fixture, "context", "fixture-template"), Core::get(fixture, "required_variables", Value::array())), Core::get(fixture, "expected_result", true), "template validation");
  } else if (kind == "prompt") {
    Value sig = build_signature(fixture);
    Value options = Core::get(fixture, "options", Value::object());
    if (!Core::get(options, "customTemplate").is_null()) Core::set(options, "custom_template", Core::get(options, "customTemplate"));
    if (!Core::get(options, "structuredOutputFunctionName").is_null()) Core::set(options, "structured_output_function_name", Core::get(options, "structuredOutputFunctionName"));
    Value messages = Core::render_prompt(sig, Core::get(fixture, "input", Core::get(fixture, "values", Value::object())), Core::get(fixture, "tools", Value::array()), options);
    if (!Core::get(fixture, "expected_messages").is_null()) assert_equal(messages, Core::get(fixture, "expected_messages"), "messages");
  } else if (kind == "stream") {
    run_stream(fixture);
  } else if (kind == "forward") {
    run_forward(fixture);
  } else if (kind == "agent_forward") {
    run_agent_forward(fixture);
  } else if (kind == "agent_playbook_coverage") {
    run_agent_playbook_coverage(fixture);
  } else if (kind == "agent_playbook_evolve") {
    run_agent_playbook_evolve(fixture);
  } else if (kind == "agent_prompt") {
    run_agent_prompt(fixture);
  } else if (kind == "agent_runtime_real") {
    run_agent_forward(fixture);
  } else if (kind == "agent_runtime_policy") {
    run_agent_runtime_policy(fixture);
  } else if (kind == "agent_runtime_session") {
    run_agent_runtime_session(fixture);
  } else if (kind == "agent_runtime_adapter") {
    run_agent_runtime_adapter(fixture);
  } else if (kind == "agent_runtime_protocol") {
    run_agent_runtime_protocol(fixture);
  } else if (kind == "program_contract") {
    run_program_contract(fixture);
  } else if (kind == "flow") {
    run_flow(fixture);
  } else if (kind == "flow_mermaid") {
    run_flow_mermaid(fixture);
  } else if (kind == "optimize") {
    run_optimize(fixture);
  } else if (kind == "mcp") {
    run_mcp_conformance_fixture(fixture);
  } else if (kind == "event") {
    auto operation=display(Core::get(fixture,"operation",""));
    if(operation=="routing")assert_equal(Core::event_route_commands(Core::get(fixture,"event"),Core::get(fixture,"routes"),Core::get(fixture,"identity_scope"),Core::get(fixture,"trust")),Core::get(fixture,"expected"),"event routing");
    else if(operation=="retry"){for(auto item:Core::iter(Core::get(fixture,"cases"))){assert_equal(Core::event_retry_transition(Core::get(item,"invocation_started"),Core::get(item,"retry_safety"),Core::get(item,"attempt"),Core::get(item,"max_attempts")),Core::get(item,"expected"),"event retry");}}
    else if(operation=="continuation"){auto key=Core::get(fixture,"correlation");auto actual=Core::event_continuation_match(Core::get(fixture,"continuations"),Core::get(fixture,"identity_scope"),Core::get(key,"kind"),Core::get(key,"value"),Core::get(fixture,"now"));assert_equal(Core::get(actual,"id"),Core::get(fixture,"expected_id"),"event continuation");}
    else if(operation=="mcp_normalization")assert_equal(Core::event_normalize_mcp(Core::get(fixture,"namespace"),Core::get(fixture,"method"),Core::get(fixture,"params")),Core::get(fixture,"expected"),"event MCP normalization");
    else if(operation=="mapping")assert_equal(Core::event_map_input(Core::get(fixture,"ingress"),Core::get(fixture,"plan"),Core::get(fixture,"signature_fields"),Value()),Core::get(fixture,"expected"),"event input mapping");
    else if(operation=="lifecycle"){
      auto route_value=Core::get(fixture,"route");auto event_value=Core::get(fixture,"event");
      AxEventRoute route{display(Core::get(route_value,"id")),display(Core::get(route_value,"action")),Core::get(route_value,"match"),display(Core::get(route_value,"targetId"))};
      auto source=std::make_shared<AxPushEventSource>("fixture");
      AxEventTarget target;target.id=route.targetId;target.invoke=[](Value input,const AxEventInvocationContext&){return object({{"handled",Core::get(input,"message")}});};
      AxEventRuntime runtime({route});runtime.register_target(std::move(target)).add_source(source).start();
      AxEventEnvelope event;event.id=display(Core::get(event_value,"id"));event.source=display(Core::get(event_value,"source"));event.type=display(Core::get(event_value,"type"));event.subject=display(Core::get(event_value,"subject",""));event.data=Core::get(event_value,"data");source->publish(event);
      auto receipt_event=event;receipt_event.id+="-receipt";auto receipt=runtime.publish(receipt_event,display(Core::get(fixture,"identity_scope")),display(Core::get(fixture,"trust")));
      auto run=runtime.get_run("run:"+route.id+":"+event.id+":1");if(!receipt.accepted||!run)throw AxError("fixture","event lifecycle did not dispatch");assert_equal(run->output,Core::get(fixture,"expected_output"),"event automatic dispatch");runtime.close();

      auto make_event=[](std::string id,std::string type,Value data){AxEventEnvelope value;value.id=std::move(id);value.source="test://axevent";value.type=std::move(type);value.data=std::move(data);return value;};
      int retry_calls=0;auto retry_clock=std::make_shared<AxManualEventClock>(1000);AxEventTarget retry_target;retry_target.id="retry-target";retry_target.retrySafety="idempotent";retry_target.invoke=[&](Value,const AxEventInvocationContext&){if(++retry_calls==1)throw std::runtime_error("retry once");return object({{"attempt",retry_calls}});};AxEventRuntime retry_runtime({AxEventRoute{"retry-route","wake",object({{"types",array({"event.retry"})}}),"retry-target"}});retry_runtime.clock(retry_clock).register_target(std::move(retry_target)).start();retry_runtime.publish(make_event("retry-1","event.retry",Value::object()));auto retry_run=retry_runtime.get_run("run:retry-route:retry-1:1");if(!retry_run||retry_run->attempt!=1||retry_run->status!="queued"||retry_runtime.next_due_at()!=2000)throw AxError("fixture","event delayed retry mismatch");retry_clock->advance(1000);retry_runtime.run_due();retry_run=retry_runtime.get_run("run:retry-route:retry-1:1");if(!retry_run||retry_run->attempt!=2||retry_run->status!="succeeded")throw AxError("fixture","event retry dispatch mismatch");

      std::vector<std::string> strict_calls;auto strict_clock=std::make_shared<AxManualEventClock>(1000);AxEventTarget strict_target;strict_target.id="strict-target";strict_target.retrySafety="idempotent";strict_target.invoke=[&](Value value,const AxEventInvocationContext&){auto name=display(Core::get(value,"name",""));strict_calls.push_back(name);if(name=="first"&&strict_calls.size()==1)throw std::runtime_error("retry first");return value;};AxEventRuntime strict_runtime({AxEventRoute{"strict-route","wake",object({{"types",array({"event.strict"})}}),"strict-target"}});strict_runtime.clock(strict_clock).register_target(std::move(strict_target)).start();strict_runtime.publish(make_event("strict-1","event.strict",object({{"name","first"}})));strict_runtime.publish(make_event("strict-2","event.strict",object({{"name","second"}})));if(strict_calls!=std::vector<std::string>{"first"})throw AxError("fixture","event strict ordering while retry waits mismatch");strict_clock->advance(1000);strict_runtime.run_due();if(strict_calls!=std::vector<std::string>({"first","first","second"}))throw AxError("fixture","event strict retry release ordering mismatch");

      auto debounce_clock=std::make_shared<AxManualEventClock>(2000);Value debounce_values=Value::array();AxEventTarget debounce_target;debounce_target.id="debounce-target";debounce_target.invoke=[&](Value value,const AxEventInvocationContext&){Core::append(debounce_values,value);return value;};AxEventRuntime debounce_runtime({AxEventRoute{"debounce-route","wake",object({{"types",array({"event.debounce"})}}),"debounce-target",false,"strict",250}});debounce_runtime.clock(debounce_clock).register_target(std::move(debounce_target)).start();debounce_runtime.publish(make_event("debounce-1","event.debounce",object({{"revision",1}})));debounce_runtime.publish(make_event("debounce-2","event.debounce",object({{"revision",2}})));if(!Core::iter(debounce_values).empty()||debounce_runtime.next_due_at()!=2250)throw AxError("fixture","event debounce scheduling mismatch");debounce_clock->advance(250);debounce_runtime.run_due();assert_equal(debounce_values,array({object({{"revision",2}})}),"event latest-value coalescing");

      bool capacity_rejected=false;try{AxEventRuntime capacity_runtime({AxEventRoute{"capacity-route","wake",object({{"types",array({"event.capacity"})}}),"capacity-target"}});capacity_runtime.limits(10000,64L*1024*1024,16).register_target(AxEventTarget{"capacity-target",[](Value value,const AxEventInvocationContext&){return value;}}).start();capacity_runtime.publish(make_event("capacity-1","event.capacity",object({{"payload","too-large"}})));}catch(const std::exception&){capacity_rejected=true;}if(!capacity_rejected)throw AxError("fixture","event envelope backpressure mismatch");

      int state=0;AxEventTarget state_target;state_target.id="state-target";state_target.retrySafety="idempotent";state_target.invoke=[&](Value,const AxEventInvocationContext&){return object({{"state",++state}});};state_target.captureState=[&](){return Value(state);};state_target.restoreState=[&](Value value){state=std::stoi(display(value));};AxEventRuntime state_runtime({AxEventRoute{"state-route","wake",object({{"types",array({"event.state"})}}),"state-target"}});state_runtime.register_target(std::move(state_target)).start();state_runtime.publish(make_event("state-1","event.state",Value::object()));state=0;state_runtime.publish(make_event("state-2","event.state",Value::object()));auto state_run=state_runtime.get_run("run:state-route:state-2:2");if(!state_run)throw AxError("fixture","event state restore did not dispatch");assert_equal(state_run->output,object({{"state",2}}),"event state restore");

      AxEventTarget cancel_target;cancel_target.id="cancel-target";cancel_target.invoke=[](Value,const AxEventInvocationContext& context){context.cancellation->cancel("fixture");return object({{"should","not persist"}});};AxEventRuntime cancel_runtime({AxEventRoute{"cancel-route","wake",object({{"types",array({"event.cancel"})}}),"cancel-target"}});cancel_runtime.register_target(std::move(cancel_target)).start();cancel_runtime.publish(make_event("cancel-1","event.cancel",Value::object()));auto cancel_run=cancel_runtime.get_run("run:cancel-route:cancel-1:1");if(!cancel_run||cancel_run->status!="cancelled"||!cancel_run->output.is_null())throw AxError("fixture","event cancellation mismatch");

      class FixtureSink final:public AxEventSink {public:int calls=0;void write(Value output,Value context)override{++calls;if(calls==1)throw std::runtime_error("sink once");if(display(Core::get(context,"runId","")).empty()||output.is_null())throw std::runtime_error("output not persisted before sink");}};auto sink=std::make_shared<FixtureSink>();int model_calls=0;AxEventTarget sink_target;sink_target.id="sink-target";sink_target.retrySafety="idempotent";sink_target.invoke=[&](Value value,const AxEventInvocationContext&){++model_calls;return value;};sink_target.sinks.push_back({"fixture-sink",sink});AxEventRuntime sink_runtime({AxEventRoute{"sink-route","wake",object({{"types",array({"event.sink"})}}),"sink-target"}});sink_runtime.register_target(std::move(sink_target)).start();sink_runtime.publish(make_event("sink-1","event.sink",object({{"ok",true}})));auto dead=sink_runtime.list_dead_letters();if(dead.empty())throw AxError("fixture","event sink dead letter missing");sink_runtime.redrive(dead.front().id);if(model_calls!=1||sink->calls!=2||!sink_runtime.list_dead_letters().empty())throw AxError("fixture","event sink-only redrive mismatch");

      int continuation_calls=0;AxEventTarget continuation_target;continuation_target.id="continuation-target";continuation_target.invoke=[&](Value value,const AxEventInvocationContext&){++continuation_calls;return value;};continuation_target.waitFor=array({object({{"kind","job"},{"value","job"}})});AxEventRuntime continuation_runtime({AxEventRoute{"continuation-wake","wake",object({{"types",array({"event.continuation.start"})}}),"continuation-target"},AxEventRoute{"continuation-resume","resume",object({{"types",array({"event.continuation.done"})}}),""}});continuation_runtime.register_target(std::move(continuation_target)).start();continuation_runtime.publish(make_event("continuation-1","event.continuation.start",object({{"job","job-1"}})),"tenant:test","authenticated");auto terminal=make_event("continuation-2","event.continuation.done",object({{"job","job-1"}}));terminal.correlation.push_back({"job","job-1"});continuation_runtime.publish(terminal,"tenant:test","authenticated");if(continuation_calls!=2)throw AxError("fixture","event continuation resume mismatch");

      auto mcp_transport=std::make_shared<AxMCPScriptedTransport>(array({object({{"method","initialize"},{"result",object({{"protocolVersion","2025-11-25"},{"capabilities",object({{"resources",object({{"subscribe",true}})}})}})}})}));auto mcp_client=std::make_shared<AxMCPClient>(mcp_transport,object({{"namespace","inventory"}}));int lifecycle_calls=0;mcp_client->add_lifecycle_listener([&](const std::string&){++lifecycle_calls;});int mcp_calls=0;auto mcp_source=std::make_shared<AxMCPEventSource>(mcp_client,"inventory","tenant:test","authenticated",std::vector<std::string>{"demo://inventory"});AxEventTarget mcp_target;mcp_target.id="mcp-target";mcp_target.invoke=[&](Value value,const AxEventInvocationContext&){++mcp_calls;return value;};AxEventRuntime mcp_runtime({AxEventRoute{"mcp-wake","wake",object({{"types",array({"mcp.resource.updated"})}}),"mcp-target",true}});mcp_runtime.register_target(std::move(mcp_target)).add_source(mcp_source).start();mcp_transport->emit(object({{"jsonrpc","2.0"},{"method","notifications/resources/updated"},{"params",object({{"uri","demo://inventory"}})}}));mcp_client->emit_lifecycle("reconnected");mcp_runtime.close();mcp_transport->emit(object({{"jsonrpc","2.0"},{"method","notifications/resources/updated"},{"params",object({{"uri","demo://inventory"}})}}));int subscribe_calls=0;for(const auto& request:mcp_transport->requests)if(display(Core::get(request,"method",""))=="resources/subscribe")++subscribe_calls;if(mcp_calls!=1||lifecycle_calls!=1||subscribe_calls!=2)throw AxError("fixture","MCP listener composition and resubscription mismatch");
      auto ownership=Core::mcp_resource_subscription_ownership(Value::array(),"source-a","acquire");ownership=Core::mcp_resource_subscription_ownership(Core::get(ownership,"owners",Value::array()),"source-b","acquire");ownership=Core::mcp_resource_subscription_ownership(Core::get(ownership,"owners",Value::array()),"source-a","release");assert_equal(ownership,object({{"owners",array({"source-b"})},{"wireAction","none"},{"changed",true}}),"MCP subscription ownership transition");
      auto selection_resources=array({object({{"uri","demo://b"}}),object({{"uri","demo://a"}}),object({{"uri","demo://b"}}),object({{"uri",""}})});assert_equal(array({Core::mcp_resource_subscription_selection(selection_resources,"all",Value::array()),Core::mcp_resource_subscription_selection(Value::array(),"explicit",array({"demo://x","demo://y","demo://x"})),Core::mcp_resource_subscription_selection(array({Core::get(selection_resources,1)}),"selector",Value::array())}),array({array({"demo://b","demo://a"}),array({"demo://x","demo://y"}),array({"demo://a"})}),"MCP subscription selection modes");
      Value mapped_inputs=Value::array();auto mapped_target=event_target("mapped-target").signature(signature("url:string, revision:number -> ok:boolean")).invoke([&](Value value,const AxEventInvocationContext&){Core::append(mapped_inputs,value);return value;}).wake_input([](AxEventInputBuilder& input){input.field("url",AxEventPath::data(array({"uri"}))).field("revision",AxEventPath::data(array({"revision"})));}).build();auto mapped_route=event_route("mapped-route").types(array({"event.mapped"})).instance_key(AxEventPath::data(array({"uri"}))).wake(mapped_target).build();AxEventRuntime mapped_runtime({mapped_route});mapped_runtime.register_target(mapped_target).start();mapped_runtime.publish(make_event("mapped-1","event.mapped",object({{"uri","demo://one"},{"revision",2}})));mapped_runtime.publish(make_event("mapped-2","event.mapped",object({{"uri","demo://two"},{"revision","bad"}})));assert_equal(mapped_inputs,array({object({{"url","demo://one"},{"revision",2}})}),"signature-aware event mapping input");if(mapped_runtime.list_dead_letters().size()!=1)throw AxError("fixture","signature-aware event mapping dead letter mismatch");
      Value callback_inputs=Value::array();auto callback_target=event_target("callback-target").signature(signature("url:string -> ok:boolean")).map_input([](const AxEventEnvelope& event,const AxEventContinuation*){return object({{"url",Core::get(event.data,"uri","")},{"secret","drop-me"}});}).invoke([&](Value value,const AxEventInvocationContext&){Core::append(callback_inputs,value);return value;}).build();AxEventRuntime callback_runtime({AxEventRoute{"callback-route","wake",object({{"types",array({"event.callback"})}}),"callback-target"}});callback_runtime.register_target(callback_target).start();callback_runtime.publish(make_event("callback-1","event.callback",object({{"uri","demo://callback"}})));assert_equal(callback_inputs,array({object({{"url","demo://callback"}})}),"event callback signature normalization");
    }
    else throw AxError("fixture","unsupported event operation "+operation);
  } else if (kind == "ai_chat") {
    run_ai_chat(fixture);
  } else if (kind == "ai_embed") {
    run_ai_embed(fixture);
  } else if (kind == "ai_stream") {
    run_ai_stream(fixture);
  } else if (kind == "ai_error") {
    run_ai_error(fixture);
  } else if (kind == "ai_unsupported") {
    run_ai_unsupported(fixture);
  } else if (kind == "ai_provider_descriptor") {
    run_ai_provider_descriptor(fixture);
  } else if (kind == "ai_provider_registry") {
    run_ai_provider_registry(fixture);
  } else if (kind == "ai_model_catalog_audit") {
    run_ai_model_catalog_audit(fixture);
  } else if (kind == "ai_model_catalog_runtime") {
    run_ai_model_catalog_runtime(fixture);
  } else if (kind == "ai_multiservice_router") {
    run_ai_multiservice_router(fixture);
  } else if (kind == "ai_provider_router") {
    run_ai_provider_router(fixture);
  } else if (kind == "ai_balancer") {
    run_ai_balancer(fixture);
  } else if (kind == "ai_transcribe") {
    run_ai_transcribe(fixture);
  } else if (kind == "ai_speak") {
    run_ai_speak(fixture);
  } else if (kind == "ai_realtime") {
    run_ai_realtime(fixture);
  } else {
    throw AxError("fixture", "unsupported C++ alpha fixture kind " + kind);
  }
}

int main(int argc, char** argv) {
  if (argc < 2) {
    std::cerr << "usage: axir-cpp-conformance <fixture-or-dir>...\n";
    return 2;
  }
  try {
    for (int i = 1; i < argc; ++i) {
      for (const auto& path : expand(argv[i])) {
        Value fixture = parse_json(read_file(path));
        run(fixture);
        std::cout << "ok " << display(Core::get(fixture, "name", path.filename().string())) << "\n";
      }
    }
  } catch (const std::exception& e) {
    std::cerr << e.what() << "\n";
    return 1;
  }
  return 0;
}
