#pragma once

#include <algorithm>
#include <chrono>
#include <cmath>
#include <thread>
#include <cctype>
#include <cstdlib>
#include <cstdint>
#include <filesystem>
#include <functional>
#include <iomanip>
#include <initializer_list>
#include <map>
#include <limits>
#include <memory>
#include <mutex>
#include <regex>
#include <set>
#include <sstream>
#include <stdexcept>
#include <string>
#include <utility>
#include <variant>
#include <vector>

namespace axllm {

struct Value;
using Array = std::vector<Value>;
using Object = std::map<std::string, Value>;
class AIClient;
class Transport;
class Tool;
class AxMemory;
class AxProgram;
class AxGen;
class AxAgent;
class AxFlow;
class AxCodeRuntime;
class AxCodeSession;
class RuntimeProtocolClient;
class RuntimeProtocolSession;
class RuntimeTransport;
class AxAIService;
class OpenAICompatibleClient;
class OpenAIResponsesClient;
class GoogleGeminiClient;
class AnthropicClient;
class AxBootstrapFewShot;
class AxGEPA;
class OptimizerEngine;
class OptimizerEvaluator;

struct Value {
  std::variant<std::nullptr_t, bool, double, std::string, std::shared_ptr<Array>, std::shared_ptr<Object>> data;
  Value();
  Value(std::nullptr_t);
  Value(bool value);
  Value(int value);
  Value(long value);
  Value(double value);
  Value(const char* value);
  Value(std::string value);
  Value(Array value);
  Value(Object value);
  static Value array();
  static Value object();
  bool is_null() const;
  bool is_bool() const;
  bool is_number() const;
  bool is_string() const;
  bool is_array() const;
  bool is_object() const;
};

class AxError : public std::runtime_error {
 public:
  std::string category;
  std::string type;
  int status;
  std::string code;
  bool retryable;
  AxError(std::string category, std::string message);
  AxError(std::string category, std::string message, std::string type, int status = 0,
          std::string code = "", bool retryable = false);
};

struct Core {
  static bool truthy(const Value& value);
  static Value truthy_value(Value value);
  static Value not_(Value value);
  static Value and_(Value left, Value right);
  static Value or_(Value left, Value right);
  static Value eq(Value left, Value right);
  static Value ne(Value left, Value right);
  static Value lt(Value left, Value right);
  static Value lte(Value left, Value right);
  static Value gt(Value left, Value right);
  static Value gte(Value left, Value right);
  static Value add(Value left, Value right);
  static Value mul(Value left, Value right);
  static Value div(Value left, Value right);
  static Value math_abs(Value value);
  static Value math_log(Value value);
  static Value math_exp(Value value);
  static Value math_sqrt(Value value);
  static Value math_cos(Value value);
  static Value math_pow(Value left, Value right);
  static Value math_random();
  static void set_math_random_values(std::vector<double> values);
  static double number(Value value);
  static Value contains(Value container, Value item);
  static Value len(Value value);
  static Value is_none(Value value);
  static Value is_not_none(Value value);
  static Value none();
  static Value coalesce(Value value, Value fallback);
  static Value map_merge(Value left, Value right);
  static Value get(Value target, Value key, Value default_value = Value());
  static void set(Value& target, Value key, Value value);
  static void append(Value& target, Value value);
  static Array iter(Value value);
  static Value map_contains(Value values, Value key);
  static Value map_get(Value values, Value key);
  static Value map_delete(Value values, Value key);
  static Value map_update(Value target, Value values);
  static Value map_keys(Value values);
  static Value map_values(Value values);
  static Value list_get(Value values, Value index, Value default_value);
  static Value type_is(Value value, Value type_name);
  static Value regex_match(Value pattern, Value value);
  static Value string_trim(Value value);
  static Value string_join(Value sep, Value values);
  static Value string_lower(Value value);
  static Value string_lower_camel(Value values);
  static Value string_title_from_camel(Value value);
  static Value string_ends_with(Value value, Value suffix);
  static Value string_starts_with(Value value, Value prefix);
  static Value string_replace(Value value, Value old_value, Value new_value);
  static Value string_slice(Value value, Value start, Value end = Value());
  static Value string_remove_suffix(Value value, Value suffix);
  static Value string_words(Value value);
  static Value string_default_if_empty(Value value, Value fallback);
  static Value string_format(Value templ, Value a = Value(), Value b = Value(), Value c = Value());
  static Value string_split(Value value, Value sep);
  static Value string_split_once(Value value, Value sep);
  static Value string_split_trim_nonempty(Value value, Value sep);
  static Value string_find_outside_quotes(Value text, Value needle);
  static Value string_split_outside_quotes(Value text, Value sep);
  static Value string_split_top_level(Value text, Value sep);
  static Value string_extract_leading_group(Value text, Value open, Value close);
  static Value string_consume_optional_quoted_prefix(Value text);
  static Value string_extract_quoted_suffix(Value text);
  static Value string_str(Value value);
  static Value regex_replace(Value pattern, Value repl, Value value);
  static Value sorted_strings(Value values);
  static Value json_parse(Value value);
  static Value json_stringify(Value value);
  static Value json_stable_stringify(Value value);
  static Value json_pretty(Value value);
  static Value signature_error(Value message);
  static Value validation_error(Value message);
  static Value runtime_error(Value message);
  static Value ai_error_response(Value message, Value response_body = Value());
  static Value ai_error_refusal(Value message, Value response_body);
  static Value ai_error_stream(Value message, Value response_body, Value retryable);
  static Value ai_error_unsupported(Value message);
  static Value ai_error_auth(Value message, Value status, Value code, Value response_body, Value request);
  static Value ai_error_timeout(Value message, Value status, Value code, Value response_body, Value request, Value retryable);
  static Value ai_error_status(Value message, Value status, Value code, Value response_body, Value request, Value retryable);
  static Value exception_value(const std::exception& error);
  static Value exception_message(Value error);
  static AxError as_error(Value error);
  static Value coerce_chat_request(Value request);
  static Value client_ref(AIClient& client);
  static Value agent_stage_ref(AxProgram& stage);
  static Value code_runtime_ref(AxCodeRuntime& runtime);
  static Value object_call_method(Value target, Value method_name, Value arg = Value());
  static Value program_components(Value program);
  static Value program_apply_components(Value program, Value component_map);
  static Value ai_complete_once(Value client, Value request);
  static Value retry_sleep(Value attempt);
  static Value tool_invoke(Value fn, Value params);
  static Value legacy_response_to_chat_response(Value raw);
  static Value record_new(Value name, Value values);
  static Value field_item(Value field);
  static Value fields_from_map(Value fields);
  static Value description_append(Value base, Value hint);
  static Value url_valid(Value value);
  static Value valid_image(Value value);
  static Value valid_audio(Value value);
  static Value valid_file(Value value);
  static Value valid_url_shape(Value value);
  static Value template_parse(Value source, Value context);
  static Value template_render_tree(Value nodes, Value vars, Value source, Value context);
  static Value template_collect_vars(Value nodes);
  static Value template_validate(Value source, Value context, Value required);
  static Value prompt_structured(Value signature, Value values, Value functions, Value options);
  static Value prompt_user_content(Value signature, Value values);
  static Value axgen_render_examples(Value gen);
  static Value axgen_render_demos(Value gen);
  static Value axgen_apply_field_processors(Value gen, Value output);
  static Value axgen_run_assertions(Value gen, Value output);
  static Value axgen_record_trace(Value gen, Value input, Value output, Value status);
  static Value axgen_should_continue_steps(Value gen, Value calls);
  static Value axgen_apply_context_cache(Value gen, Value messages, Value options);
  static Value axgen_memory_add_request(Value gen, Value messages);
  static Value axgen_memory_add_response(Value gen, Value request, Value response);
  static Value axgen_memory_add_function_result(Value gen, Value call, Value result, Value ok);
  static Value axgen_memory_add_correction(Value gen, Value response, Value error);
  static Value axgen_memory_cleanup_corrections(Value gen);
  static Value axgen_record_chat_log(Value gen, Value request, Value response);
  static Value axgen_record_function_call(Value gen, Value call, Value result, Value status);
  static Value agent_stage_forward(Value stage, Value client, Value values, Value options);
  static Value agent_stage_chat_log(Value stage);
  static Value agent_stage_usage(Value stage);
  static Value agent_stage_traces(Value stage);
  static Value agent_clarification_error(Value payload, Value state);
  static Value agent_runtime_create_session(Value runtime, Value globals, Value options);
  static Value agent_runtime_execute(Value session, Value code, Value options);
  static Value agent_runtime_inspect(Value session, Value options);
  static Value agent_runtime_export_state(Value session, Value options);
  static Value agent_runtime_restore_state(Value session, Value snapshot, Value options);
  static Value agent_runtime_close(Value session);
  static Value agent_memory_search(Value state, Value searches, Value already_loaded);
  static Value agent_skill_search(Value state, Value searches);
  static Value agent_observer_notify(Value state, Value forward_options, Value kind, Value payload);
  static Value agent_transcribe(Value client, Value request, Value options);
  static Value agent_callable_invoke(Value state, Value request, Value options);
  static Value stream_event_content_parts(Value event);
  static Value openai_normalize_chat_response(Value raw);
  static Value openai_normalize_stream_delta(Value raw, Value state);
  static Value openai_normalize_embed_response(Value raw);
  // AXIR_CORE_CPP_DECLARATIONS

};

class AIClient {
 public:
  virtual ~AIClient() = default;
  virtual Value complete(Value request) = 0;
  virtual Value chat(Value request);
  // Default so intrinsic.agent.transcribe can call transcribe through an AIClient* (the agent's
  // scripted client extends the base AIClient). AxAIService and the scripted client override it.
  virtual Value transcribe(Value request, Value options) {
    (void)request;
    (void)options;
    return Value::object();
  }
};

class AxAIService : public AIClient {
 public:
  ~AxAIService() override = default;
  virtual std::string get_id();
  virtual std::string get_name();
  Value chat(Value request) override;
  virtual Value chat(Value request, Value options);
  virtual std::vector<Value> stream(Value request);
  virtual Value embed(Value request, Value options);
  virtual Value embed(Value request) = 0;
  virtual Value transcribe(Value request) = 0;
  virtual Value transcribe(Value request, Value options);
  virtual Value speak(Value request) = 0;
  virtual Value speak(Value request, Value options);
  virtual Value get_features(Value model = Value());
  virtual Value get_model_list();
  virtual Value get_metrics();
  virtual std::function<void(std::string)> get_logger();
  virtual double get_estimated_cost(Value model_usage);
  virtual Value get_options();
  virtual void set_options(Value options);
  virtual Value get_last_used_chat_model();
  virtual Value get_last_used_embed_model();
  virtual Value get_last_used_model_config();
};

class AxBaseAI : public AxAIService {
 public:
  AxBaseAI(std::string name, std::string model, std::string embed_model,
           Value model_config = Value::object(), Value options = Value::object());
  Value chat(Value request) override;
  Value chat(Value request, Value options) override;
  Value complete(Value request) override;
  Value embed(Value request) override;
  Value embed(Value request, Value options) override;
  Value get_model_list() override;
  Value get_features(Value model = Value()) override;
  std::string get_id() override;
  std::string get_name() override;
  Value get_metrics() override;
  Value get_options() override;
  void set_options(Value options) override;
  Value get_last_used_chat_model() override;
  Value get_last_used_embed_model() override;
  Value get_last_used_model_config() override;

