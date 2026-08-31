#include "axllm/axllm.hpp"
#include <iostream>
#include <stdexcept>
#include <string>

axllm::Value provider(const axllm::Value& catalog, const std::string& name) {
  for (const auto& entry : axllm::Core::iter(catalog)) {
    if (axllm::display(axllm::Core::get(entry, "name")) == name) return entry;
  }
  throw std::runtime_error("missing provider " + name);
}

int main() {
  const auto catalog = axllm::get_supported_ai_models();
  const auto azure = provider(catalog, "azure-openai");
  const auto openrouter = provider(catalog, "openrouter");
  const auto azure_capabilities = axllm::Core::get(azure, "capabilities");
  const auto openrouter_capabilities = axllm::Core::get(openrouter, "capabilities");

  if (!axllm::equal(axllm::Core::get(azure, "isDynamic"), true)) return 2;
  if (!axllm::Core::iter(axllm::Core::get(azure, "models")).empty()) return 3;
  if (axllm::Core::iter(axllm::Core::get(azure_capabilities, "thinkingLevels")).empty()) return 4;
  if (axllm::Core::iter(axllm::Core::get(openrouter_capabilities, "serviceTiers")).size() != 3) return 5;
  provider(axllm::get_supported_ai_models(axllm::object({{"type", "text"}})), "azure-openai");

  std::cout << "cpp-model-catalog-ok\n";
}
