// ax-example:start
// title: C++ Decision Evidence Reranking
// group: generation
// description: Ranks documents through Ax signatures while retaining decision evidence and candidate IDs.
// provider: openai-decisions
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: intermediate
// order: 46
// ax-example:end
#include "axllm/axllm.hpp"
#include <algorithm>
#include <cstdlib>
#include <iostream>
#include <stdexcept>
using namespace axllm;

int main() {
  const char* key=std::getenv("OPENAI_API_KEY"); if(!key)key=std::getenv("OPENAI_APIKEY"); if(!key)throw std::runtime_error("Set OPENAI_API_KEY or OPENAI_APIKEY");
  auto model=ai("openai-decisions",object({{"api_key",key}}));
  auto judge=ax("query:string, document:string -> relevant:boolean(evidence, threshold 0.7), relevance:score \"Irrelevant, Related, Partial answer, Direct answer\"(evidence)");
  std::vector<Value> ranked;
  for(auto item: std::vector<std::pair<std::string,std::string>>{{"refund","Request a refund within 30 days through your account billing page."},{"password","Reset your password using the sign-in page."}}) {
    auto result=judge.forward(*model,object({{"query","How do I request a refund?"},{"document",item.second}}));
    Core::set(result,"id",item.first); ranked.push_back(result);
  }
  std::stable_sort(ranked.begin(),ranked.end(),[](Value a,Value b){return Core::number(Core::get(Core::get(a,"relevance"),"value"))>Core::number(Core::get(Core::get(b,"relevance"),"value"));});
  Value output=Value::array(); for(auto result:ranked)Core::append(output,result);
  std::cout<<stringify(output)<<"\n";
}