 protected:
  std::string name_;
  std::string model_;
  std::string embed_model_;
  Value model_config_;
  Value options_;
  Value last_used_chat_model_;
  Value last_used_embed_model_;
  Value last_used_model_config_;
  virtual Value do_chat(Value request, Value options) = 0;
  virtual Value do_embed(Value request, Value options) = 0;
};

Value get_supported_ai_models(Value options = Value::object());

using AxBalancerStatsKey = Value;
using AxBalancerRouteStats = Value;
using AxBalancerStatsObservation = Value;
using AxBalancerRoutingEvent = Value;
using AxBalancerCandidateScore = Value;
using AxBalancerFailureReason = std::string;

class AxBalancerStatsStore {
 public:
  virtual ~AxBalancerStatsStore() = default;
  virtual AxBalancerRouteStats get(const AxBalancerStatsKey& key) = 0;
  virtual void observe(const AxBalancerStatsKey& key, const AxBalancerStatsObservation& observation) = 0;
};

AxBalancerRouteStats create_balancer_route_stats();
AxBalancerRouteStats update_balancer_route_stats(AxBalancerRouteStats current, AxBalancerStatsObservation observation);
Value sample_balancer_route_health(AxBalancerRouteStats stats, double deadline_ms);

class AxInMemoryBalancerStatsStore final : public AxBalancerStatsStore {
 public:
  AxBalancerRouteStats get(const AxBalancerStatsKey& key) override;
  void observe(const AxBalancerStatsKey& key, const AxBalancerStatsObservation& observation) override;
 private:
  std::string serialize(const AxBalancerStatsKey& key) const;
  std::map<std::string, AxBalancerRouteStats> stats_;
  std::mutex mutex_;
};

struct AxBalancerAdaptiveStrategy {
  double deadline_ms = 0;
  double bad_outcome_cost = 0;
  Value expected_tokens;
  std::function<double(const AxAIService&, Value)> estimate_cost;
  std::string name_space = "default";
  std::function<std::string(Value)> slice;
  std::function<std::string(const std::shared_ptr<AxAIService>&, size_t)> route_key;
  std::shared_ptr<AxBalancerStatsStore> stats_store;
  std::function<void(AxBalancerRoutingEvent)> on_routing_event;
};

struct AxBalancerOptions {
  bool debug = true;
  int initial_backoff_ms = 1000;
  int max_backoff_ms = 32000;
  int max_retries = 3;
  std::shared_ptr<AxBalancerAdaptiveStrategy> strategy;
};

class AxBalancer : public AxAIService {
 public:
  AxBalancer();
  explicit AxBalancer(std::vector<std::shared_ptr<AxAIService>> services, Value options = Value::object());
  explicit AxBalancer(std::vector<std::shared_ptr<AxAIService>> services, AxBalancerOptions options);
  std::string get_id() override;
  std::string get_name() override;
  Value get_model_list() override;
  Value get_features(Value model = Value()) override;
  Value chat(Value request) override;
  Value chat(Value request, Value options) override;
  std::vector<Value> stream(Value request) override;
  Value embed(Value request) override;
  Value embed(Value request, Value options) override;
  Value transcribe(Value request) override;
  Value transcribe(Value request, Value options) override;
  Value speak(Value request) override;
  Value speak(Value request, Value options) override;
  Value get_metrics() override;
  std::function<void(std::string)> get_logger() override;
  double get_estimated_cost(Value model_usage) override;
  Value get_options() override;
  void set_options(Value options) override;
  Value get_last_used_chat_model() override;
  Value get_last_used_embed_model() override;
  Value get_last_used_model_config() override;
  Value complete(Value request) override;

