// ax-example:start
// title: C++ Agent Background Tools
// group: short-agents
// description: Runs declared background agent tools with steering and verifies final result incorporation.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: advanced
// order: 12
// ax-example:end
#include "axllm/axllm.hpp"
#include "axllm/runtime/quickjs/quickjs_runtime.hpp"
#include <iostream>
using namespace axllm;

struct RunState { std::atomic<bool> pending{false},finished{false},overlap{false},steered{false};std::atomic<int> applied{0};AxRunControl control; };

int main(){
  const char* key=std::getenv("OPENAI_API_KEY");if(!key||!*key)key=std::getenv("OPENAI_APIKEY");if(!key||!*key)throw std::runtime_error("Set OPENAI_API_KEY or OPENAI_APIKEY.");
  auto client=ai("openai",object({{"api_key",key},{"model","gpt-6-astra"},{"model_config",object({{"thinkingTokenBudget","low"},{"max_tokens",4096}})}}));
  auto state=std::make_shared<RunState>();auto control=state->control;std::weak_ptr<RunState> weak=state;
  control.on_event([weak](Value event){if(auto state=weak.lock();state&&stringify(Core::get(event,"type"))=="\"applied\"")++state->applied;});
  Value schema=object({{"type","object"},{"properties",Value::object()},{"additionalProperties",false}});
  Tool slow("slow_reference","Look up a reference; takes a few seconds.",schema,[state](Value){state->pending.store(true);if(!state->steered.exchange(true)){state->control.steer("Include the word VERIFIED in the final answer.");state->control.set_thinking_token_budget("medium");}std::this_thread::sleep_for(std::chrono::seconds(6));state->finished.store(true);return Value("REF-42");});slow.execution("background");
  Tool label("local_label","Read an independent local label immediately.",schema,[state](Value){for(int i=0;i<300&&!state->pending.load();++i)std::this_thread::sleep_for(std::chrono::milliseconds(10));if(state->pending.load()&&!state->finished.load())state->overlap.store(true);return Value("LAUNCH");});
  label.execution("background");
  auto program=agent("question -> answer",object({{"runtime",object({{"language","JavaScript"}})},{"directResponse","off"}}));program.add_tool_module("tools",{slow,label});
  runtime::quickjs::QuickJsCodeRuntime runtime;
  Value result=program.forward(*client,object({{"question","Use the native tools tools_slow_reference and tools_local_label. First call tools_slow_reference. While it is pending, call tools_local_label. Call each tool only once; do not call a tool again while its result is pending. In the executor, call the native tools directly rather than invoking them from actor code; then use final(...) in the code runtime to pass their results to the responder. Return both exact results in one sentence."}}),object({{"runtime",Core::code_runtime_ref(runtime)},{"max_actor_steps",12},{"control",control.value()},{"serviceTier","standard"},{"maxSteps",6}}));
  std::string answer=stringify(result);for(const std::string& word:{"REF-42","LAUNCH","VERIFIED"})if(answer.find(word)==std::string::npos)throw std::runtime_error("Missing final result: "+answer);
  if(!state->overlap.load())throw std::runtime_error("No independent work while background tool was pending");if(state->applied.load()<2)throw std::runtime_error("Control updates were not applied");
  std::cout<<answer<<"\nBackground overlap verified; steering and reasoning applied at the next response.\n";
}
