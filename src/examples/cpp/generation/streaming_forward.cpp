// ax-example:start
// title: C++ Streaming Field Deltas
// group: generation
// description: Streams AxGen output as TypeScript-style {version, index, delta} field deltas and merges them as they arrive.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: intermediate
// order: 46
// ax-example:end
#include "axllm/axllm.hpp"
#include <cstdint>
#include <cstdlib>
#include <iostream>
#include <string>

int main() {
  const char* api_key = std::getenv("OPENAI_API_KEY");
  if (api_key == nullptr || std::string(api_key).empty()) api_key = std::getenv("OPENAI_APIKEY");
  if (api_key == nullptr || std::string(api_key).empty()) {
    std::cerr << "Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.\n";
    return 2;
  }
  const char* selected = std::getenv("AX_OPENAI_MODEL");
  std::string model = selected == nullptr || std::string(selected).empty() ? "gpt-5.4-mini" : selected;
  auto client = axllm::ai("openai", axllm::object({{"api_key", api_key}, {"model", model}}));
  auto story = axllm::ax(R"(topic:string -> title:string, story:string "Three short sentences")");

  // Each delta holds the new text of one field. Merge a sample's deltas
  // (strings append, other values replace) and start over when the version
  // changes: a retry or a replaced step starts a new version.
  axllm::Value merged = axllm::Value::object();
  int64_t version = 0;
  story.streaming_forward(
      *client, axllm::object({{"topic", "a lighthouse keeper's cat"}}), axllm::Value::object(),
      [&](const axllm::AxGenDelta& delta) {
        if (delta.version != version) {
          merged = axllm::Value::object();
          version = delta.version;
          std::cout << "\n[retry: starting over]\n";
        }
        for (const auto& key : axllm::Core::iter(delta.delta)) {
          std::string field = axllm::display(key);
          axllm::Value value = axllm::Core::get(delta.delta, field);
          axllm::Value previous = axllm::Core::get(merged, field);
          if (value.is_string() && (previous.is_null() || previous.is_string())) {
            axllm::Core::set(merged, field, axllm::display(previous) + axllm::display(value));
          } else {
            axllm::Core::set(merged, field, value);
          }
          if (field == "story" && value.is_string()) std::cout << axllm::display(value) << std::flush;
        }
        return true;  // return false to stop the run
      });
  std::cout << "\nTitle: " << axllm::display(axllm::Core::get(merged, "title")) << "\n";
}
