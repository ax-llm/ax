// ax-example:start
// title: C++ Cancel Background Work
// group: generation
// description: Cancels a live Astra run through the high-level controller and observes cooperative tool cancellation.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: advanced
// order: 13
// ax-example:end
#include "axllm/axllm.hpp"
#include <iostream>
using namespace axllm;
struct CancellationState {AxRunControl control;std::atomic<bool> settled{false};std::atomic<long long> started{0};};
int main(){
 const char* key=std::getenv("OPENAI_API_KEY");if(!key||!*key)key=std::getenv("OPENAI_APIKEY");if(!key||!*key)throw std::runtime_error("Set OPENAI_API_KEY or OPENAI_APIKEY.");
 auto state=std::make_shared<CancellationState>();
 Tool lookup("lookup","Look up the reference.");lookup.execution("background").context_handler([state](Value,const AxToolContext& context){state->started.store(std::chrono::steady_clock::now().time_since_epoch().count());state->control.abort();auto deadline=std::chrono::steady_clock::now()+std::chrono::seconds(2);while(!context.is_cancelled()&&std::chrono::steady_clock::now()<deadline)std::this_thread::sleep_for(std::chrono::milliseconds(1));if(!context.is_cancelled())throw std::runtime_error("Tool missed cancellation");state->settled.store(true);return Value("LATE: discard this result");});
 auto program=ax("question -> answer");program.add_tool(lookup);
 auto client=ai("openai",object({{"api_key",key},{"model","gpt-6-astra"},{"model_config",object({{"thinkingTokenBudget","low"},{"max_tokens",2048}})}}));
 try{program.forward(*client,object({{"question","Call lookup once and return its result."}}),object({{"control",state->control.value()},{"serviceTier","standard"}}));throw std::runtime_error("Cancelled run returned success");}
 catch(const AxError& error){auto started=std::chrono::steady_clock::time_point(std::chrono::steady_clock::duration(state->started.load()));auto elapsed=std::chrono::steady_clock::now()-started;if(!state->started.load()||std::string(error.what()).find("unresolved calls")==std::string::npos||elapsed>std::chrono::seconds(2))throw;auto deadline=std::chrono::steady_clock::now()+std::chrono::seconds(2);while(!state->settled.load()&&std::chrono::steady_clock::now()<deadline)std::this_thread::sleep_for(std::chrono::milliseconds(1));if(!state->settled.load())throw std::runtime_error("Tool missed cancellation");std::cout<<"Cancelled in "<<std::chrono::duration_cast<std::chrono::milliseconds>(elapsed).count()<<"ms; "<<error.what()<<"\n";}
}