 private:
  std::vector<std::shared_ptr<AxAIService>> services_;
  std::shared_ptr<AxAIService> current_service_;
  size_t current_service_index_ = 0;
  std::map<std::string, int> service_failures_;
  Value policy_ = Value::object();
  int max_retries_ = 3;
  std::shared_ptr<AxBalancerAdaptiveStrategy> adaptive_;
  std::shared_ptr<AxBalancerStatsStore> adaptive_store_;
  std::map<const AxAIService*, std::string> adaptive_route_keys_;
  std::map<const AxAIService*, size_t> adaptive_indices_;
  struct AdaptiveCandidate {
    std::shared_ptr<AxAIService> service;
    size_t order = 0;
    std::string route_key;
    Value stats_key;
    double score = 0;
    double estimated_cost = 0;
    double failure_probability = 0;
    double deadline_miss_probability = 0;
  };
  void validate_models();
  void initialize_adaptive(const std::vector<std::shared_ptr<AxAIService>>& input, std::shared_ptr<AxBalancerAdaptiveStrategy> strategy);
  std::vector<AdaptiveCandidate> rank_adaptive(Value request, Value options);
  void emit_routing_event(Value event) const;
  void observe_adaptive(const AdaptiveCandidate& candidate, Value observation, bool streaming, std::string reason = "", int status = 0);
  double adaptive_cost(const std::shared_ptr<AxAIService>& service, const std::string& route_key, Value request) const;
  bool can_retry_service(const std::shared_ptr<AxAIService>& service) const;
  void handle_failure(const std::shared_ptr<AxAIService>& service);
  void handle_success(const std::shared_ptr<AxAIService>& service);
  bool retryable(const AxError& error) const;
  std::vector<std::shared_ptr<AxAIService>> candidate_services(Value request);
  void reset();
};

class MultiServiceRouter : public AxAIService {
 public:
  MultiServiceRouter();
  explicit MultiServiceRouter(std::vector<std::shared_ptr<AxAIService>> services);
  explicit MultiServiceRouter(Value entries);
  std::string get_id() override;
  std::string get_name() override;
  Value get_model_list() override;
  Value get_features(Value model = Value()) override;
  Value chat(Value request) override;
  Value chat(Value request, Value options) override;
  Value embed(Value request) override;
  Value embed(Value request, Value options) override;
  Value transcribe(Value request) override;
  Value transcribe(Value request, Value options) override;
  Value speak(Value request) override;
  Value speak(Value request, Value options) override;
  Value get_metrics() override;
  std::function<void(std::string)> get_logger() override;
  double get_estimated_cost(Value model_usage) override;
  Value get_options() override;
  void set_options(Value options) override;
  Value get_last_used_chat_model() override;
  Value get_last_used_embed_model() override;
  Value get_last_used_model_config() override;
  Value complete(Value request) override;
  void set_service_entry(std::string key, Value entry);
  void set_service_entry(std::string key, std::shared_ptr<AxAIService> service, std::string description = "", bool is_internal = false);

