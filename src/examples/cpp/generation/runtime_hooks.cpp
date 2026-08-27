// ax-example:start
// title: Portable Runtime Hooks
// group: generation
// description: Applies global and forward-scoped rate limiting, tracing, and metrics to AxGen, AxAgent, and AxFlow.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: advanced
// order: 46
// ax-example:end
#include "axllm/axllm.hpp"
#include "axllm/runtime/quickjs/quickjs_runtime.hpp"

#include <cstdlib>
#include <iostream>
#include <memory>

class LogSpan final : public axllm::AxSpan {
 public:
  explicit LogSpan(std::string name) : name_(std::move(name)) { std::cout << "[span:start] " << name_ << "\n"; }
  void set_attributes(axllm::Value) override {}
  void add_event(std::string event, axllm::Value) override { std::cout << "[span:event] " << name_ << " " << event << "\n"; }
  void record_exception(std::string error) override { std::cout << "[span:error] " << name_ << " " << error << "\n"; }
  void set_status(std::string, std::string) override {}
  void end() override { std::cout << "[span:end] " << name_ << "\n"; }
 private:
  std::string name_;
};

class LogTracer final : public axllm::AxTracer {
 public:
  std::shared_ptr<axllm::AxSpan> start_span(const axllm::AxSpanStart& start) override { return std::make_shared<LogSpan>(start.name); }
};

class LogInstrument final : public axllm::AxCounter, public axllm::AxHistogram, public axllm::AxGauge {
 public:
  explicit LogInstrument(std::string name) : name_(std::move(name)) {}
  void add(double value, axllm::Value) override { std::cout << "[metric] " << name_ << " += " << value << "\n"; }
  void record(double value, axllm::Value) override { std::cout << "[metric] " << name_ << " = " << value << "\n"; }
 private:
  std::string name_;
};

class LogMeter final : public axllm::AxMeter {
 public:
  std::shared_ptr<axllm::AxCounter> create_counter(std::string name, axllm::AxMetricInstrumentOptions) override { return std::make_shared<LogInstrument>(std::move(name)); }
  std::shared_ptr<axllm::AxHistogram> create_histogram(std::string name, axllm::AxMetricInstrumentOptions) override { return std::make_shared<LogInstrument>(std::move(name)); }
  std::shared_ptr<axllm::AxGauge> create_gauge(std::string name, axllm::AxMetricInstrumentOptions) override { return std::make_shared<LogInstrument>(std::move(name)); }
};

axllm::AxRateLimiter limiter(std::string label) {
  return [label = std::move(label)](axllm::AxRequestExecutor next, const axllm::AxRateLimitInfo& info) {
    std::cout << "[limit:" << label << "] " << info.operation << " " << info.provider << "/" << info.model << " stream=" << info.streaming << "\n";
    return next();
  };
}

int main() {
  const char* key = std::getenv("OPENAI_API_KEY");
  if (key == nullptr || std::string(key).empty()) key = std::getenv("OPENAI_APIKEY");
  if (key == nullptr || std::string(key).empty()) { std::cerr << "Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.\n"; return 2; }
  const char* configured_model = std::getenv("AX_OPENAI_MODEL");
  axllm::OpenAICompatibleClient client(axllm::object({
      {"api_key", key},
      {"model", configured_model == nullptr || std::string(configured_model).empty() ? "gpt-5.4-mini" : configured_model},
      {"model_config", axllm::object({{"temperature", 0}})},
  }));
  auto tracer = std::make_shared<LogTracer>();
  auto meter = std::make_shared<LogMeter>();
  axllm::AxRuntimeHooks override_hooks{limiter("forward"), tracer, meter};

  axllm::set_rate_limiter(limiter("global"));
  axllm::set_tracer(tracer);
  axllm::set_meter(meter);
  try {
    auto direct = axllm::ax("topic:string -> summary:string");
    std::cout << axllm::stringify(direct.forward(client, axllm::object({{"topic", "portable Ax runtime hooks"}}))) << "\n";

    auto helper = axllm::agent("question:string -> answer:string");
    axllm::runtime::quickjs::QuickJsCodeRuntime runtime;
    std::cout << axllm::stringify(helper.forward(
        client,
        axllm::object({{"question", "What does a rate limiter wrap?"}}),
        axllm::object({{"runtime", axllm::Core::code_runtime_ref(runtime)}, {"max_actor_steps", 12}}),
        override_hooks)) << "\n";

    auto outline = axllm::ax("topic:string -> outline:string");
    auto polish = axllm::ax("outline:string -> answer:string");
    auto workflow = axllm::flow(axllm::object({{"id", "examples.runtimeHooks"}}))
        .execute("outline", outline)
        .execute("polish", polish)
        .returns(axllm::object({{"answer", "polish"}}));
    std::cout << axllm::stringify(workflow.forward(client, axllm::object({{"topic", "Ax runtime hooks"}}), axllm::Value::object(), override_hooks)) << "\n";
  } catch (...) {
    axllm::set_rate_limiter({}); axllm::set_tracer({}); axllm::set_meter({});
    throw;
  }
  axllm::set_rate_limiter({}); axllm::set_tracer({}); axllm::set_meter({});
}
