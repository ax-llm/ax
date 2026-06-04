#include "axllm/axllm.hpp"
#include <iostream>

int main() {
  axllm::Value signature = axllm::s("question:string -> answer:string");
  axllm::Value schema = axllm::to_json_schema(axllm::Core::get(signature, "outputs"));

  std::cout << axllm::stringify(schema) << "\n";
}