 private:
  struct Entry {
    std::shared_ptr<AxAIService> service;
    std::string description;
    bool is_internal = false;
    Value model;
    Value embed_model;
  };
  std::map<std::string, Entry> services_;
  std::vector<std::string> service_keys_;
  std::shared_ptr<AxAIService> last_used_service_;
  Value options_ = Value::object();
};

class ProviderRouter {
 public:
  explicit ProviderRouter(Value config);
  ProviderRouter(std::vector<std::shared_ptr<AxAIService>> providers, Value routing = Value::object(), Value processing = Value::object());
  Value get_routing_recommendation(Value request);
  Value validate_request(Value request);
  Value get_routing_stats();
  Value chat(Value request, Value options = Value::object());
  std::vector<Value> stream(Value request);
  Value embed(Value request, Value options = Value::object());
  Value transcribe(Value request, Value options = Value::object());
  Value speak(Value request, Value options = Value::object());

 private:
  std::vector<std::shared_ptr<AxAIService>> providers_;
  Value routing_;
  Value processing_;
  Value provider_records() const;
  std::shared_ptr<AxAIService> service_for_name(Value name) const;
};

class Transport {
 public:
  virtual ~Transport() = default;
  virtual Value call(Value request) = 0;
};

class HttpTransport : public Transport {
 public:
  Value call(Value request) override;
};

// Transport seam for the realtime turn driver: ScriptedRealtimeTransport for
// deterministic offline turns, plus a WebSocket-backed transport (compiled only
// when AXLLM_ENABLE_REALTIME is defined) for live turns.
class RealtimeTransport {
 public:
  virtual ~RealtimeTransport() = default;
  virtual void send(const Value& event) = 0;
  virtual bool recv(Value& out) = 0;
  virtual void close() {}
};

class ScriptedRealtimeTransport : public RealtimeTransport {
 public:
  explicit ScriptedRealtimeTransport(std::vector<Value> inbound);
  void send(const Value& event) override;
  bool recv(Value& out) override;
  std::vector<Value> sent;

 private:
  std::vector<Value> inbound_;
  std::size_t index_ = 0;
};

class OpenAICompatibleClient : public AxBaseAI {
 public:
  explicit OpenAICompatibleClient(Value options = Value::object(), Transport* transport = nullptr);
  std::vector<Value> stream(Value request) override;
  Value transcribe(Value request) override;
  Value speak(Value request) override;
  std::vector<Value> realtime(Value events);
  Value realtime_audio_setup(Value request);
  Value realtime_audio_input(Value request);
  Value realtime_chat(Value request, RealtimeTransport* transport = nullptr);

 protected:
  OpenAICompatibleClient(std::string profile, std::string name, Value options, Transport* transport, std::string default_model, std::string default_embed_model);
  Value do_chat(Value request, Value options) override;
  Value do_embed(Value request, Value options) override;

