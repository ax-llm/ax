// ax-example:start
// title: C++ Model Catalog
// group: generation
// description: Lists static models and named OpenAI-compatible profiles with portable thinking levels and service tiers.
// provider: openai-compatible
// env: none
// level: beginner
// order: 16
// ax-example:end
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

  std::cout << axllm::Core::iter(catalog).size()
            << " providers; Azure and OpenRouter named profiles are available\n";
}
