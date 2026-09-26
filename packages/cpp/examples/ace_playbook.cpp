#include "axllm/axllm.hpp"

#include <iostream>
#include <string>

// A scripted client stands in for a real provider so this example runs without a
// key. Swap it for axllm::ai("openai", ...) to grow a playbook against a live
// model. Each program answers in its own output format, chosen by the output
// wire keys in its prompt: the bound program, then the playbook's reflector and
// curator, so the full ACE loop is exercised offline.
struct ScriptedClient : axllm::AIClient {
  axllm::Value complete(axllm::Value request) override {
    const std::string prompt = axllm::stringify(axllm::Core::get(request, "chat_prompt"));
    const std::string tick(1, static_cast<char>(96));
    auto outputs = [&](const std::string& key) {
      return prompt.find("(wire key: " + tick + key + tick + ")") != std::string::npos;
    };
    std::string content = "Answer: Ax composes typed LLM programs.";
    if (outputs("errorIdentification")) {
      content =
          "Reasoning: The playbook lacked a brevity rule.\n"
          "Error Identification: Answer was too verbose.\n"
          "Root Cause Analysis: No guidance on conciseness.\n"
          "Correct Approach: Add a concise-answer guideline.\n"
          "Key Insight: Prefer one-sentence answers.\n"
          "Bullet Tags: []";
    } else if (outputs("operations")) {
      content =
          "Reasoning: The playbook lacked a brevity rule.\n"
          "Operations: [{\"type\": \"ADD\", \"section\": \"Guidelines\", \"content\": \"Answer in one concise sentence.\"}]";
    }
    return axllm::object({{"content", content}});
  }
};

int main() {
  ScriptedClient client;
  auto program = axllm::ax("question:string -> answer:string", axllm::object({{"id", "qa"}, {"instruction", "Answer the question."}}));

  axllm::AxPlaybook pb = axllm::playbook(program, client, axllm::object({{"maxEpochs", 1}}));

  axllm::AxPlaybook::MetricFn metric = [](const axllm::Value& args) -> axllm::Value {
    axllm::Value prediction = axllm::Core::get(args, "prediction");
    std::string answer = axllm::display(axllm::Core::get(prediction, "answer"));
    return answer.empty() ? axllm::Value(0.0) : axllm::Value(1.0);
  };

  std::vector<axllm::Value> examples = {
      axllm::object({{"question", "What is Ax?"}}),
      axllm::object({{"question", "Why typed signatures?"}}),
  };
  axllm::Value result = pb.evolve(examples, metric);
  std::string rendered = pb.render();
  axllm::Value state = pb.to_json();
  if (axllm::Core::get(result, "bestScore", axllm::Value()).is_null()) return 1;
  if (axllm::Core::get(state, "playbook", axllm::Value()).is_null()) return 1;
  if (rendered.find("Answer in one concise sentence.") == std::string::npos) {
    std::cerr << "the playbook did not grow: " << rendered << "\n";
    return 1;
  }
  std::cout << "rendered: " << rendered << "\n";
  std::cout << "cpp-ace-playbook-ok\n";
}