 private:
  std::string profile_;
  std::string base_url_;
  std::string api_key_;
  Value descriptor_;
  std::string api_version_;
  double timeout_seconds_;
  std::unique_ptr<Transport> owned_transport_;
  Transport* transport_;
  Value request_json(const std::string& endpoint, Value payload, bool stream);
  Value request_json(const std::string& endpoint, Value payload, bool stream, const std::string& body_key);
  Value request_json(const std::string& endpoint, Value payload, bool stream, const std::string& body_key, bool binary_response);
  std::string operation_path(const std::string& operation) const;
  std::string operation_path(const std::string& operation, Value model) const;
  Value headers() const;
  Value transport_result(Value result, Value request);
  std::vector<Value> iter_sse_json(Value raw);
};

class OpenAIResponsesClient : public OpenAICompatibleClient {
 public:
  explicit OpenAIResponsesClient(Value options = Value::object(), Transport* transport = nullptr);
};

class GoogleGeminiClient : public OpenAICompatibleClient {
 public:
  explicit GoogleGeminiClient(Value options = Value::object(), Transport* transport = nullptr);
};

class AnthropicClient : public OpenAICompatibleClient {
 public:
  explicit AnthropicClient(Value options = Value::object(), Transport* transport = nullptr);
};

class AzureOpenAIClient : public OpenAICompatibleClient {
 public:
  explicit AzureOpenAIClient(Value options = Value::object(), Transport* transport = nullptr);
};

class DeepSeekClient : public OpenAICompatibleClient {
 public:
  explicit DeepSeekClient(Value options = Value::object(), Transport* transport = nullptr);
};

class MistralClient : public OpenAICompatibleClient {
 public:
  explicit MistralClient(Value options = Value::object(), Transport* transport = nullptr);
};

class RekaClient : public OpenAICompatibleClient {
 public:
  explicit RekaClient(Value options = Value::object(), Transport* transport = nullptr);
};

class CohereClient : public OpenAICompatibleClient {
 public:
  explicit CohereClient(Value options = Value::object(), Transport* transport = nullptr);
};

class GrokClient : public OpenAICompatibleClient {
 public:
  explicit GrokClient(Value options = Value::object(), Transport* transport = nullptr);
};

class Tool {
 public:
  std::string id;
  std::string name;
  std::string description;
  Value parameters;
  Value args;
  Value returns;
  std::function<Value(Value)> handler;

  Tool(std::string name, std::string description, Value parameters = Value::object(),
       std::function<Value(Value)> handler = nullptr, Value args = Value::array(), Value returns = Value::array());
  Value value() const;
};

class AxMemory {
 public:
  AxMemory();
  AxMemory& add_request(Value messages);
  AxMemory& add_response(Value response);
  AxMemory& update_result(Value response);
  AxMemory& add_function_results(Value results);
  AxMemory& add_processor_output(Value output);
  AxMemory& add_correction(Value response, Value error_message);
  Value history() const;
  Value get_last() const;
  AxMemory& add_tag(const std::string& tag);
  AxMemory& rewind_to_tag(const std::string& tag);
  AxMemory& remove_by_tag(const std::string& tag);
  Value value() const;
  Value& value_ref();

 private:
  Value items_;
};

class AxProgram {
 public:
  virtual ~AxProgram() = default;
  virtual Value forward(AIClient& client, Value values, Value options = Value::object()) = 0;
  virtual Value get_optimizable_components() const { return Value::array(); }
  virtual AxProgram& apply_optimized_components(Value) { return *this; }
  virtual Value get_traces() const { return Value::array(); }
  virtual Value get_chat_log() const { return Value::array(); }
  virtual Value get_usage() const { return Value::object(); }
};

class AxGen : public AxProgram {
 public:
  explicit AxGen(Value signature, Value options = Value::object());
  Value forward(AIClient& client, Value values, Value options = Value::object());
  AxGen& add_tool(const Tool& tool);
  AxGen& set_examples(Value examples);
  AxGen& set_demos(Value demos);
  AxGen& add_assert(Value assertion);
  AxGen& add_assert(std::function<Value(Value)> assertion);
  AxGen& add_streaming_assert(Value assertion);
  AxGen& add_streaming_assert(std::string field, std::string not_contains, std::string message = "");
  AxGen& add_field_processor(std::string field, std::string op);
  AxGen& add_field_processor(std::string field, std::function<Value(Value)> processor);
  AxGen& on_function_call(std::function<void(Value)> hook);
  AxGen& set_stop_functions(Value names);
  AxGen& set_instruction(Value instruction);
  Value get_instruction() const;
  AxGen& clear_instruction();
  Value get_optimizable_components() const;
  AxGen& apply_optimized_components(Value component_map);
  AxGen& apply_optimization(Value artifact);
  Value evaluate_optimization(AIClient& client, Value dataset, Value candidate_map = Value::object(), Value options = Value::object());
  Value optimize_with(OptimizerEngine& engine, Value dataset, Value options = Value::object());
  Value optimize_with(OptimizerEngine& engine, AIClient& client, Value dataset, Value options = Value::object());
  Value get_traces() const;
  Value get_chat_log() const;
  Value get_function_call_traces() const;
  AxMemory& get_memory();
  Value value() const;

