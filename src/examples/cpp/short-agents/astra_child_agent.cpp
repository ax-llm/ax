// ax-example:start
// title: C++ Child Agent Controls
// group: short-agents
// description: Delegates through a real actor runtime and applies controls to the child scope.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: advanced
// order: 13
// ax-example:end
#include "axllm/axllm.hpp"
#include "axllm/runtime/quickjs/quickjs_runtime.hpp"
#include <iostream>
using namespace axllm;

int main(){
 const char* key=std::getenv("OPENAI_API_KEY");if(!key||!*key)key=std::getenv("OPENAI_APIKEY");if(!key||!*key)throw std::runtime_error("Set OPENAI_API_KEY or OPENAI_APIKEY.");
 auto client=ai("openai",object({{"api_key",key},{"model","gpt-6-astra"},{"model_config",object({{"thinkingTokenBudget","low"},{"max_tokens",4096}})}}));
 auto control=run_control();bool applied=false;
 control.on_event([&](Value event){if(stringify(Core::get(event,"type"))=="\"applied\""&&stringify(Core::get(event,"path"))=="\"root/team.researcher/executor\"")applied=true;});
 control.steer("Include VERIFIED in the final answer.");control.steer("Include CHILD-CHECK in the final answer.","root/team.researcher");control.set_thinking_token_budget("medium","root/team.researcher/executor");
 runtime::quickjs::QuickJsCodeRuntime parent_runtime(object({{"timeoutMs",180000}})),child_runtime(object({{"timeoutMs",180000}}));
 auto child=std::make_shared<AxAgent>("question -> answer",object({{"directResponse","off"},{"runtime",Core::code_runtime_ref(child_runtime)}}));
 auto parent=agent("question -> answer",object({{"directResponse","off"},{"runtime",Core::code_runtime_ref(parent_runtime)}}));parent.add_child_agent("team","researcher",child);
 Value result=parent.forward(*client,object({{"question","Delegate to team.researcher exactly once by calling await team.researcher({question: \"Compute 37 + 5 and return the exact sum.\"}) in actor code. Pass the complete child answer as evidence to final(...), then report it in your final answer."}}),object({{"control",control.value()},{"serviceTier","standard"},{"max_actor_steps",8}}));
 for(const auto& word:{"42","VERIFIED","CHILD-CHECK"})if(stringify(result).find(word)==std::string::npos)throw std::runtime_error(stringify(result));
 if(!applied)throw std::runtime_error("Child control did not apply");
 std::cout<<stringify(result)<<"\n"<<stringify(parent.get_usage())<<"\n";
}
