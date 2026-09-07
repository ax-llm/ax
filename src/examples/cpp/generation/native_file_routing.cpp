// ax-example:start
// title: C++ Native File Routing
// group: generation
// description: Summarizes a PDF through a provider router without replacing the native file with extracted text.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY, AX_PDF_BASE64
// level: intermediate
// order: 53
// ax-example:end
#include "axllm/axllm.hpp"
#include <cstdlib>
#include <iostream>
int main() {
 using namespace axllm;
 const char* key=std::getenv("OPENAI_API_KEY");if(!key)key=std::getenv("OPENAI_APIKEY");const char* pdf=std::getenv("AX_PDF_BASE64");
 if(!key||!pdf){std::cerr<<"Set OPENAI_API_KEY and AX_PDF_BASE64.\n";return 2;}
 auto client=ai("openai",object({{"api_key",key},{"model","gpt-6-astra"},{"model_config",object({{"thinkingTokenBudget","low"}})}}));
 ProviderRouter router(std::vector<std::shared_ptr<AxAIService>>{client});
 auto program=ax("document:file -> summary:string");
 auto result=program.forward(router,object({{"document",object({{"filename","report.pdf"},{"mimeType","application/pdf"},{"data",pdf}})}}),object({{"serviceTier","standard"}}));
 std::cout<<stringify(result)<<"\n";
}