 private:
  Value state_;
  AxMemory memory_;
  void refresh_prompt_template();
};

class AxFlow : public AxProgram {
 public:
  explicit AxFlow(Value options = Value::object());
  explicit AxFlow(std::string mermaid, Value bindings = Value::object());
  AxFlow& execute(std::string name, AxProgram& program, Value options = Value::object());
  AxFlow& derive(std::string name, AxProgram& program, Value options = Value::object());
  AxFlow& map(std::string name, std::function<Value(Value)> mapper);
  AxFlow& map(std::string name, std::function<Value(Value)> mapper, Value options);
  AxFlow& branch(std::string name, std::function<Value(Value)> predicate, Value branches, Value options = Value::object());
  AxFlow& while_loop(std::string name, std::function<Value(Value)> condition, Value steps, int max_iterations = 100, Value options = Value::object());
  AxFlow& feedback(std::string name, std::function<Value(Value)> condition, Value steps, int max_iterations = 10, Value options = Value::object());
  AxFlow& node_extended(std::string name, Value base_signature, Value extensions = Value::object(), Value options = Value::object());
  AxFlow& nx(std::string name, Value base_signature, Value extensions = Value::object(), Value options = Value::object());
  AxFlow& parallel(Value steps);
  AxFlow& returns(Value spec);
  AxFlow& set_demos(Value demos);
  Value forward(AIClient& client, Value values, Value options = Value::object());
  Value streaming_forward(AIClient& client, Value values, Value options = Value::object());
  Value get_plan() const;
  Value get_traces() const;
  Value get_chat_log() const;
  Value get_usage() const;
  Value get_optimizable_components() const;
  AxFlow& apply_optimized_components(Value component_map);
  AxFlow& apply_optimization(Value artifact);
  Value evaluate_optimization(AIClient& client, Value dataset, Value candidate_map = Value::object(), Value options = Value::object());
  Value optimize_with(OptimizerEngine& engine, Value dataset, Value options = Value::object());
  Value optimize_with(OptimizerEngine& engine, AIClient& client, Value dataset, Value options = Value::object());
  Value value() const;
  std::string str(Value options = Value::object()) const;
  AxFlow& add_raw_step(Value step);

 private:
  Value state_;
  std::vector<std::shared_ptr<AxGen>> mermaid_programs_;
  AxFlow& add_step(Value kind, Value name, Value program, Value options);
  Value hydrate_mermaid_steps(Value steps, Value bindings);
};

Value flow_callback(std::function<Value(Value)> mapper);

class AxCodeSession {
 public:
  virtual ~AxCodeSession() = default;
  virtual Value execute(Value code, Value options = Value::object()) = 0;
  virtual Value inspect(Value options = Value::object()) {
    return Value("[runtime state inspection unavailable: runtime session does not implement inspect_globals()]");
  }
  virtual Value snapshot_globals(Value options = Value::object()) {
    throw AxError("runtime", "AxCodeSession.snapshot_globals() is required to export AxAgent state");
  }
  virtual Value patch_globals(Value snapshot, Value options = Value::object()) {
    throw AxError("runtime", "AxCodeSession.patch_globals() is required to restore AxAgent state");
  }
  virtual Value export_state(Value options = Value::object()) { return snapshot_globals(options); }
  virtual Value restore_state(Value snapshot, Value options = Value::object()) { return patch_globals(snapshot, options); }
  virtual Value close() = 0;
};

class AxCodeRuntime {
 public:
  virtual ~AxCodeRuntime() = default;
  virtual std::string language() const { return "JavaScript"; }
  virtual std::string usage_instructions() const { return ""; }
  virtual AxCodeSession* create_session(Value globals, Value options = Value::object()) = 0;
  // Register a host callable under `name`. Default no-op so runtimes that do
  // not host callables are unaffected; the embedded JS engines override it so
  // the agent wrapper can wire the built-in `llmQuery` primitive.
  virtual void register_host_callable(std::string /*name*/, std::function<Value(Value)> /*callable*/) {}
};

struct RuntimeCapabilities {
  bool inspect = true;
  bool snapshot = true;
  bool patch = true;
  bool abort = false;
  std::string language = "JavaScript";
  std::string usage_instructions = "";
  Value to_value() const;
};

struct RuntimeEnvelope {
  static Value result(Value value);
  static Value error(Value message, Value category = Value("runtime"));
  static Value session_closed(Value message = Value("session closed"));
  static Value timeout(Value message = Value("execution timed out"));
  static Value final_payload(std::initializer_list<Value> args);
  static Value final_payload(Value args);
  static Value ask_clarification(std::initializer_list<Value> args);
  static Value ask_clarification(Value args);
  static Value discover(Value request);
  static Value recall(Value request);
  static Value used(Value request, Value reason = Value(), Value stage = Value());
  static Value status(Value type, Value message = Value(""));
  static Value guide_agent(Value guidance, Value triggered_by = Value());
};

class RuntimeTransport {
 public:
  virtual ~RuntimeTransport() = default;
  virtual Value call(Value message) = 0;
};

class RuntimeProtocolClient : public AxCodeRuntime {
 public:
  explicit RuntimeProtocolClient(RuntimeTransport& transport);
  std::string language() const override { return "JavaScript"; }
  std::string usage_instructions() const override;
  AxCodeSession* create_session(Value globals, Value options = Value::object()) override;
  Value request(Value op, Value session_id = Value(), Value payload = Value::object(), bool throw_on_error = true);
  Value shutdown();

 private:
  RuntimeTransport& transport_;
  int next_id_ = 0;
  std::vector<std::unique_ptr<RuntimeProtocolSession>> sessions_;
};

class RuntimeProtocolSession : public AxCodeSession {
 public:
  RuntimeProtocolSession(RuntimeProtocolClient& client, Value session_id);
  Value execute(Value code, Value options = Value::object()) override;
  Value inspect(Value options = Value::object()) override;
  Value snapshot_globals(Value options = Value::object()) override;
  Value patch_globals(Value snapshot, Value options = Value::object()) override;
  Value close() override;

