// ax-example:start
// title: C++ Agent Playbook — Learn And Verify
// group: optimization
// description: Attach a persistent playbook, add validated hidden citations and stage guidance, then mine a task set into playbook rules with a verification gate.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: advanced
// order: 42
// ax-example:end
#include "axllm/axllm.hpp"
#include "axllm/runtime/quickjs/quickjs_runtime.hpp"

#include <cstdlib>
#include <iostream>
#include <string>

int main() {
  const char* key = std::getenv("OPENAI_API_KEY");
  if (key == nullptr || std::string(key).empty()) key = std::getenv("OPENAI_APIKEY");
  if (key == nullptr || std::string(key).empty()) {
    std::cerr << "Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.\n";
    return 2;
  }
  const char* model = std::getenv("AX_OPENAI_MODEL");
  axllm::OpenAICompatibleClient client(axllm::object({
      {"api_key", key},
      {"model", model == nullptr || std::string(model).empty() ? "gpt-5.4-mini" : model},
  }));

  axllm::Value bullet = axllm::object({
      {"id", "failures-to-avoid-00001"},
      {"section", "failures_to_avoid"},
      {"content", "Check the available evidence before answering."},
      {"helpfulCount", 0},
      {"harmfulCount", 0},
      {"createdAt", "2026-07-15T00:00:00.000Z"},
      {"updatedAt", "2026-07-15T00:00:00.000Z"},
  });
  axllm::Value seed = axllm::object({
      {"playbook", axllm::object({
          {"version", 1},
          {"sections", axllm::object({{"failures_to_avoid", axllm::array({bullet})}})},
          {"updatedAt", "2026-07-15T00:00:00.000Z"},
      })},
      {"artifact", axllm::object({{"feedback", axllm::array({})}, {"history", axllm::array({})}})},
  });

  auto assistant = axllm::agent(
      "question:string -> answer:string",
      axllm::object({
          {"contextFields", axllm::array({})},
          {"runtime", axllm::object({{"language", "JavaScript"}})},
          {"playbook", axllm::object({{"seed", seed}})},
          {"citations", axllm::object({{"surface", "hidden"}})},
      }));
  assistant
      .set_instruction("Answer from evidence and state uncertainty plainly.")
      .add_actor_instruction("Before finishing, verify the answer against the collected evidence.");

  axllm::Value observed_citations = axllm::array({});
  axllm::Value last_playbook_update;
  assistant.set_citations_observer([&observed_citations](axllm::Value value) {
    observed_citations = value;
  });
  assistant.set_playbook_observer([&last_playbook_update](axllm::Value value) {
    last_playbook_update = value;
  });

  axllm::runtime::quickjs::QuickJsCodeRuntime runtime;
  axllm::Value answer = assistant.forward(
      client,
      axllm::object({{"question", "What should a support agent verify before answering?"}}),
      axllm::object({
          {"runtime", axllm::Core::code_runtime_ref(runtime)},
          {"max_actor_steps", 8},
      }));

  axllm::Value dataset = axllm::object({
      {"train", axllm::array({axllm::object({
          {"input", axllm::object({{"question", "Give a concise evidence-first answer."}})},
          {"score", 0},
      })})},
  });
  axllm::Value evolution = assistant.get_playbook()->evolve(
      dataset,
      axllm::object({
          {"verify", true},
          {"maxProposals", 1},
          {"runtime", axllm::Core::code_runtime_ref(runtime)},
      }));

  std::cout << axllm::stringify(answer) << "\n";
  std::cout << "citations: " << axllm::stringify(observed_citations) << "\n";
  std::cout << "run-end update observed: " << (!last_playbook_update.is_null()) << "\n";
  std::cout << "outcomes: " << axllm::stringify(axllm::Core::get(evolution, "outcomes")) << "\n";
  std::cout << assistant.get_playbook()->render() << "\n";
}
