// ax-example:start
// title: C++ Controlled Background Flow
// group: flows
// description: Uses ordinary generation with background tools, steering, and a reasoning update.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: advanced
// order: 12
// ax-example:end
#include "axllm/axllm.hpp"
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
  auto program=ax("question -> answer");program.add_tool(slow).add_tool(label);
  auto verifier=ax("answer -> report \"Repeat the exact reference, label, and verification word from the answer.\"");
  auto workflow=flow().execute("lookup",program,object({{"writes",Value(Array{"answer"})}})).execute("verify",verifier,object({{"reads",Value(Array{"answer"})}})).returns(object({{"answer","report"}}));
  Value result=workflow.forward(*client,object({{"question","First call slow_reference. While it is pending, call local_label. Call each tool only once; do not call a tool again while its result is pending. If a required tool result is still pending, end this response with a brief progress message. The application will continue with the result when it arrives; do not spend reasoning tokens waiting for it. Once both results arrive, return them in one sentence."}}),object({{"control",control.value()},{"serviceTier","standard"},{"maxSteps",6}}));
  std::string answer=stringify(result);for(const std::string& word:{"REF-42","LAUNCH","VERIFIED"})if(answer.find(word)==std::string::npos)throw std::runtime_error("Missing final result: "+answer);
  if(!state->overlap.load())throw std::runtime_error("No independent work while background tool was pending");if(state->applied.load()!=4)throw std::runtime_error("Control updates were not applied");
  std::cout<<answer<<"\nBackground overlap verified; steering and reasoning applied at the next response.\n";
}
