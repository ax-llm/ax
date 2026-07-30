#include "axllm/axllm.hpp"
#include <chrono>
#include <iostream>

struct Script : axllm::Transport {
  std::vector<axllm::Value> responses; std::vector<axllm::Value> requests; std::size_t index=0;
  explicit Script(std::vector<axllm::Value> values):responses(std::move(values)){}
  axllm::Value call(axllm::Value request) override {requests.push_back(request);return responses.at(index++);}
  std::vector<std::string> methods()const{std::vector<std::string> out;for(auto request:requests)out.push_back(axllm::display(axllm::Core::get(request,"method")));return out;}
};
double now_ms(){return std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count();}
axllm::Value success(std::string text){return axllm::object({{"status",200},{"json",axllm::object({{"candidates",axllm::array({axllm::object({{"content",axllm::object({{"parts",axllm::array({axllm::object({{"text",text}})})}})},{"finishReason","STOP"}})})}})}});}
axllm::Value cache(std::string name,int seconds){return axllm::object({{"status",200},{"json",axllm::object({{"name",name},{"expireTime",now_ms()+seconds*1000}})}});}
axllm::Value failure(int status,std::string message){return axllm::object({{"status",status},{"json",axllm::object({{"error",axllm::object({{"message",message}})}})}});}
axllm::GoogleGeminiClient service(Script* script){return axllm::GoogleGeminiClient(axllm::object({{"model","gemini-3.5-flash"},{"api_key","gemini-key"},{"contextCache",axllm::object({{"minTokens",0},{"ttlSeconds",3600},{"refreshWindowSeconds",300}})}}),script);}
int main(){
 auto request=axllm::object({{"chat_prompt",axllm::array({axllm::object({{"role","system"},{"content","stable context"}}),axllm::object({{"role","user"},{"content","answer briefly"}})})}});
 Script recovery({cache("cachedContents/cache-1",3600),failure(400,"cachedContent is invalid"),success("uncached recovery")});auto recovery_client=service(&recovery);recovery_client.chat(request);if(recovery.methods()!=std::vector<std::string>({"POST","POST","POST"}))return 1;
 Script refresh({cache("cachedContents/old",1),success("old"),failure(500,"refresh failed"),cache("cachedContents/new",3600),success("recreated")});auto refresh_client=service(&refresh);refresh_client.chat(request);refresh_client.chat(request);if(refresh.methods()!=std::vector<std::string>({"POST","POST","PATCH","POST","POST"}))return 2;
 Script fallback({cache("cachedContents/old",1),success("old"),failure(500,"refresh failed"),failure(500,"recreate failed"),success("uncached fallback")});auto fallback_client=service(&fallback);fallback_client.chat(request);fallback_client.chat(request);if(fallback.methods()!=std::vector<std::string>({"POST","POST","PATCH","POST","POST"}))return 3;
 std::cout<<"cpp-context-cache-recovery-ok\n";
}
