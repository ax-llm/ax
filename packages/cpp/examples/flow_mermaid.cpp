#include "axllm/axllm.hpp"
#include <iostream>

int main() {
  const std::string source = R"(flowchart TD
  %%ax classify: requestText:string -> route:class "support, sales"
  %%ax reply: requestText:string -> replyText:string(max 300)
  classify{route} -->|support| reply)";
  auto program = axllm::flow(source);
  const std::string rendered = program.str();
  if (rendered.find("%%ax reply: requestText:string -> replyText:string(max 300)") == std::string::npos) return 1;
  if (rendered.find("classify -->|support| reply") == std::string::npos) return 2;
  if (axllm::flow(rendered).str() != rendered) return 3;
  std::cout << "cpp-flow-mermaid-ok\n";
}