 private:
  RuntimeProtocolClient& client_;
  Value session_id_;
};

class OptimizerEvaluator {
 public:
  virtual ~OptimizerEvaluator() = default;
  virtual Value evaluate(Value candidate_map, Value options = Value::object()) = 0;
};

class OptimizerEngine {
 public:
  virtual ~OptimizerEngine() = default;
  virtual std::string name() const { return "host"; }
  virtual std::string version() const { return "host"; }
  virtual Value optimize(Value request) = 0;
  virtual Value optimize(Value request, OptimizerEvaluator* evaluator) { return optimize(std::move(request)); }
};

class AxGEPA : public OptimizerEngine {
 public:
  explicit AxGEPA(AIClient* reflection_client = nullptr, Value options = Value::object());
  std::string name() const override;
  std::string version() const override;
  Value optimize(Value request) override;
  Value optimize(Value request, OptimizerEvaluator* evaluator) override;

 private:
  AIClient* reflection_client_;
  Value options_;
  uint32_t rng_state_;
  Value selector_state_;
  double rand();
};

class AxBootstrapFewShot : public OptimizerEngine {
 public:
  explicit AxBootstrapFewShot(Value options = Value::object());
  std::string name() const override;
  std::string version() const override;
  Value optimize(Value request) override;
  Value optimize(Value request, OptimizerEvaluator* evaluator) override;

 private:
  Value options_;
};

// AxACE is the Agentic Context Engineering optimizer (Generator -> Reflector ->
// Curator). Deterministic playbook mutations reuse the Core-owned _ace_* ops;
// the LLM-orchestrated reflect/curate steps are delegated to injected callables
// so the loop is reproducible under conformance with scripted responses.
class AxACE {
 public:
  using AceCallable = std::function<Value(const Value&)>;

  explicit AxACE(Value options = Value::object());
  void set_callables(AceCallable reflector, AceCallable curator, AceCallable generator);
  std::string name() const;
  std::string version() const;
  void reset();
  void configure_auto(const std::string& level);
  void hydrate(const Value& state);
  Value get_playbook() const;
  Value get_artifact() const;
  Value compile(const std::vector<Value>& examples, const AceCallable& metric_fn, Value options = Value::object());
  Value apply_online_update(Value args);

 private:
  AceCallable reflector_;
  AceCallable curator_;
  AceCallable generator_;
  Value config_;
  Value initial_playbook_;
  std::string now_;
  Value playbook_;
  std::vector<Value> generator_history_;
  std::vector<Value> delta_history_;
  Value last_prediction_;
  bool has_generator_ = false;

  Value empty_playbook() const;
  int int_config(const std::string& key, int fallback) const;
  std::string render_playbook() const;
  Value generator_output(const Value& prediction) const;
  Value run_reflection_rounds(const Value& example, const Value& generator_output, const Value& feedback);
  Value run_reflector(const Value& example, const Value& generator_output, const Value& feedback, const Value& previous_reflection);
  Value run_curator(const Value& example, const Value& reflection);
  std::vector<Value> normalize_and_resolve(const Value& raw_curator, const Value& generator_output, const Value& reflection);
  std::vector<Value> apply_operations(std::vector<Value>& resolved, Value& curator_result);
  void apply_bullet_tags(const Value& reflection);
};

// AxPlaybook is a live, evolving context playbook bound to a program. It mirrors
// the TypeScript AxPlaybook: grow it offline from examples (evolve), keep it
// growing online from live feedback (update), render it into the program context
// (apply_to), and persist/restore it (to_json/load). The evolution engine (ACE)
// is an implementation detail of this surface, just as optimize() hides GEPA.
class AxAgent;
class AxPlaybook {
 public:
  using MetricFn = std::function<Value(const Value&)>;

  AxPlaybook(AxGen& program, AIClient& student, AIClient* teacher = nullptr, Value options = Value::object());
  Value evolve(const std::vector<Value>& examples, const MetricFn& metric_fn, Value options = Value::object());
  Value update(Value args);
  void apply_to(AxGen* program = nullptr);
  std::string render() const;
  Value get_state() const;
  Value to_json() const;
  AxPlaybook& load(Value snapshot);
  void configure_auto(const std::string& level);
  void reset();
  void set_apply_hook(std::function<void(const std::string&)> hook);
  AxPlaybook& bind_agent(AxAgent& agent);
  Value evolve(Value dataset, Value options = Value::object());

 private:
  AxGen* program_;
  AxACE engine_;
  AIClient* student_;
  AIClient* teacher_;
  bool verbose_;
  std::string base_instruction_;
  bool started_ = false;
  Value last_prediction_;
  std::unique_ptr<AxGen> reflector_program_;
  std::unique_ptr<AxGen> curator_program_;
  std::function<void(const std::string&)> apply_hook_;
  AxAgent* agent_ = nullptr;

