// docs:start signature-schema
#include "axllm/axllm.hpp"
#include <iostream>

int main() {
  axllm::Value sig = axllm::s("question:string -> answer:string");
  axllm::Value schema = axllm::to_json_schema(axllm::Core::get(sig, "outputs"));
  if (!axllm::Core::truthy(axllm::Core::get(axllm::Core::get(schema, "properties"), "answer"))) return 1;
  std::cout << "cpp-signature-schema-ok\n";
}
// docs:end signature-schema
