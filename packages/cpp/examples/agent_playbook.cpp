#include "axllm/axllm.hpp"

#include <iostream>

// The actor returns model-authored Python code and a real runtime executes it.
// The same offline response also satisfies the playbook reflector and curator.
struct ScriptedClient : axllm::AIClient {
  axllm::Value complete(axllm::Value) override {
    return axllm::object({{"content",
        "{\"pythonCode\":\"final('Answer', {'answer': 'Ax composes typed LLM programs.'})\","
        "\"answer\":\"Ax composes typed LLM programs.\","
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

struct RuntimeSession : axllm::AxCodeSession {
  axllm::Value execute(axllm::Value code, axllm::Value = axllm::Value::object()) override {
    if (axllm::display(code).find("pythonCode") != std::string::npos) {
      throw axllm::AxError("runtime", "runtime received a response wrapper instead of code");
    }
    return axllm::RuntimeEnvelope::final_payload({
        axllm::object({{"answer", "Ax composes typed LLM programs."}}),
    });
  }
  axllm::Value snapshot_globals(axllm::Value = axllm::Value::object()) override {
    return axllm::object({{"version", 1}, {"bindings", axllm::Value::object()}, {"globals", axllm::Value::object()}, {"closed", false}});
  }
  axllm::Value patch_globals(axllm::Value snapshot, axllm::Value = axllm::Value::object()) override { return snapshot; }
  axllm::Value close() override { return axllm::object({{"closed", true}}); }
};

struct Runtime : axllm::AxCodeRuntime {
  std::vector<std::unique_ptr<RuntimeSession>> sessions;
  std::string language() const override { return "Python"; }
  axllm::AxCodeSession* create_session(axllm::Value, axllm::Value = axllm::Value::object()) override {
    sessions.push_back(std::make_unique<RuntimeSession>());
    return sessions.back().get();
  }
};

int main() {
  ScriptedClient client;
  Runtime runtime;
  // agent.playbook() binds an evolving context playbook to an agent stage. The
  // "responder" target grows the user-facing answer stage; ACE remains an
  // implementation detail behind playbook(), just as optimize() hides GEPA.
  auto agent = axllm::agent("question:string -> answer:string", axllm::object({
      {"name", "qa"},
      {"description", "Answer the question."},
      {"runtime", axllm::Core::code_runtime_ref(runtime)},
  }));

  axllm::AxPlaybook& pb = agent.playbook(client, axllm::object({{"target", "responder"}, {"maxEpochs", 1}}));
  axllm::Value dataset = axllm::object({{"train", axllm::array({axllm::object({
      {"input", axllm::object({{"question", "Answer briefly."}})}, {"score", 0},
  })})}});

  // A zero minimum gain exercises verified acceptance. A positive minimum gain
  // rejects the same flat score and must restore the exact pre-proposal snapshot.
  axllm::Value accepted = pb.evolve(dataset, axllm::object({
      {"verify", true}, {"minHeldInGain", 0.0}, {"maxProposals", 1}, {"maxMetricCalls", 2},
  }));
  std::string before_rejection = axllm::stringify(pb.to_json());
  axllm::Value rejected = pb.evolve(dataset, axllm::object({
      {"verify", true}, {"minHeldInGain", 0.1}, {"maxProposals", 1}, {"maxMetricCalls", 2},
  }));
  std::string after_rejection = axllm::stringify(pb.to_json());

  axllm::Value accepted_outcome = axllm::Core::get(axllm::Core::get(accepted, "outcomes"), 0);
  axllm::Value rejected_outcome = axllm::Core::get(axllm::Core::get(rejected, "outcomes"), 0);
  if (std::stoul(axllm::display(axllm::Core::get(accepted, "metricCallsUsed", 0))) != 2 ||
      !axllm::Core::truthy(axllm::Core::get(accepted_outcome, "accepted", false))) return 1;
  if (std::stoul(axllm::display(axllm::Core::get(rejected, "metricCallsUsed", 0))) != 2 ||
      axllm::Core::truthy(axllm::Core::get(rejected_outcome, "accepted", true))) return 2;
  if (after_rejection != before_rejection) return 3;
  if (axllm::Core::get(pb.to_json(), "playbook", axllm::Value()).is_null()) return 4;
  std::cout << "accepted: " << axllm::stringify(accepted_outcome) << "\n";
  std::cout << "rejected: " << axllm::stringify(rejected_outcome) << "\n";
  std::cout << "cpp-agent-playbook-ok\n";
}