  Value run_generator(const Value& example);
  Value run_reflector(const Value& payload);
  Value run_curator(const Value& payload);
  void bind_callables();
  void inject();
};

class AxAgent : public AxProgram {
 public:
  explicit AxAgent(Value signature, Value options = Value::object());
  AxAgent& set_signature(Value signature);
  Value get_instruction() const;
  AxAgent& set_instruction(Value instruction);
  AxAgent& add_actor_instruction(Value addendum);
  Value forward(AIClient& client, Value values, Value options = Value::object());
  AxAgent& set_citations_observer(std::function<void(Value)> observer);
  AxAgent& set_playbook_observer(std::function<void(Value)> observer);
  Value test(AxCodeRuntime& runtime, Value code, Value context_values = Value::object(), Value options = Value::object());
  Value execute_actor_step(AxCodeRuntime& runtime, Value code, Value values = Value::object(), Value options = Value::object());
  Value inspect_runtime(Value options = Value::object());
  Value export_session_state(Value options = Value::object());
  Value restore_session_state(Value snapshot, Value options = Value::object());
  Value close_runtime_session();
  Value get_state() const;
  void set_state(Value state);
  Value get_chat_log() const;
  Value get_action_log() const;
  Value get_trace() const;
  Value export_trace() const;
  Value replay_trace(Value trace, Value fixtures = Value::object()) const;
  Value get_usage() const;
  Value get_runtime_contract() const;
  Value get_policy() const;
  Value get_policy_registry() const;
  Value get_callable_inventory() const;
  Value get_discovery_catalog() const;
  Value discover(Value request);
  Value recall(Value request);
  Value used(Value id, Value reason = Value(""), Value stage = Value("executor"));
  Value invoke_callable(Value qualified_name, Value args = Value::object(), Value options = Value::object());
  AxAgent& add_tool_module(std::string name, const std::vector<Tool>& tools);
  Value export_runtime_state() const;
  Value restore_runtime_state(Value snapshot);
  Value get_optimizer_metadata() const;
  Value get_optimizable_components() const;
  AxAgent& apply_optimized_components(Value component_map);
  AxAgent& apply_optimization(Value artifact);
  Value evaluate_optimization_task(AIClient& client, Value task, Value options = Value::object());
  Value evaluate_optimization(AIClient& client, Value dataset, Value candidate_map = Value::object(), Value options = Value::object());
  Value optimize_with(OptimizerEngine& engine, Value dataset, Value options = Value::object());
  Value optimize_with(OptimizerEngine& engine, AIClient& client, Value dataset, Value options = Value::object());
  Value optimize(Value dataset = Value::array(), Value options = Value::object());
  AxPlaybook& playbook(AIClient& student, Value options = Value::object());
  AxPlaybook* get_playbook() const;

 private:
  Value state_;
  std::unique_ptr<AxGen> distiller_;
  std::unique_ptr<AxGen> executor_;
  std::unique_ptr<AxGen> responder_;
  std::unique_ptr<AxGen> llm_query_;
  Value options_;
  Value playbook_config_;
  std::unique_ptr<AxPlaybook> playbook_handle_;
  std::function<void(Value)> citations_observer_;
  std::function<void(Value)> playbook_observer_;
  void ensure_configured_playbook(AIClient& client);
  void learn_playbook_failures(Value output);
};

std::string stringify(const Value& value);
Value parse_json(const std::string& source);
bool equal(const Value& left, const Value& right);
std::string display(const Value& value);
Value object(std::initializer_list<std::pair<std::string, Value>> entries);
Value array(std::initializer_list<Value> entries);
Value s(const std::string& signature);
Value signature(const std::string& source);
std::string to_string(const Value& signature);
AxGen ax(const std::string& signature, Value options = Value::object());
AxGen ax(const char* signature, Value options = Value::object());
AxGen ax(Value signature, Value options = Value::object());
AxAgent agent(const std::string& signature, Value options = Value::object());
AxAgent agent(const char* signature, Value options = Value::object());
AxAgent agent(Value signature, Value options = Value::object());
// Register a native host search callback and return a marker to place in the agent options
// under "onMemoriesSearch"/"onSkillsSearch". The callbacks run host-side when the actor calls
// recall()/discover(); their presence auto-enables the memory/skill subsystems. Callbacks take
// and return Value: memories (searches, alreadyLoaded) -> results, skills (searches) -> results.
Value register_memories_search(std::function<Value(Value, Value)> fn);
Value register_skills_search(std::function<Value(Value)> fn);
// Register a non-fatal AxAgent observer and return a marker usable as any
// onLoadedMemories/onLoadedSkills/onUsedMemories/onUsedSkills option value.
Value register_agent_observer(std::function<void(Value)> fn);
AxFlow flow(Value options = Value::object());
AxFlow flow(const std::string& mermaid, Value bindings = Value::object());
Value optimize(AxGen& program, AIClient& student, Value dataset, Value options = Value::object(), AIClient* teacher = nullptr);
Value optimize(AxFlow& program, AIClient& student, Value dataset, Value options = Value::object(), AIClient* teacher = nullptr);
Value optimize(AxAgent& program, AIClient& student, Value dataset, Value options = Value::object(), AIClient* teacher = nullptr);
AxPlaybook playbook(AxGen& program, AIClient& student, Value options = Value::object(), AIClient* teacher = nullptr);
std::shared_ptr<AxAIService> ai(const std::string& provider, Value options = Value::object());
std::shared_ptr<AxAIService> ai(const char* provider, Value options = Value::object());
Value to_json_schema(Value fields, const std::string& title = "Schema", Value options = Value::object());
Value validate_output(Value fields, Value values);
Value strip_internal(Value fields, Value values);
Value render_prompt(Value signature, Value values, Value functions = Value::array(), Value options = Value::object());
Value fold_stream(Value events);

}  // namespace axllm
