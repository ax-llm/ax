// ax-example:start
// title: C++ Codebase Q&A with a Peek Context Map
// group: long-agents
// description: Answers several dependency questions over one large module index by building and reusing an evolving context map (the "peek" orientation cache), so later questions skip re-scanning the corpus.
// provider: google-gemini
// env: GOOGLE_APIKEY
// level: advanced
// order: 20
// ax-example:end
#include "axllm/axllm.hpp"
#include "axllm/runtime/quickjs/quickjs_runtime.hpp"
#include <cstdlib>
#include <iostream>
#include <string>
#include <vector>

struct Module {
  std::string path;
  std::vector<std::string> imports;
  std::string writes;
};

// ---------------------------------------------------------------------------
// A large module-dependency index for a monorepo. Each block is a record the
// agent must *search* to answer -- the answers cannot be guessed, only computed
// by filtering the index. Generated large so it would not fit comfortably in a
// prompt; it lives in contextFields and is queried from the runtime.
// ---------------------------------------------------------------------------
static std::vector<Module> build_module_index() {
  std::vector<Module> modules = {
      {"packages/api/middleware/auth.ts", {"packages/shared"}, "-"},
      {"packages/api/middleware/rateLimit.ts", {"packages/db"}, "-"},
      {"packages/api/routes/checkout.ts", {"packages/api/middleware/auth.ts", "packages/services/orders/createOrder.ts", "packages/services/payments/charge.ts"}, "-"},
      {"packages/api/routes/search.ts", {"packages/api/middleware/auth.ts", "packages/services/catalog/searchCatalog.ts"}, "-"},
      {"packages/services/orders/createOrder.ts", {"packages/db", "packages/clients/bus"}, "orders"},
      {"packages/services/orders/orderRepo.ts", {"packages/db"}, "orders"},
      {"packages/services/payments/charge.ts", {"packages/clients/acquirer", "packages/db"}, "payments"},
      {"packages/services/payments/refund.ts", {"packages/clients/acquirer", "packages/db"}, "refunds"},
      {"packages/services/catalog/searchCatalog.ts", {"packages/db"}, "-"},
      {"packages/clients/acquirer/index.ts", {"packages/shared"}, "-"},
      {"packages/clients/bus/index.ts", {"packages/shared"}, "-"},
  };
  // Filler modules so the index is genuinely large; some also depend on the acquirer.
  for (int i = 0; i < 110; ++i) {
    Module m;
    m.path = "packages/services/feature" + std::to_string(i) + "/handler.ts";
    m.imports = {i % 4 == 0 ? "packages/clients/acquirer" : "packages/db", "packages/shared"};
    m.writes = i % 6 == 0 ? "audit" : "-";
    modules.push_back(m);
  }
  return modules;
}

int main() {
  const char* key = std::getenv("GOOGLE_APIKEY");
  if (key == nullptr || std::string(key).empty()) {
    std::cerr << "Set GOOGLE_APIKEY to run this example.\n";
    return 2;
  }
  const char* model = std::getenv("AX_GEMINI_MODEL");
  axllm::GoogleGeminiClient client(axllm::object({
      {"api_key", key},
      {"model", model == nullptr || std::string(model).empty() ? "gemini-3.5-flash" : model},
  }));

  std::vector<Module> modules = build_module_index();
  std::string codebase_index;
  for (std::size_t idx = 0; idx < modules.size(); ++idx) {
    const Module& m = modules[idx];
    std::string imports;
    for (std::size_t j = 0; j < m.imports.size(); ++j) {
      if (j > 0) imports += ", ";
      imports += m.imports[j];
    }
    if (idx > 0) codebase_index += "\n\n";
    codebase_index += "PATH: " + m.path + "\nIMPORTS: " + imports + "\nWRITES: " + m.writes;
  }
  std::cout << "Module index: " << modules.size() << " records (kept out of the prompt).\n";

  auto analyst = axllm::agent(
      "context:string, question:string -> answer:string, paths:string[] \"Exact PATH values from the index that answer the question\"",
      axllm::object({
          {"contextFields", axllm::array({"context"})},
          {"contextPolicy", axllm::object({{"preset", "adaptive"}, {"budget", "balanced"}})},
          {"contextOptions", axllm::object({
              {"description", "The context is a module index of \"PATH / IMPORTS / WRITES\" records. Answer by filtering those records in code -- never guess. Return exact PATH values verbatim."},
          })},
          // The Peek context map: small, persistent orientation reused across queries.
          {"contextMap", axllm::object({{"maxChars", 1800}, {"infiniteEvolve", false}, {"evolveSteps", 1}})},
          {"runtime", axllm::object({{"language", "JavaScript"}})},
      }));

  std::vector<std::string> questions = {
      "Which modules import 'packages/clients/acquirer'? Give the exact PATH values.",
      "Which modules write to the 'orders' table?",
      "What are the direct IMPORTS of packages/api/routes/checkout.ts?",
  };

  axllm::runtime::quickjs::QuickJsCodeRuntime runtime;
  for (const std::string& question : questions) {
    axllm::Value output = analyst.forward(
        client,
        axllm::object({{"context", codebase_index}, {"question", question}}),
        axllm::object({{"runtime", axllm::Core::code_runtime_ref(runtime)}, {"max_actor_steps", 24}}));

    axllm::Value paths = axllm::Core::get(output, "paths", axllm::Value::array());
    std::string paths_text;
    for (const auto& p : axllm::Core::iter(paths)) {
      if (!paths_text.empty()) paths_text += ", ";
      paths_text += axllm::display(p);
    }
    std::cout << "\nQ: " << question << "\n";
    std::cout << "A: " << axllm::display(axllm::Core::get(output, "answer", "")) << "\n";
    std::cout << "Paths: " << paths_text << "\n";
  }

  std::cout << "\nThe context map evolved on the first query and was reused for the rest.\n";
}
