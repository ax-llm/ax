// ax-example:start
// title: C++ Concurrent Astra Flow
// group: flows
// description: Independent conversations overlap, retain their tool results, and receive scoped controls.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: advanced
// order: 13
// ax-example:end
#include "axllm/axllm.hpp"
#include <cstdlib>
#include <iostream>
#include <set>
using namespace axllm;

int main(){
  const char* key=std::getenv("OPENAI_API_KEY");if(!key||!*key)key=std::getenv("OPENAI_APIKEY");if(!key||!*key)throw std::runtime_error("Set OPENAI_API_KEY or OPENAI_APIKEY.");
  auto client=ai("openai",object({{"api_key",key},{"model","gpt-6-astra"},{"model_config",object({{"thinkingTokenBudget","low"},{"max_tokens",4096}})}}));
  struct Gate{std::mutex mutex;std::condition_variable ready;int calls=0;bool updates=false;};auto gate=std::make_shared<Gate>();
  auto control=run_control();std::set<std::string> paths;std::vector<Value> applied;
  control.on_event([&control,&paths,&applied,gate](Value event){
    if(display(Core::get(event,"type"))=="tool.started"){
      paths.insert(display(Core::get(event,"path")));if(paths.size()==2){control.steer("Include VERIFIED with the exact reference in your final answer.");control.set_thinking_token_budget("medium","root/left");std::lock_guard<std::mutex> lock(gate->mutex);gate->updates=true;gate->ready.notify_all();}
    }
    if(display(Core::get(event,"type"))=="applied")applied.push_back(event);
  });
  Tool lookup("lookup","Look up the exact reference once.",Value::object(),[gate](Value){
    std::unique_lock<std::mutex> lock(gate->mutex);if(++gate->calls>2)throw std::runtime_error("Lookup was called more than once per node");gate->ready.notify_all();
    if(!gate->ready.wait_for(lock,std::chrono::seconds(45),[&]{return gate->calls==2&&gate->updates;}))throw std::runtime_error("Both controlled nodes did not overlap");return Value("REF-42");
  });lookup.execution("background");
  auto program=ax("question -> answer");program.add_tool(lookup);
  auto workflow=flow().execute("left",program).execute("right",program).returns(object({{"left","leftResult"},{"right","rightResult"}}));
  auto result=workflow.forward(*client,object({{"question","Call lookup exactly once. If its result is pending, return a brief progress message without calling it again. Return the exact reference when its result arrives."}}),object({{"control",control.value()},{"serviceTier","standard"},{"maxSteps",6}}));
  if(paths!=std::set<std::string>{"root/left","root/right"}||applied.size()!=3)throw std::runtime_error("Scoped controls did not apply");
  for(const auto* node:{"left","right"}){auto answer=stringify(Core::get(result,node));if(answer.find("REF-42")==std::string::npos||answer.find("VERIFIED")==std::string::npos)throw std::runtime_error("Missing final result: "+answer);}
  std::cout<<stringify(result)<<"\nParallel overlap verified; root steering and targeted reasoning applied.\n";
}
