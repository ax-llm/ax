#include "axllm/axllm.hpp"

#include <iostream>

// A scripted client stands in for a real provider so this example runs without a
// key. Swap it for axllm::ai("openai", ...) to grow a playbook against a live
// model. The canned JSON satisfies the bound program AND the playbook's internal
// reflector/curator sub-programs, so the full ACE loop is exercised offline.
struct ScriptedClient : axllm::AIClient {
  axllm::Value complete(axllm::Value) override {
    return axllm::object({{"content",
        "{\"answer\":\"Ax composes typed LLM programs.\","
        "\"reasoning\":\"The playbook lacked a brevity rule.\","
        "\"errorIdentification\":\"Answer was too verbose.\","
        "\"rootCauseAnalysis\":\"No guidance on conciseness.\","
        "\"correctApproach\":\"Add a concise-answer guideline.\","
        "\"keyInsight\":\"Prefer one-sentence answers.\","
        "\"weaknessDescription\":\"The agent does not verify its final step.\","
        "\"rootCause\":\"The final step is accepted without a check.\","
        "\"proposedGuidance\":\"Verify the final step before completing the task.\","
        "\"evidenceQuotes\":[\"final\",\"snapshot\",\"Answer\"],"
        "\"configRecommendations\":[],"
        "\"bulletTags\":[],"
        "\"operations\":[{\"type\":\"ADD\",\"section\":\"Guidelines\",\"content\":\"Answer in one concise sentence.\"}]}"}});
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
  std::cout << "rendered: " << rendered << "\n";
  std::cout << "cpp-ace-playbook-ok\n";
}
