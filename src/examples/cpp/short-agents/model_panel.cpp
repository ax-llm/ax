// ax-example:start
// title: C++ Multi-Model Panel
// group: short-agents
// description: Fans one question across three providers (OpenAI, Gemini, Anthropic), then judges the candidates and synthesizes a single grounded answer.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY, GOOGLE_APIKEY, ANTHROPIC_APIKEY
// level: advanced
// order: 40
// ax-example:end
#include "axllm/axllm.hpp"
#include <cstdlib>
#include <iostream>
#include <string>
#include <utility>
#include <vector>

static const char* env_or(const char* primary, const char* fallback) {
  const char* value = std::getenv(primary);
  if (value == nullptr || std::string(value).empty()) value = std::getenv(fallback);
  return value;
}

int main() {
  const char* openai_key = env_or("OPENAI_API_KEY", "OPENAI_APIKEY");
  const char* google_key = env_or("GOOGLE_APIKEY", "GOOGLE_API_KEY");
  const char* anthropic_key = env_or("ANTHROPIC_APIKEY", "ANTHROPIC_API_KEY");
  if (openai_key == nullptr || std::string(openai_key).empty() ||
      google_key == nullptr || std::string(google_key).empty() ||
      anthropic_key == nullptr || std::string(anthropic_key).empty()) {
    std::cerr << "Set OPENAI_APIKEY, GOOGLE_APIKEY, and ANTHROPIC_APIKEY to run this multi-provider panel.\n";
    return 2;
  }

  // A panel of three different providers, each answering the same question
  // independently. Plain ax() composition (no agent runtime): fan out to the
  // panel, judge the candidates, then synthesize one grounded answer.
  axllm::OpenAICompatibleClient openai(axllm::object({
      {"api_key", openai_key},
      {"model", "gpt-5.4-mini"},
      {"model_config", axllm::object({{"temperature", 0}})},
  }));
  axllm::GoogleGeminiClient gemini(axllm::object({
      {"api_key", google_key},
      {"model", "gemini-3.5-flash"},
  }));
  axllm::AnthropicClient anthropic(axllm::object({
      {"api_key", anthropic_key},
      {"model", "claude-haiku-4-5"},
  }));

  std::vector<std::pair<std::string, axllm::AIClient*>> panel = {
      {"openai/gpt-5.4-mini", &openai},
      {"google/gemini-3.5-flash", &gemini},
      {"anthropic/claude-haiku-4.5", &anthropic},
  };

  auto researcher = axllm::ax("question:string -> answer:string, keyFindings:string[], citations:string[], confidence:number");
  researcher.set_instruction("Answer independently. Use evidence. Call out uncertainty. Do not optimize for consensus.");

  auto judge = axllm::ax("question:string, candidates:json -> consensus:string[], contradictions:string[], uniqueInsights:string[], blindSpots:string[]");
  judge.set_instruction("Compare the candidates. Find agreement, conflicts, missing coverage, and unique useful points.");

  auto synthesizer = axllm::ax("question:string, candidates:json, review:json -> answer:string, citations:string[], caveats:string[]");
  synthesizer.set_instruction("Write one final answer grounded in the candidates and review. Resolve conflicts explicitly.");

  std::string question = "What are the strongest arguments for and against a national carbon tax?";

  // Each panelist is a different provider answering independently.
  axllm::Value candidates = axllm::Value::array();
  for (const auto& member : panel) {
    axllm::Value response = researcher.forward(*member.second, axllm::object({{"question", question}}));
    axllm::Value candidate = axllm::Core::map_merge(axllm::object({{"model", member.first}}), response);
    axllm::Core::append(candidates, candidate);
  }

  // The judge + synthesizer run on one of the panel clients (OpenAI here).
  axllm::AIClient& orchestrator = openai;
  axllm::Value review = judge.forward(orchestrator, axllm::object({{"question", question}, {"candidates", candidates}}));
  axllm::Value final = synthesizer.forward(
      orchestrator,
      axllm::object({{"question", question}, {"candidates", candidates}, {"review", review}}));

  std::cout << axllm::stringify(final) << "\n";
}
