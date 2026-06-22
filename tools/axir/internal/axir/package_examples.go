package axir

const pySignatureSchemaExample = `from axllm import s

sig = s("question:string -> answer:string")
schema = sig.to_json_schema("outputs")
assert "answer" in schema["properties"], schema
print("python-signature-schema-ok")
`

const pyAxGenScriptedClientToolExample = `from axllm import ax, f, fn


class ScriptedClient:
    def __init__(self):
        self.calls = 0

    def complete(self, request):
        self.calls += 1
        if self.calls == 1:
            return {
                "content": "",
                "function_calls": [
                    {"id": "call_1", "name": "search", "params": {"query": "ax docs"}}
                ],
            }
        return {"content": "{\"answer\":\"Found Ax docs\"}"}


search = (
    fn("search")
    .description("Search docs")
    .arg("query", f.string().min(1))
    .handler(lambda args: {"title": "Ax docs"})
    .build()
)

qa = ax("query:string -> answer:string", {"functions": [search]})
qa.add_assert({"field": "answer", "contains": "Ax", "message": "answer should mention Ax"})
qa.add_field_processor("answer", "trim")
out = qa.forward(ScriptedClient(), {"query": "ax docs"})
assert out == {"answer": "Found Ax docs"}, out
assert qa.get_traces()[-1]["output"] == out
print("python-axgen-ok")
`

const pyAxGenOpenAIExample = `import json
import os

from axllm import OpenAICompatibleClient, ax


api_key = os.getenv("OPENAI_API_KEY") or os.getenv("OPENAI_APIKEY")
if not api_key:
    raise SystemExit("Set OPENAI_API_KEY to run this provider API example.")

client = OpenAICompatibleClient(
    api_key=api_key,
    model=os.getenv("AX_OPENAI_MODEL", "gpt-4.1-mini"),
    model_config={"temperature": 0},
)
program = ax("question:string -> answer:string")
out = program.forward(
    client,
    {
        "question": "In one sentence, explain Ax as a language-agnostic LLM programming library."
    },
)
print(json.dumps(out, indent=2, sort_keys=True))
`

const pyProviderMappingNoKeyExample = `from axllm import ai


def scripted_transport(request):
    return {
        "status": 200,
        "json": {
            "id": "chatcmpl_example",
            "model": "gpt-4.1-mini",
            "choices": [
                {
                    "index": 0,
                    "finish_reason": "stop",
                    "message": {"content": "hello from scripted transport"},
                }
            ],
            "usage": {"prompt_tokens": 1, "completion_tokens": 2, "total_tokens": 3},
        },
    }


service = ai("openai", model="gpt-4.1-mini", api_key="test-key", transport=scripted_transport)
response = service.chat({"chat_prompt": [{"role": "user", "content": "hello"}]})
assert response["results"][0]["content"] == "hello from scripted transport", response
print("python-axai-ok")
`

const pyAxFlowProgramGraphExample = `from axllm import ax, flow


class ScriptedClient:
    def complete(self, request):
        return {"content": "{\"answer\":\"Paris\"}"}


qa = ax("question:string -> answer:string")
program = flow({"id": "example.flow"}).execute("qa", qa).returns({"answer": "answer"})
out = program.forward(ScriptedClient(), {"question": "Capital of France?"})
assert out == {"answer": "Paris"}, out
assert program.get_plan()["steps"][0]["name"] == "qa"
print("python-axflow-ok")
`

const pyRuntimeAdapterExample = `from axllm import AxCodeRuntime, AxCodeSession, RuntimeCapabilities, RuntimeEnvelope, agent


class DemoSession(AxCodeSession):
    def __init__(self, globals, options=None):
        self.globals = dict(globals or {})
        self.create_options = dict(options or {})
        self.closed = False

    def execute(self, code, options=None):
        assert "reservedNames" in (options or {}), options
        if code == "timeout()":
            return RuntimeEnvelope.timeout("demo timeout")
        self.globals["answer"] = "runtime"
        return RuntimeEnvelope.final({"answer": self.globals["answer"]})

    def inspect_globals(self, options=None):
        return dict(self.globals)

    def snapshot_globals(self, options=None):
        return {"version": 1, "bindings": dict(self.globals), "globals": dict(self.globals), "closed": self.closed}

    def patch_globals(self, snapshot, options=None):
        self.globals = dict((snapshot or {}).get("bindings") or {})
        return self.snapshot_globals(options)

    def close(self):
        self.closed = True
        return {"closed": True}


class DemoRuntime(AxCodeRuntime):
    language = "Python"

    def __init__(self):
        self.capabilities = RuntimeCapabilities(language="Python", snapshot=True, patch=True).to_dict()
        self.sessions = []

    def create_session(self, globals, options=None):
        session = DemoSession(globals, options)
        self.sessions.append(session)
        return session


runtime = DemoRuntime()
qa = agent("question:string -> answer:string", {"runtime": {"language": "Python"}})
out = qa.test(runtime, "final()", {"question": "adapter"})
assert out["kind"] == "final", out
assert runtime.sessions[-1].closed

runner = agent("question:string -> answer:string", {"runtime": {"language": "Python"}})
step = runner.execute_actor_step(runtime, "final()", {"question": "adapter"})
assert step["kind"] == "final", step
snapshot = runner.export_session_state()
runner.restore_session_state(snapshot)
timeout = runner.execute_actor_step(runtime, "timeout()", {"question": "adapter"})
assert timeout["error_category"] == "timeout", timeout
print("python-runtime-adapter-ok")
`

const pyRuntimeProtocolExample = `import os
from pathlib import Path

from axllm import ProcessCodeRuntime, agent


repo_root = Path(os.environ["AXIR_REPO_ROOT"])
server = os.environ["AXIR_AXJS_RUNTIME_SERVER"]
runtime = ProcessCodeRuntime(
    ["node", "--import=tsx", server],
    cwd=str(repo_root),
)
try:
    qa = agent("question:string -> answer:string", {"runtime": {"language": "JavaScript"}})
    out = qa.test(runtime, "answer = inputs.question; await final({ answer })", {"question": "protocol"})
    assert out["kind"] == "final", out
    assert out["completion_payload"]["args"][0]["answer"] == "protocol", out

    runner = agent("question:string -> answer:string", {"runtime": {"language": "JavaScript"}})
    step = runner.execute_actor_step(runtime, "answer = 'persisted'; await final({ answer })", {"question": "protocol"})
    assert step["kind"] == "final", step
    snapshot = runner.export_session_state()
    assert "bindings" in snapshot, snapshot
    runner.restore_session_state(snapshot)
    inspected = runner.inspect_runtime()
    assert "persisted" in str(inspected), inspected
    closed = runner.close_runtime_session()
    assert closed["closed"], closed
finally:
    runtime.shutdown()

print("python-runtime-protocol-ok")
`

const pyOptimizerArtifactExample = `import json

from axllm import OptimizerEngine, ax


class ScriptedOptimizer(OptimizerEngine):
    name = "fixture"
    version = "1"

    def optimize(self, request, evaluator=None):
        return {
            "componentMap": {"qa::instruction": "Prefer artifact-backed answers."},
            "metadata": {
                "evidence": {"avg": 1},
                "provenance": {"sourceProgramKind": "axgen"},
            },
        }


qa = ax("question:string -> answer:string", {"id": "qa", "instruction": "Base."})
artifact = qa.optimize_with(ScriptedOptimizer(), [], {"apply": False})
assert any(item["id"] == "qa::instruction" and item["current"] == "Base." for item in qa.get_optimizable_components())
qa.apply_optimization(json.dumps(artifact))
assert any(
    item["id"] == "qa::instruction" and item["current"] == "Prefer artifact-backed answers."
    for item in qa.get_optimizable_components()
)
print("python-optimizer-artifact-ok")
`

const javaSignatureSchemaExample = `import dev.axllm.ax.*;
import java.util.*;

public final class SignatureSchemaExample {
  public static void main(String[] args) {
    AxSignature sig = Ax.s("question:string -> answer:string");
    Map<String, Object> schema = sig.toJsonSchema("outputs", Map.of());
    Map<?, ?> properties = (Map<?, ?>) schema.get("properties");
    if (!properties.containsKey("answer")) throw new RuntimeException("bad schema: " + schema);
    System.out.println("java-signature-schema-ok");
  }
}
`

const javaAxGenScriptedClientToolExample = `import dev.axllm.ax.*;
import java.util.*;

public final class AxGenScriptedClientToolExample {
  static final class ScriptedClient implements AiClient {
    int calls = 0;

    public Map<String, Object> complete(Map<String, Object> request) {
      calls += 1;
      if (calls == 1) {
        return Map.of(
          "content", "",
          "function_calls", List.of(Map.of("id", "call_1", "name", "search", "params", Map.of("query", "ax docs")))
        );
      }
      return Map.of("content", "{\"answer\":\"Found Ax docs\"}");
    }
  }

  public static void main(String[] args) {
    Tool search = Ax.fn("search")
      .description("Search docs")
      .arg("query", Ax.f().string().min(1))
      .handler(values -> Map.of("title", "Ax docs"))
      .build();
    AxGen qa = Ax.ax("query:string -> answer:string")
      .addTool(search)
      .addAssert(Map.of("field", "answer", "contains", "Ax", "message", "answer should mention Ax"))
      .addFieldProcessor("answer", "trim");
    Map<String, Object> out = qa.forward(new ScriptedClient(), Map.of("query", "ax docs"));
    if (!"Found Ax docs".equals(out.get("answer"))) throw new RuntimeException("bad output: " + out);
    if (qa.getTraces().isEmpty()) throw new RuntimeException("missing trace");
    System.out.println("java-axgen-ok");
  }
}
`

const javaAxGenOpenAIExample = `import dev.axllm.ax.*;
import java.util.*;

public final class AxGenOpenAIExample {
  public static void main(String[] args) throws Exception {
    String apiKey = System.getenv("OPENAI_API_KEY");
    if (apiKey == null || apiKey.isBlank()) apiKey = System.getenv("OPENAI_APIKEY");
    if (apiKey == null || apiKey.isBlank()) {
      throw new IllegalStateException("Set OPENAI_API_KEY to run this provider API example.");
    }
    OpenAICompatibleClient client = new OpenAICompatibleClient(Map.of(
      "api_key", apiKey,
      "model", System.getenv().getOrDefault("AX_OPENAI_MODEL", "gpt-4.1-mini"),
      "model_config", Map.of("temperature", 0.0)
    ));
    AxGen program = Ax.ax("question:string -> answer:string");
    Map<String, Object> out = program.forward(client, Map.of(
      "question", "In one sentence, explain Ax as a language-agnostic LLM programming library."
    ));
    System.out.println(out);
  }
}
`

const javaProviderMappingNoKeyExample = `import dev.axllm.ax.*;
import java.util.*;

public final class ProviderMappingNoKeyExample {
  public static void main(String[] args) throws Exception {
    OpenAICompatibleClient.Transport transport = request -> Map.of(
      "status", 200,
      "json", Map.of(
        "id", "chatcmpl_example",
        "model", "gpt-4.1-mini",
        "choices", List.of(Map.of(
          "index", 0,
          "finish_reason", "stop",
          "message", Map.of("content", "hello from scripted transport")
        )),
        "usage", Map.of("prompt_tokens", 1, "completion_tokens", 2, "total_tokens", 3)
      )
    );
    AxAIService service = Ax.ai("openai", Map.of("model", "gpt-4.1-mini", "api_key", "test-key", "transport", transport));
    Map<String, Object> response = service.chat(Map.of("chat_prompt", List.of(Map.of("role", "user", "content", "hello"))));
    List<?> results = (List<?>) response.get("results");
    Map<?, ?> first = (Map<?, ?>) results.get(0);
    if (!"hello from scripted transport".equals(first.get("content"))) {
      throw new RuntimeException("bad response: " + response);
    }
    System.out.println("java-axai-ok");
  }
}
`

const javaAxFlowProgramGraphExample = `import dev.axllm.ax.*;
import java.util.*;

public final class AxFlowProgramGraphExample {
  static final class ScriptedClient implements AiClient {
    public Map<String, Object> complete(Map<String, Object> request) {
      return Map.of("content", "{\"answer\":\"Paris\"}");
    }
  }

  public static void main(String[] args) {
    AxGen qa = Ax.ax("question:string -> answer:string");
    AxFlow program = Ax.flow(Map.of("id", "example.flow")).execute("qa", qa).returns(Map.of("answer", "answer"));
    Map<String, Object> out = program.forward(new ScriptedClient(), Map.of("question", "Capital of France?"));
    if (!"Paris".equals(out.get("answer"))) throw new RuntimeException("bad output: " + out);
    if (!"qa".equals(((Map<?, ?>) ((List<?>) program.getPlan().get("steps")).get(0)).get("name"))) throw new RuntimeException("bad plan");
    System.out.println("java-axflow-ok");
  }
}
`

const javaRuntimeAdapterExample = `import dev.axllm.ax.*;
import java.util.*;

public final class RuntimeAdapterExample {
  @SuppressWarnings("unchecked")
  static Map<String, Object> asMap(Object value) {
    return value instanceof Map<?, ?> ? (Map<String, Object>) value : new LinkedHashMap<>();
  }

  static final class DemoRuntime implements AxCodeRuntime {
    final AxRuntimeCapabilities capabilities = new AxRuntimeCapabilities().language("Python").snapshot(true).patch(true);
    final List<DemoSession> sessions = new ArrayList<>();

    public String language() { return "Python"; }
    public AxCodeSession createSession(Map<String, Object> globals, Map<String, Object> options) {
      DemoSession session = new DemoSession(globals, options);
      sessions.add(session);
      return session;
    }
  }

  static final class DemoSession implements AxCodeSession {
    Map<String, Object> globals;
    final Map<String, Object> createOptions;
    boolean closed = false;

    DemoSession(Map<String, Object> globals, Map<String, Object> options) {
      this.globals = new LinkedHashMap<>(globals == null ? Map.of() : globals);
      this.createOptions = new LinkedHashMap<>(options == null ? Map.of() : options);
    }

    public Object execute(String code, Map<String, Object> options) {
      if (options == null || !options.containsKey("reservedNames")) throw new RuntimeException("missing reservedNames");
      if ("timeout()".equals(code)) return AxRuntimeEnvelope.timeout("demo timeout");
      globals.put("answer", "runtime");
      return AxRuntimeEnvelope.finalPayload(Map.of("answer", globals.get("answer")));
    }

    public Object inspectGlobals(Map<String, Object> options) { return new LinkedHashMap<>(globals); }
    public Object snapshotGlobals(Map<String, Object> options) { return Map.of("version", 1, "bindings", new LinkedHashMap<>(globals), "globals", new LinkedHashMap<>(globals), "closed", closed); }
    public Object patchGlobals(Object snapshot, Map<String, Object> options) {
      globals = new LinkedHashMap<>(asMap(asMap(snapshot).get("bindings")));
      return snapshotGlobals(options);
    }
    public Object close() { closed = true; return Map.of("closed", true); }
  }

  public static void main(String[] args) {
    DemoRuntime runtime = new DemoRuntime();
    AxAgent qa = Ax.agent("question:string -> answer:string", Map.of("runtime", Map.of("language", "Python")));
    Map<String, Object> out = qa.test(runtime, "final()", Map.of("question", "adapter"));
    if (!"final".equals(out.get("kind"))) throw new RuntimeException("bad test output: " + out);
    if (!runtime.sessions.get(runtime.sessions.size() - 1).closed) throw new RuntimeException("test session was not closed");

    AxAgent runner = Ax.agent("question:string -> answer:string", Map.of("runtime", Map.of("language", "Python")));
    Map<String, Object> step = runner.executeActorStep(runtime, "final()", Map.of("question", "adapter"));
    if (!"final".equals(step.get("kind"))) throw new RuntimeException("bad step output: " + step);
    Map<String, Object> snapshot = asMap(runner.exportSessionState());
    runner.restoreSessionState(snapshot);
    Map<String, Object> timeout = runner.executeActorStep(runtime, "timeout()", Map.of("question", "adapter"));
    if (!"timeout".equals(timeout.get("error_category"))) throw new RuntimeException("bad timeout: " + timeout);
    System.out.println("java-runtime-adapter-ok");
  }
}
`

const javaRuntimeProtocolExample = `import dev.axllm.ax.*;
import java.io.File;
import java.util.*;

public final class RuntimeProtocolExample {
  @SuppressWarnings("unchecked")
  static Map<String, Object> asMap(Object value) {
    return value instanceof Map<?, ?> ? (Map<String, Object>) value : new LinkedHashMap<>();
  }

  public static void main(String[] args) throws Exception {
    String repoRoot = System.getenv("AXIR_REPO_ROOT");
    String server = System.getenv("AXIR_AXJS_RUNTIME_SERVER");
    if (repoRoot == null || server == null) throw new RuntimeException("AXIR runtime protocol env vars are required");

    try (AxProcessCodeRuntime runtime = new AxProcessCodeRuntime(
      List.of("node", "--import=tsx", server),
      new File(repoRoot),
      Map.of()
    )) {
      AxAgent qa = Ax.agent("question:string -> answer:string", Map.of("runtime", Map.of("language", "JavaScript")));
      Map<String, Object> out = qa.test(runtime, "answer = inputs.question; await final({ answer })", Map.of("question", "protocol"));
      if (!"final".equals(out.get("kind"))) throw new RuntimeException("bad test output: " + out);
      Map<String, Object> completion = asMap(out.get("completion_payload"));
      Object firstArg = ((List<?>) completion.get("args")).get(0);
      if (!"protocol".equals(asMap(firstArg).get("answer"))) throw new RuntimeException("bad final payload: " + out);

      AxAgent runner = Ax.agent("question:string -> answer:string", Map.of("runtime", Map.of("language", "JavaScript")));
      Map<String, Object> step = runner.executeActorStep(runtime, "answer = 'persisted'; await final({ answer })", Map.of("question", "protocol"));
      if (!"final".equals(step.get("kind"))) throw new RuntimeException("bad step output: " + step);
      Map<String, Object> snapshot = asMap(runner.exportSessionState());
      if (!snapshot.containsKey("bindings")) throw new RuntimeException("bad snapshot: " + snapshot);
      runner.restoreSessionState(snapshot);
      Object inspected = runner.inspectRuntime();
      if (!String.valueOf(inspected).contains("persisted")) throw new RuntimeException("bad inspect: " + inspected);
      Map<String, Object> closed = asMap(runner.closeRuntimeSession());
      if (!Boolean.TRUE.equals(closed.get("closed"))) throw new RuntimeException("bad close: " + closed);
    }
    System.out.println("java-runtime-protocol-ok");
  }
}
`

const javaOptimizerArtifactExample = `import dev.axllm.ax.*;
import java.util.*;

public final class OptimizerArtifactExample {
  static final class ScriptedOptimizer implements OptimizerEngine {
    public String name() { return "fixture"; }
    public String version() { return "1"; }
    public Map<String, Object> optimize(Map<String, Object> request) {
      return Map.of(
        "componentMap", Map.of("qa::instruction", "Prefer artifact-backed answers."),
        "metadata", Map.of(
          "evidence", Map.of("avg", 1),
          "provenance", Map.of("sourceProgramKind", "axgen")
        )
      );
    }
  }

  static boolean hasInstruction(AxGen gen, String value) {
    for (Map<String, Object> item : gen.getOptimizableComponents()) {
      if ("qa::instruction".equals(item.get("id")) && value.equals(item.get("current"))) return true;
    }
    return false;
  }

  public static void main(String[] args) {
    AxGen qa = new AxGen(Ax.s("question:string -> answer:string"), Map.of("id", "qa", "instruction", "Base."));
    Map<String, Object> artifact = qa.optimizeWith(new ScriptedOptimizer(), List.of(), Map.of("apply", false));
    if (!hasInstruction(qa, "Base.")) throw new RuntimeException("apply=false mutated components");
    qa.applyOptimization(Json.stringify(artifact));
    if (!hasInstruction(qa, "Prefer artifact-backed answers.")) throw new RuntimeException("artifact not applied");
    System.out.println("java-optimizer-artifact-ok");
  }
}
`

const cppSignatureSchemaExample = `#include "axllm/axllm.hpp"
#include <iostream>

int main() {
  axllm::Value sig = axllm::s("question:string -> answer:string");
  axllm::Value schema = axllm::to_json_schema(axllm::Core::get(sig, "outputs"));
  if (!axllm::Core::truthy(axllm::Core::get(axllm::Core::get(schema, "properties"), "answer"))) return 1;
  std::cout << "cpp-signature-schema-ok\n";
}
`

const cppAxGenScriptedClientToolExample = `#include "axllm/axllm.hpp"
#include <iostream>

struct ScriptedClient : axllm::AIClient {
  int calls = 0;

  axllm::Value complete(axllm::Value) override {
    calls += 1;
    if (calls == 1) {
      return axllm::object({
        {"content", ""},
        {"function_calls", axllm::array({
          axllm::object({{"id", "call_1"}, {"name", "search"}, {"params", axllm::object({{"query", "ax docs"}})}})
        })}
      });
    }
    return axllm::object({{"content", "{\"answer\":\"Found Ax docs\"}"}});
  }
};

int main() {
  axllm::Value parameters = axllm::object({
    {"type", "object"},
    {"properties", axllm::object({{"query", axllm::object({{"type", "string"}})}})},
    {"required", axllm::array({"query"})}
  });
  axllm::Tool search("search", "Search docs", parameters, [](axllm::Value) {
    return axllm::object({{"title", "Ax docs"}});
  });
  auto qa = axllm::ax("query:string -> answer:string")
      .add_tool(search)
      .add_assert(axllm::object({{"field", "answer"}, {"contains", "Ax"}, {"message", "answer should mention Ax"}}))
      .add_field_processor("answer", "trim");
  ScriptedClient client;
  axllm::Value out = qa.forward(client, axllm::object({{"query", "ax docs"}}));
  if (!axllm::equal(axllm::Core::get(out, "answer"), "Found Ax docs")) return 1;
  if (axllm::Core::truthy(axllm::Core::is_none(axllm::Core::get(qa.get_traces(), 0)))) return 1;
  std::cout << "cpp-axgen-ok\n";
}
`

const cppAxGenOpenAIExample = `#include "axllm/axllm.hpp"
#include <cstdlib>
#include <iostream>

int main() {
  const char* key = std::getenv("OPENAI_API_KEY");
  if (key == nullptr || std::string(key).empty()) key = std::getenv("OPENAI_APIKEY");
  if (key == nullptr || std::string(key).empty()) {
    std::cerr << "Set OPENAI_API_KEY to run this provider API example.\n";
    return 2;
  }

  axllm::OpenAICompatibleClient client(axllm::object({
    {"api_key", key},
    {"model", std::getenv("AX_OPENAI_MODEL") ? std::getenv("AX_OPENAI_MODEL") : "gpt-4.1-mini"},
    {"model_config", axllm::object({{"temperature", 0}})}
  }));
  auto program = axllm::ax("question:string -> answer:string");
  axllm::Value out = program.forward(client, axllm::object({
    {"question", "In one sentence, explain Ax as a language-agnostic LLM programming library."}
  }));
  std::cout << axllm::stringify(out) << "\n";
}
`

const cppProviderMappingNoKeyExample = `#include "axllm/axllm.hpp"
#include <iostream>

struct ScriptedTransport : axllm::Transport {
  axllm::Value call(axllm::Value) override {
    return axllm::object({
      {"status", 200},
      {"json", axllm::object({
        {"id", "chatcmpl_example"},
        {"model", "gpt-4.1-mini"},
        {"choices", axllm::array({
          axllm::object({
            {"index", 0},
            {"finish_reason", "stop"},
            {"message", axllm::object({{"content", "hello from scripted transport"}})}
          })
        })},
        {"usage", axllm::object({{"prompt_tokens", 1}, {"completion_tokens", 2}, {"total_tokens", 3}})}
      })}
    });
  }
};

int main() {
  ScriptedTransport transport;
  axllm::OpenAICompatibleClient service(axllm::object({{"model", "gpt-4.1-mini"}, {"api_key", "test-key"}}), &transport);
  axllm::Value response = service.chat(axllm::object({
    {"chat_prompt", axllm::array({axllm::object({{"role", "user"}, {"content", "hello"}})})}
  }));
  axllm::Value first = axllm::Core::get(axllm::Core::get(response, "results"), 0);
  if (!axllm::equal(axllm::Core::get(first, "content"), "hello from scripted transport")) return 1;
  std::cout << "cpp-axai-ok\n";
}
`

const cppAxFlowProgramGraphExample = `#include "axllm/axllm.hpp"
#include <iostream>

struct ScriptedClient : axllm::AIClient {
  axllm::Value complete(axllm::Value) override {
    return axllm::object({{"content", "{\"answer\":\"Paris\"}"}});
  }
};

int main() {
  axllm::AxGen qa = axllm::ax("question:string -> answer:string");
  axllm::AxFlow program = axllm::flow(axllm::object({{"id", "example.flow"}})).execute("qa", qa).returns(axllm::object({{"answer", "answer"}}));
  ScriptedClient client;
  axllm::Value out = program.forward(client, axllm::object({{"question", "Capital of France?"}}));
  if (!axllm::equal(axllm::Core::get(out, "answer"), "Paris")) return 1;
  if (!axllm::equal(axllm::Core::get(axllm::Core::get(axllm::Core::get(program.get_plan(), "steps"), 0), "name"), "qa")) return 2;
  std::cout << "cpp-axflow-ok\n";
}
`

const cppRuntimeAdapterExample = `#include "axllm/axllm.hpp"
#include <iostream>

struct DemoSession : axllm::AxCodeSession {
  axllm::Value globals;
  axllm::Value create_options;
  bool closed = false;

  DemoSession(axllm::Value globals_, axllm::Value options_) : globals(std::move(globals_)), create_options(std::move(options_)) {}

  axllm::Value execute(axllm::Value code, axllm::Value options = axllm::Value::object()) override {
    if (!axllm::Core::truthy(axllm::Core::map_contains(options, "reservedNames"))) throw axllm::AxError("fixture", "missing reservedNames");
    if (axllm::equal(code, "timeout()")) return axllm::RuntimeEnvelope::timeout("demo timeout");
    axllm::Core::set(globals, "answer", "runtime");
    return axllm::RuntimeEnvelope::final_payload({axllm::object({{"answer", axllm::Core::get(globals, "answer")}})});
  }

  axllm::Value inspect(axllm::Value = axllm::Value::object()) override { return globals; }
  axllm::Value snapshot_globals(axllm::Value = axllm::Value::object()) override {
    return axllm::object({{"version", 1}, {"bindings", globals}, {"globals", globals}, {"closed", closed}});
  }
  axllm::Value patch_globals(axllm::Value snapshot, axllm::Value options = axllm::Value::object()) override {
    globals = axllm::Core::get(snapshot, "bindings", axllm::Value::object());
    return snapshot_globals(options);
  }
  axllm::Value close() override {
    closed = true;
    return axllm::object({{"closed", true}});
  }
};

struct DemoRuntime : axllm::AxCodeRuntime {
  axllm::RuntimeCapabilities capabilities;
  std::vector<std::unique_ptr<DemoSession>> sessions;

  DemoRuntime() {
    capabilities.language = "Python";
    capabilities.snapshot = true;
    capabilities.patch = true;
  }

  std::string language() const override { return "Python"; }
  axllm::AxCodeSession* create_session(axllm::Value globals, axllm::Value options = axllm::Value::object()) override {
    sessions.push_back(std::make_unique<DemoSession>(std::move(globals), std::move(options)));
    return sessions.back().get();
  }
};

int main() {
  DemoRuntime runtime;
  auto qa = axllm::agent("question:string -> answer:string", axllm::object({{"runtime", axllm::object({{"language", "Python"}})}}));
  axllm::Value out = qa.test(runtime, "final()", axllm::object({{"question", "adapter"}}));
  if (!axllm::equal(axllm::Core::get(out, "kind"), "final")) return 1;
  if (!runtime.sessions.back()->closed) return 2;

  auto runner = axllm::agent("question:string -> answer:string", axllm::object({{"runtime", axllm::object({{"language", "Python"}})}}));
  axllm::Value step = runner.execute_actor_step(runtime, "final()", axllm::object({{"question", "adapter"}}));
  if (!axllm::equal(axllm::Core::get(step, "kind"), "final")) return 3;
  axllm::Value snapshot = runner.export_session_state();
  runner.restore_session_state(snapshot);
  axllm::Value timeout = runner.execute_actor_step(runtime, "timeout()", axllm::object({{"question", "adapter"}}));
  if (!axllm::equal(axllm::Core::get(timeout, "error_category"), "timeout")) return 4;
  std::cout << "cpp-runtime-adapter-ok\n";
}
`

const cppRuntimeProtocolExample = `#include "axllm/axllm.hpp"
#include <iostream>

struct ScriptedRuntimeTransport : axllm::RuntimeTransport {
  int next_session = 0;

  axllm::Value call(axllm::Value message) override {
    axllm::Value id = axllm::Core::get(message, "id");
    axllm::Value op = axllm::Core::get(message, "op");
    if (axllm::equal(op, "capabilities")) {
      return axllm::object({{"id", id}, {"ok", true}, {"result", axllm::object({{"language", "JavaScript"}, {"usage_instructions", "scripted protocol"}})}});
    }
    if (axllm::equal(op, "create_session")) {
      std::string session_id = "s" + std::to_string(++next_session);
      return axllm::object({{"id", id}, {"ok", true}, {"session_id", session_id}, {"result", axllm::object({{"session_id", session_id}})}});
    }
    if (axllm::equal(op, "execute")) {
      return axllm::object({{"id", id}, {"ok", true}, {"result", axllm::object({{"type", "final"}, {"args", axllm::array({axllm::object({{"answer", "protocol"}})})}})}});
    }
    if (axllm::equal(op, "snapshot_globals")) {
      return axllm::object({{"id", id}, {"ok", true}, {"result", axllm::object({{"version", 1}, {"bindings", axllm::object({{"answer", "protocol"}})}, {"globals", axllm::object({{"answer", "protocol"}})}})}});
    }
    if (axllm::equal(op, "patch_globals")) {
      axllm::Value payload = axllm::Core::get(message, "payload", axllm::Value::object());
      return axllm::object({{"id", id}, {"ok", true}, {"result", axllm::Core::get(payload, "globals", axllm::Value::object())}});
    }
    if (axllm::equal(op, "inspect_globals")) {
      return axllm::object({{"id", id}, {"ok", true}, {"result", axllm::object({{"answer", "protocol"}})}});
    }
    if (axllm::equal(op, "close")) {
      return axllm::object({{"id", id}, {"ok", true}, {"result", axllm::object({{"closed", true}})}});
    }
    if (axllm::equal(op, "shutdown")) {
      return axllm::object({{"id", id}, {"ok", true}, {"result", axllm::object({{"shutdown", true}})}});
    }
    return axllm::object({{"id", id}, {"ok", false}, {"error", axllm::object({{"category", "protocol"}, {"message", "unknown op"}})}});
  }
};

int main() {
  ScriptedRuntimeTransport transport;
  axllm::RuntimeProtocolClient runtime(transport);
  auto qa = axllm::agent("question:string -> answer:string", axllm::object({{"runtime", axllm::object({{"language", "JavaScript"}})}}));
  axllm::Value out = qa.test(runtime, "final()", axllm::object({{"question", "protocol"}}));
  if (!axllm::equal(axllm::Core::get(out, "kind"), "final")) return 1;
  auto runner = axllm::agent("question:string -> answer:string", axllm::object({{"runtime", axllm::object({{"language", "JavaScript"}})}}));
  axllm::Value step = runner.execute_actor_step(runtime, "final()", axllm::object({{"question", "protocol"}}));
  if (!axllm::equal(axllm::Core::get(step, "kind"), "final")) return 2;
  axllm::Value snapshot = runner.export_session_state();
  runner.restore_session_state(snapshot);
  axllm::Value inspected = runner.inspect_runtime();
  if (!axllm::equal(axllm::Core::get(inspected, "answer"), "protocol")) return 3;
  axllm::Value closed = runner.close_runtime_session();
  if (!axllm::equal(axllm::Core::get(closed, "closed"), true)) return 4;
  runtime.shutdown();
  std::cout << "cpp-runtime-protocol-ok\n";
}
`

const cppOptimizerArtifactExample = `#include "axllm/axllm.hpp"
#include <iostream>

struct ScriptedOptimizer : axllm::OptimizerEngine {
  std::string name() const override { return "fixture"; }
  std::string version() const override { return "1"; }
  axllm::Value optimize(axllm::Value) override {
    return axllm::object({
      {"componentMap", axllm::object({{"qa::instruction", "Prefer artifact-backed answers."}})},
      {"metadata", axllm::object({
        {"evidence", axllm::object({{"avg", 1}})},
        {"provenance", axllm::object({{"sourceProgramKind", "axgen"}})}
      })}
    });
  }
};

static bool has_instruction(const axllm::AxGen& gen, const std::string& value) {
  axllm::Value components = gen.get_optimizable_components();
  for (int i = 0; ; ++i) {
    axllm::Value item = axllm::Core::get(components, i);
    if (axllm::Core::truthy(axllm::Core::is_none(item))) break;
    if (axllm::equal(axllm::Core::get(item, "id"), "qa::instruction") &&
        axllm::equal(axllm::Core::get(item, "current"), value)) return true;
  }
  return false;
}

int main() {
  axllm::AxGen qa = axllm::ax("question:string -> answer:string", axllm::object({{"id", "qa"}, {"instruction", "Base."}}));
  ScriptedOptimizer engine;
  axllm::Value artifact = qa.optimize_with(engine, axllm::Value::array(), axllm::object({{"apply", false}}));
  if (!has_instruction(qa, "Base.")) return 1;
  qa.apply_optimization(axllm::Value(axllm::stringify(artifact)));
  if (!has_instruction(qa, "Prefer artifact-backed answers.")) return 2;
  std::cout << "cpp-optimizer-artifact-ok\n";
}
`

const pyProviderStreamNoKeyExample = `from axllm import OpenAICompatibleClient


def scripted_transport(request):
    return {
        "status": 200,
        "body": (
            'data: {"id":"chatcmpl_stream","model":"gpt-4.1-mini","choices":[{"index":0,"delta":{"content":"hel"}}]}' + "\n\n"
            'data: {"id":"chatcmpl_stream","model":"gpt-4.1-mini","choices":[{"index":0,"delta":{"content":"lo"},"finish_reason":"stop"}]}' + "\n\n"
            "data: [DONE]\n\n"
        ),
    }


client = OpenAICompatibleClient(api_key="test-key", model="gpt-4.1-mini", transport=scripted_transport)
events = list(client.stream({"chat_prompt": [{"role": "user", "content": "stream"}]}))
text = "".join((event["results"][0].get("content") or "") for event in events)
assert text == "hello", events
print("python-provider-stream-no-key", text)
`

const pyAxFlowOpenAIExample = `import json
import os

from axllm import OpenAICompatibleClient, ax, flow


api_key = os.getenv("OPENAI_API_KEY") or os.getenv("OPENAI_APIKEY")
if not api_key:
    raise SystemExit("Set OPENAI_API_KEY or OPENAI_APIKEY to run this provider API example.")

client = OpenAICompatibleClient(
    api_key=api_key,
    model=os.getenv("AX_OPENAI_MODEL", "gpt-4.1-mini"),
    model_config={"temperature": 0},
)
outline = ax("topic:string -> outline:string")
program = (
    flow({"id": "examples.openaiApiFlow"})
    .execute("outline", outline)
    .map("summary", lambda state: {"summary": "Generated outline with typed Ax program steps."})
    .returns({"outline": "outline", "summary": "summary"})
)
output = program.forward(client, {"topic": "how Ax composes typed LLM programs"})

print(json.dumps(output, indent=2, sort_keys=True))
`

const pyAudioResponsesMappingExample = `import json

from axllm import OpenAIResponsesClient


transport_requests = []


def scripted_transport(request):
    transport_requests.append(request)
    if request["url"].endswith("/audio/speech"):
        return {"status": 200, "json": {"audio": "base64-speech"}}
    if request["url"].endswith("/audio/transcriptions"):
        return {
            "status": 200,
            "json": {"text": "hello world", "language": "en", "duration": 1.25},
        }
    raise RuntimeError(f"unexpected request: {request}")


client = OpenAIResponsesClient(api_key="test-key", transport=scripted_transport)
speech = client.speak({"text": "hello", "voice": "alloy", "format": "mp3"})
transcript = client.transcribe(
    {"audio": "base64-audio", "language": "en", "model": "whisper-1", "format": "json"}
)
assert speech["audio"] == "base64-speech", speech
assert transcript["text"] == "hello world", transcript

print("normalized output:")
print(json.dumps({"speak": speech, "transcribe": transcript}, indent=2, sort_keys=True))
print("transport requests:")
print(json.dumps(transport_requests, indent=2, sort_keys=True))
`

const pyAudioHTTPRoundtripExample = `"""Drive transcribe()/speak() through the REAL urllib transport against an
in-process loopback server, exercising the wire-level encoders the conformance
ScriptedTransport bypasses: the multipart/form-data request body (transcribe)
and binary (non-UTF8) response handling (speak). Exits non-zero on any mismatch
so ` + "`axir verify`" + ` fails if either regresses."""

import base64
import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

from axllm import OpenAIResponsesClient

# Deliberately non-UTF8 bytes so a UTF-8/JSON decode regression on the binary
# path corrupts them detectably.
audio_bytes = bytes([0, 1, 2, 255, 254, 16, 127])
audio_b64 = base64.b64encode(audio_bytes).decode()
speech_bytes = bytes([255, 216, 255, 0, 17, 34, 254])
want_audio = base64.b64encode(speech_bytes).decode()

state = {"saw_multipart": False, "file_bytes": b""}


def extract_file_bytes(body, content_type):
    boundary = content_type.split("boundary=", 1)[1].encode()
    delimiter = b"--" + boundary
    for segment in body.split(delimiter):
        if b'name="file"' in segment:
            sep = segment.find(b"\r\n\r\n")
            if sep >= 0:
                content = segment[sep + 4 :]
                if content.endswith(b"\r\n"):
                    content = content[:-2]
                return content
    return b""


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length)
        if "transcriptions" in self.path:
            content_type = self.headers.get("Content-Type", "")
            if not content_type.startswith("multipart/form-data; boundary="):
                raise RuntimeError(f"transcribe request was not multipart: {content_type}")
            state["saw_multipart"] = True
            state["file_bytes"] = extract_file_bytes(body, content_type)
            payload = json.dumps(
                {"text": "hello world", "language": "en", "duration": 1.25}
            ).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
        elif "speech" in self.path:
            self.send_response(200)
            self.send_header("Content-Type", "audio/mpeg")
            self.send_header("Content-Length", str(len(speech_bytes)))
            self.end_headers()
            self.wfile.write(speech_bytes)
        else:
            self.send_response(404)
            self.end_headers()


server = HTTPServer(("127.0.0.1", 0), Handler)
port = server.server_address[1]
thread = threading.Thread(target=server.serve_forever, daemon=True)
thread.start()

try:
    client = OpenAIResponsesClient(api_key="test-key", base_url=f"http://127.0.0.1:{port}")
    transcript = client.transcribe(
        {"audio": audio_b64, "language": "en", "model": "gpt-4o-mini-transcribe", "format": "json"}
    )
    assert state["saw_multipart"], "loopback server never received a multipart transcribe request"
    assert base64.b64encode(state["file_bytes"]).decode() == audio_b64, (
        f"multipart file bytes mismatch: {state['file_bytes']!r}"
    )
    assert transcript["text"] == "hello world", transcript

    speech = client.speak(
        {"text": "hello", "voice": "alloy", "format": "mp3", "model": "gpt-4o-mini-tts"}
    )
    assert speech["audio"] == want_audio, f"speak binary base64 mismatch: {speech}"
finally:
    server.shutdown()

print("audio-http-roundtrip-ok")
`

const pyRealtimeAudioEventsExample = `import json

from axllm import GoogleGeminiClient, GrokClient


grok = GrokClient(model="grok-voice-think-fast-1.0", api_key="test-key")
grok_request = {
    "model": "grok-voice-think-fast-1.0",
    "chat_prompt": [
        {"role": "system", "content": "You are a concise voice agent."},
        {"role": "user", "content": "Say hello."},
    ],
    "audio": {"input": {"sampleRate": 24000}, "output": {"sampleRate": 24000, "voice": "eve"}},
}
grok_events = [
    {"type": "response.output_audio_transcript.delta", "response_id": "grok_rt", "delta": "hello "},
    {"type": "response.output_audio.delta", "response_id": "grok_rt", "delta": "AQI="},
    {
        "type": "response.done",
        "response": {
            "id": "grok_rt",
            "usage": {"input_tokens": 3, "output_tokens": 2, "total_tokens": 5},
        },
    },
]

gemini = GoogleGeminiClient(
    model="gemini-2.5-flash-native-audio-preview-12-2025",
    api_key="test-key",
)
gemini_request = {
    "model": "gemini-2.5-flash-native-audio-preview-12-2025",
    "chat_prompt": [
        {"role": "system", "content": "Answer with audio."},
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "Realtime question"},
                {"type": "audio", "data": "AAAA", "format": "pcm16", "sampleRate": 16000},
            ],
        },
    ],
    "audio": {"output": {"transcript": True, "voice": "Kore"}},
}
gemini_events = [
    {"id": "gemini_live_1", "serverContent": {"outputTranscription": {"text": "spoken "}}},
    {
        "id": "gemini_live_2",
        "serverContent": {
            "modelTurn": {
                "parts": [{"inlineData": {"data": "AQI=", "mimeType": "audio/pcm"}}]
            }
        },
    },
    {
        "id": "gemini_live_3",
        "toolCall": {"functionCalls": [{"name": "lookup", "args": {"q": "ax"}}]},
    },
    {
        "id": "gemini_live_done",
        "serverContent": {"turnComplete": True},
        "usageMetadata": {"promptTokenCount": 3, "candidatesTokenCount": 4, "totalTokenCount": 7},
    },
]

grok_normalized = list(grok.realtime(grok_events))
gemini_normalized = list(gemini.realtime(gemini_events))
assert grok_normalized[-1]["results"][0]["finish_reason"] == "stop", grok_normalized
assert gemini_normalized[-1]["results"][0]["finish_reason"] == "stop", gemini_normalized

print("grok setup:")
print(json.dumps(grok.realtime_audio_setup(grok_request), indent=2, sort_keys=True))
print("grok normalized events:")
print(json.dumps(grok_normalized, indent=2, sort_keys=True))

print("gemini setup:")
print(json.dumps(gemini.realtime_audio_setup(gemini_request), indent=2, sort_keys=True))
print("gemini input messages:")
print(json.dumps(gemini.realtime_audio_input(gemini_request), indent=2, sort_keys=True))
print("gemini normalized events:")
print(json.dumps(gemini_normalized, indent=2, sort_keys=True))
`

const pyGEPALocalOptimizerExample = `import json

from axllm import AxGEPA, OptimizerEvaluator


class LocalEvaluator(OptimizerEvaluator):
    def evaluate(self, candidate_map, options=None):
        rows = []
        examples = ((options or {}).get("dataset") or {}).get("train") or []
        instruction = candidate_map.get("qa::instruction", "")
        for example in examples:
            quality = 0.9 if "concise" in instruction.lower() else 0.65
            brevity = 0.8
            scalar = (quality + brevity) / 2
            rows.append(
                {
                    "input": example,
                    "prediction": {"answer": "Ax composes typed LLM programs."},
                    "scores": {"quality": quality, "brevity": brevity},
                    "scalar": scalar,
                }
            )
        total = sum(row["scalar"] for row in rows)
        return {"rows": rows, "avg": total / len(rows), "sum": total, "count": len(rows)}


request = {
    "programKind": "axgen",
    "components": [
        {
            "id": "qa::instruction",
            "owner": "qa",
            "kind": "instruction",
            "current": "Answer clearly and concisely.",
        }
    ],
    "dataset": {
        "train": [{"question": "What is Ax?"}, {"question": "Why use typed signatures?"}],
        "validation": [{"question": "Summarize Ax."}],
    },
    "options": {"numTrials": 0, "maxMetricCalls": 8, "seed": 7},
}

artifact = AxGEPA(seed=7).optimize(request, LocalEvaluator())
assert "qa::instruction" in artifact["componentMap"], artifact
print(json.dumps({"componentMap": artifact["componentMap"], "metadata": artifact["metadata"]}, indent=2, sort_keys=True))
`

const javaProviderStreamNoKeyExample = `import dev.axllm.ax.*;
import java.util.*;

public final class ProviderStreamNoKeyExample {
  public static void main(String[] args) throws Exception {
    OpenAICompatibleClient.Transport transport = request -> Map.of(
      "status", 200,
      "body", "data: {\"id\":\"chatcmpl_stream\",\"model\":\"gpt-4.1-mini\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"hel\"}}]}\n\n"
        + "data: {\"id\":\"chatcmpl_stream\",\"model\":\"gpt-4.1-mini\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"lo\"},\"finish_reason\":\"stop\"}]}\n\n"
        + "data: [DONE]\n\n"
    );
    OpenAICompatibleClient client = new OpenAICompatibleClient(Map.of(
      "api_key", "test-key",
      "model", "gpt-4.1-mini",
      "transport", transport
    ));
    StringBuilder text = new StringBuilder();
    for (Map<String, Object> event : client.stream(Map.of("chat_prompt", List.of(Map.of("role", "user", "content", "stream"))))) {
      List<?> results = (List<?>) event.get("results");
      Object content = ((Map<?, ?>) results.get(0)).get("content");
      if (content != null) text.append(content);
    }
    if (!"hello".contentEquals(text)) throw new RuntimeException("bad stream: " + text);
    System.out.println("java-provider-stream-no-key " + text);
  }
}
`

const javaFlowOpenAIExample = `import dev.axllm.ax.*;
import java.util.*;

public final class FlowOpenAIExample {
  public static void main(String[] args) throws Exception {
    String apiKey = System.getenv("OPENAI_API_KEY");
    if (apiKey == null || apiKey.isBlank()) apiKey = System.getenv("OPENAI_APIKEY");
    if (apiKey == null || apiKey.isBlank()) {
      throw new IllegalStateException("Set OPENAI_API_KEY or OPENAI_APIKEY to run this provider API example.");
    }
    String model = System.getenv().getOrDefault("AX_OPENAI_MODEL", "gpt-4.1-mini");
    OpenAICompatibleClient client =
        new OpenAICompatibleClient(
            Map.of("api_key", apiKey, "model", model, "model_config", Map.of("temperature", 0.0)));

    AxGen outline = Ax.ax("topic:string -> outline:string");
    AxFlow program =
        Ax.flow(Map.of("id", "examples.openaiApiFlow"))
            .execute("outline", outline)
            .map(
                "summary",
                state -> Map.of("summary", "Generated outline with typed Ax program steps."))
            .returns(Map.of("outline", "outline", "summary", "summary"));
    Map<String, Object> output =
        program.forward(client, Map.of("topic", "how Ax composes typed LLM programs"));
    System.out.println(Json.stringify(output));
  }
}
`

const javaAudioResponsesMappingExample = `import dev.axllm.ax.*;
import java.util.*;

public final class AudioResponsesMappingExample {
  public static void main(String[] args) throws Exception {
    List<Map<String, Object>> transportRequests = new ArrayList<>();
    OpenAICompatibleClient.Transport transport =
        request -> {
          transportRequests.add(new LinkedHashMap<>(request));
          String url = String.valueOf(request.get("url"));
          if (url.endsWith("/audio/speech")) {
            return Map.of("status", 200, "json", Map.of("audio", "base64-speech"));
          }
          if (url.endsWith("/audio/transcriptions")) {
            return Map.of(
                "status",
                200,
                "json",
                Map.of("text", "hello world", "language", "en", "duration", 1.25));
          }
          throw new RuntimeException("unexpected request: " + request);
        };

    OpenAIResponsesClient client =
        new OpenAIResponsesClient(Map.of("api_key", "test-key", "transport", transport));
    Map<String, Object> speech =
        client.speak(Map.of("text", "hello", "voice", "alloy", "format", "mp3"));
    Map<String, Object> transcript =
        client.transcribe(
            Map.of("audio", "base64-audio", "language", "en", "model", "whisper-1", "format", "json"));
    if (!"base64-speech".equals(speech.get("audio"))) throw new RuntimeException("bad speech: " + speech);
    if (!"hello world".equals(transcript.get("text"))) throw new RuntimeException("bad transcript: " + transcript);

    System.out.println("normalized output:");
    System.out.println(Json.stringify(Map.of("speak", speech, "transcribe", transcript)));
    System.out.println("transport requests:");
    System.out.println(Json.stringify(transportRequests));
  }
}
`

const javaAudioHTTPRoundtripExample = `import com.sun.net.httpserver.HttpServer;
import dev.axllm.ax.*;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.atomic.AtomicBoolean;

// Drive transcribe()/speak() through the REAL HttpClient transport against an
// in-process com.sun.net.httpserver loopback, exercising the wire-level encoders
// the conformance ScriptedTransport bypasses: the multipart/form-data request
// body (transcribe) and binary (non-UTF8) response handling (speak). Exits
// non-zero on any mismatch so ` + "`axir verify`" + ` fails if either regresses.
public final class AudioHTTPRoundtripExample {
  public static void main(String[] args) throws Exception {
    // Deliberately non-UTF8 bytes so a UTF-8/JSON decode regression corrupts them.
    byte[] audioBytes = {0, 1, 2, (byte) 0xff, (byte) 0xfe, 16, 127};
    String audioB64 = Base64.getEncoder().encodeToString(audioBytes);
    byte[] speechBytes = {(byte) 0xff, (byte) 0xd8, (byte) 0xff, 0, 17, 34, (byte) 0xfe};
    String wantAudio = Base64.getEncoder().encodeToString(speechBytes);

    AtomicBoolean sawMultipart = new AtomicBoolean(false);
    AtomicBoolean fileBytesPresent = new AtomicBoolean(false);

    HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext(
        "/",
        exchange -> {
          String path = exchange.getRequestURI().getPath();
          byte[] body = exchange.getRequestBody().readAllBytes();
          if (path.contains("transcriptions")) {
            String contentType = exchange.getRequestHeaders().getFirst("Content-Type");
            sawMultipart.set(
                contentType != null && contentType.startsWith("multipart/form-data; boundary="));
            fileBytesPresent.set(containsBytes(body, audioBytes));
            byte[] resp =
                "{\"text\":\"hello world\",\"language\":\"en\",\"duration\":1.25}"
                    .getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, resp.length);
            try (OutputStream os = exchange.getResponseBody()) {
              os.write(resp);
            }
          } else if (path.contains("speech")) {
            exchange.getResponseHeaders().set("Content-Type", "audio/mpeg");
            exchange.sendResponseHeaders(200, speechBytes.length);
            try (OutputStream os = exchange.getResponseBody()) {
              os.write(speechBytes);
            }
          } else {
            exchange.sendResponseHeaders(404, -1);
            exchange.close();
          }
        });
    server.start();
    int port = server.getAddress().getPort();

    try {
      OpenAIResponsesClient client =
          new OpenAIResponsesClient(
              Map.of("api_key", "test-key", "base_url", "http://127.0.0.1:" + port));
      Map<String, Object> transcript =
          client.transcribe(
              Map.of(
                  "audio", audioB64, "language", "en", "model", "gpt-4o-mini-transcribe", "format",
                  "json"));
      if (!sawMultipart.get())
        throw new RuntimeException("loopback server never received a multipart transcribe request");
      if (!fileBytesPresent.get())
        throw new RuntimeException("multipart body did not contain the decoded file bytes");
      if (!"hello world".equals(transcript.get("text")))
        throw new RuntimeException("transcribe response not normalized: " + transcript);

      Map<String, Object> speech =
          client.speak(
              Map.of("text", "hello", "voice", "alloy", "format", "mp3", "model", "gpt-4o-mini-tts"));
      if (!wantAudio.equals(speech.get("audio")))
        throw new RuntimeException("speak binary response not base64-encoded as expected: " + speech);
    } finally {
      server.stop(0);
    }
    System.out.println("audio-http-roundtrip-ok");
  }

  private static boolean containsBytes(byte[] haystack, byte[] needle) {
    if (needle.length == 0) return true;
    outer:
    for (int i = 0; i + needle.length <= haystack.length; i++) {
      for (int j = 0; j < needle.length; j++) {
        if (haystack[i + j] != needle[j]) continue outer;
      }
      return true;
    }
    return false;
  }
}
`

const javaRealtimeAudioEventsExample = `import dev.axllm.ax.*;
import java.util.*;

public final class RealtimeAudioEventsExample {
  public static void main(String[] args) {
    GrokClient grok =
        new GrokClient(Map.of("model", "grok-voice-think-fast-1.0", "api_key", "test-key"));
    Map<String, Object> grokRequest =
        Map.of(
            "model",
            "grok-voice-think-fast-1.0",
            "chat_prompt",
            List.of(
                Map.of("role", "system", "content", "You are a concise voice agent."),
                Map.of("role", "user", "content", "Say hello.")),
            "audio",
            Map.of(
                "input",
                Map.of("sampleRate", 24000),
                "output",
                Map.of("sampleRate", 24000, "voice", "eve")));
    List<Object> grokEvents =
        List.of(
            Map.of("type", "response.output_audio_transcript.delta", "response_id", "grok_rt", "delta", "hello "),
            Map.of("type", "response.output_audio.delta", "response_id", "grok_rt", "delta", "AQI="),
            Map.of(
                "type",
                "response.done",
                "response",
                Map.of(
                    "id",
                    "grok_rt",
                    "usage",
                    Map.of("input_tokens", 3, "output_tokens", 2, "total_tokens", 5))));

    GoogleGeminiClient gemini =
        new GoogleGeminiClient(
            Map.of("model", "gemini-2.5-flash-native-audio-preview-12-2025", "api_key", "test-key"));
    Map<String, Object> geminiRequest =
        Map.of(
            "model",
            "gemini-2.5-flash-native-audio-preview-12-2025",
            "chat_prompt",
            List.of(
                Map.of("role", "system", "content", "Answer with audio."),
                Map.of(
                    "role",
                    "user",
                    "content",
                    List.of(
                        Map.of("type", "text", "text", "Realtime question"),
                        Map.of("type", "audio", "data", "AAAA", "format", "pcm16", "sampleRate", 16000)))),
            "audio",
            Map.of("output", Map.of("transcript", true, "voice", "Kore")));
    List<Object> geminiEvents =
        List.of(
            Map.of("id", "gemini_live_1", "serverContent", Map.of("outputTranscription", Map.of("text", "spoken "))),
            Map.of(
                "id",
                "gemini_live_2",
                "serverContent",
                Map.of(
                    "modelTurn",
                    Map.of("parts", List.of(Map.of("inlineData", Map.of("data", "AQI=", "mimeType", "audio/pcm")))))),
            Map.of(
                "id",
                "gemini_live_3",
                "toolCall",
                Map.of("functionCalls", List.of(Map.of("name", "lookup", "args", Map.of("q", "ax"))))),
            Map.of(
                "id",
                "gemini_live_done",
                "serverContent",
                Map.of("turnComplete", true),
                "usageMetadata",
                Map.of("promptTokenCount", 3, "candidatesTokenCount", 4, "totalTokenCount", 7)));

    System.out.println("grok setup:");
    System.out.println(Json.stringify(grok.realtimeAudioSetup(grokRequest)));
    System.out.println("grok normalized events:");
    System.out.println(Json.stringify(grok.realtime(grokEvents)));
    System.out.println("gemini setup:");
    System.out.println(Json.stringify(gemini.realtimeAudioSetup(geminiRequest)));
    System.out.println("gemini input messages:");
    System.out.println(Json.stringify(gemini.realtimeAudioInput(geminiRequest)));
    System.out.println("gemini normalized events:");
    System.out.println(Json.stringify(gemini.realtime(geminiEvents)));
  }
}
`

const javaGEPALocalOptimizerExample = `import dev.axllm.ax.*;
import java.util.*;

public final class GEPALocalOptimizerExample {
  static final class LocalEvaluator implements OptimizerEvaluator {
    public Map<String, Object> evaluate(Map<String, Object> candidateMap, Map<String, Object> options) {
      String instruction = String.valueOf(candidateMap.getOrDefault("qa::instruction", ""));
      List<?> examples = (List<?>) ((Map<?, ?>) options.get("dataset")).get("train");
      List<Map<String, Object>> rows = new ArrayList<>();
      double total = 0;
      for (Object example : examples) {
        double quality = instruction.toLowerCase(Locale.ROOT).contains("concise") ? 0.9 : 0.65;
        double brevity = 0.8;
        double scalar = (quality + brevity) / 2.0;
        total += scalar;
        rows.add(
            Map.of(
                "input",
                example,
                "prediction",
                Map.of("answer", "Ax composes typed LLM programs."),
                "scores",
                Map.of("quality", quality, "brevity", brevity),
                "scalar",
                scalar));
      }
      return Map.of("rows", rows, "avg", total / rows.size(), "sum", total, "count", rows.size());
    }
  }

  public static void main(String[] args) {
    Map<String, Object> request =
        Map.of(
            "programKind",
            "axgen",
            "components",
            List.of(
                Map.of(
                    "id",
                    "qa::instruction",
                    "owner",
                    "qa",
                    "kind",
                    "instruction",
                    "current",
                    "Answer clearly and concisely.")),
            "dataset",
            Map.of(
                "train",
                List.of(Map.of("question", "What is Ax?"), Map.of("question", "Why use typed signatures?")),
                "validation",
                List.of(Map.of("question", "Summarize Ax."))),
            "options",
            Map.of("numTrials", 0, "maxMetricCalls", 8, "seed", 7));

    Map<String, Object> artifact = new AxGEPA(null, Map.of("seed", 7)).optimize(request, new LocalEvaluator());
    System.out.println(
        Json.stringify(
            Map.of("componentMap", artifact.get("componentMap"), "metadata", artifact.get("metadata"))));
  }
}
`

const cppProviderStreamNoKeyExample = `#include "axllm/axllm.hpp"
#include <iostream>
#include <string>

struct ScriptedTransport : axllm::Transport {
  axllm::Value call(axllm::Value) override {
    return axllm::object({
      {"status", 200},
      {"body",
       "data: {\"id\":\"chatcmpl_stream\",\"model\":\"gpt-4.1-mini\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"hel\"}}]}\n\n"
       "data: {\"id\":\"chatcmpl_stream\",\"model\":\"gpt-4.1-mini\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"lo\"},\"finish_reason\":\"stop\"}]}\n\n"
       "data: [DONE]\n\n"}
    });
  }
};

int main() {
  ScriptedTransport transport;
  axllm::OpenAICompatibleClient client(axllm::object({{"api_key", "test-key"}, {"model", "gpt-4.1-mini"}}), &transport);
  std::string text;
  for (const auto& event : client.stream(axllm::object({
         {"chat_prompt", axllm::array({axllm::object({{"role", "user"}, {"content", "stream"}})})}
       }))) {
    text += axllm::display(axllm::Core::get(axllm::Core::get(axllm::Core::get(event, "results"), 0), "content", ""));
  }
  if (text != "hello") return 1;
  std::cout << "cpp-provider-stream-no-key " << text << "\n";
}
`

const cppAudioHTTPRoundtripExample = `#include "axllm/axllm.hpp"

#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>

#include <cctype>
#include <cstring>
#include <iostream>
#include <string>
#include <thread>

// Drive transcribe()/speak() through the REAL libcurl HttpTransport against an
// in-process loopback server, exercising the wire-level encoders the conformance
// ScriptedTransport bypasses: the multipart/form-data request body (transcribe)
// and binary (non-UTF8) response handling (speak). Returns non-zero on any
// mismatch so axir verify fails if either regresses. Requires libcurl
// (AXLLM_ENABLE_CURL); axir verify skips it when libcurl is unavailable.

namespace {

struct Request {
  std::string line;
  std::string content_type;
  std::string body;
};

Request read_request(int fd) {
  Request req;
  std::string buf;
  char tmp[4096];
  size_t header_end = 0;
  while (true) {
    size_t pos = buf.find("\r\n\r\n");
    if (pos != std::string::npos) {
      header_end = pos + 4;
      break;
    }
    ssize_t n = recv(fd, tmp, sizeof(tmp), 0);
    if (n <= 0) {
      header_end = buf.size();
      break;
    }
    buf.append(tmp, static_cast<size_t>(n));
  }
  std::string headers = buf.substr(0, header_end);
  size_t eol = headers.find("\r\n");
  req.line = headers.substr(0, eol == std::string::npos ? headers.size() : eol);
  size_t content_length = 0;
  size_t start = (eol == std::string::npos) ? headers.size() : eol + 2;
  while (start < headers.size()) {
    size_t next = headers.find("\r\n", start);
    std::string line =
        headers.substr(start, (next == std::string::npos ? headers.size() : next) - start);
    std::string lower = line;
    for (char& c : lower) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    if (lower.rfind("content-type:", 0) == 0) {
      req.content_type = line.substr(line.find(':') + 1);
      while (!req.content_type.empty() && req.content_type.front() == ' ') {
        req.content_type.erase(req.content_type.begin());
      }
    } else if (lower.rfind("content-length:", 0) == 0) {
      content_length = std::stoul(line.substr(line.find(':') + 1));
    }
    if (next == std::string::npos) break;
    start = next + 2;
  }
  req.body = buf.substr(header_end);
  while (req.body.size() < content_length) {
    ssize_t n = recv(fd, tmp, sizeof(tmp), 0);
    if (n <= 0) break;
    req.body.append(tmp, static_cast<size_t>(n));
  }
  return req;
}

void write_response(int fd, const std::string& content_type, const std::string& body) {
  std::string out = "HTTP/1.1 200 OK\r\nContent-Type: " + content_type +
                    "\r\nContent-Length: " + std::to_string(body.size()) +
                    "\r\nConnection: close\r\n\r\n" + body;
  size_t off = 0;
  while (off < out.size()) {
    ssize_t n = send(fd, out.data() + off, out.size() - off, 0);
    if (n <= 0) break;
    off += static_cast<size_t>(n);
  }
}

}  // namespace

int main() {
  // Deliberately non-UTF8 bytes so a UTF-8/JSON decode regression corrupts them.
  const char audio_raw[] = {0x00, 0x01, 0x02, static_cast<char>(0xff),
                            static_cast<char>(0xfe), 0x10, 0x7f};
  const std::string audio_bytes(audio_raw, sizeof(audio_raw));
  const std::string audio_b64 = "AAEC//4Qfw==";
  const char speech_raw[] = {static_cast<char>(0xff), static_cast<char>(0xd8),
                             static_cast<char>(0xff), 0x00, 0x11, 0x22, static_cast<char>(0xfe)};
  const std::string speech_bytes(speech_raw, sizeof(speech_raw));
  const std::string want_audio = "/9j/ABEi/g==";

  int server_fd = socket(AF_INET, SOCK_STREAM, 0);
  if (server_fd < 0) {
    std::cerr << "socket failed\n";
    return 1;
  }
  int opt = 1;
  setsockopt(server_fd, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt));
  sockaddr_in addr{};
  addr.sin_family = AF_INET;
  addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
  addr.sin_port = 0;
  if (bind(server_fd, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) < 0) {
    std::cerr << "bind failed\n";
    return 1;
  }
  if (listen(server_fd, 4) < 0) {
    std::cerr << "listen failed\n";
    return 1;
  }
  socklen_t alen = sizeof(addr);
  getsockname(server_fd, reinterpret_cast<sockaddr*>(&addr), &alen);
  int port = ntohs(addr.sin_port);

  bool saw_multipart = false;
  bool file_present = false;
  std::thread server([&]() {
    for (int handled = 0; handled < 2; ++handled) {
      int fd = accept(server_fd, nullptr, nullptr);
      if (fd < 0) break;
      Request req = read_request(fd);
      if (req.line.find("/audio/transcriptions") != std::string::npos) {
        saw_multipart = req.content_type.rfind("multipart/form-data; boundary=", 0) == 0;
        file_present = req.body.find(audio_bytes) != std::string::npos;
        write_response(fd, "application/json",
                       "{\"text\":\"hello world\",\"language\":\"en\",\"duration\":1.25}");
      } else if (req.line.find("/audio/speech") != std::string::npos) {
        write_response(fd, "audio/mpeg", speech_bytes);
      } else {
        write_response(fd, "text/plain", "");
      }
      close(fd);
    }
  });

  axllm::OpenAIResponsesClient client(
      axllm::object({{"api_key", "test-key"},
                     {"base_url", std::string("http://127.0.0.1:") + std::to_string(port)}}),
      nullptr);
  axllm::Value transcript = client.transcribe(axllm::object({{"audio", audio_b64},
                                                             {"language", "en"},
                                                             {"model", "gpt-4o-mini-transcribe"},
                                                             {"format", "json"}}));
  axllm::Value speech = client.speak(axllm::object(
      {{"text", "hello"}, {"voice", "alloy"}, {"format", "mp3"}, {"model", "gpt-4o-mini-tts"}}));

  server.join();
  close(server_fd);

  if (!saw_multipart) {
    std::cerr << "loopback server never received a multipart transcribe request\n";
    return 1;
  }
  if (!file_present) {
    std::cerr << "multipart body did not contain the decoded file bytes\n";
    return 1;
  }
  if (!axllm::equal(axllm::Core::get(transcript, "text"), "hello world")) {
    std::cerr << "transcribe response not normalized: " << axllm::stringify(transcript) << "\n";
    return 1;
  }
  if (!axllm::equal(axllm::Core::get(speech, "audio"), want_audio)) {
    std::cerr << "speak binary response not base64-encoded as expected: "
              << axllm::stringify(speech) << "\n";
    return 1;
  }
  std::cout << "audio-http-roundtrip-ok\n";
  return 0;
}
`

const cppFlowOpenAIExample = `#include "axllm/axllm.hpp"

#include <cstdlib>
#include <iostream>

int main() {
  const char* key = std::getenv("OPENAI_API_KEY");
  if (key == nullptr || std::string(key).empty()) key = std::getenv("OPENAI_APIKEY");
  if (key == nullptr || std::string(key).empty()) {
    std::cerr << "Set OPENAI_API_KEY or OPENAI_APIKEY to run this provider API example.\n";
    return 2;
  }

  const char* model = std::getenv("AX_OPENAI_MODEL");
  axllm::OpenAICompatibleClient client(axllm::object({
      {"api_key", key},
      {"model", model == nullptr || std::string(model).empty() ? "gpt-4.1-mini" : model},
      {"model_config", axllm::object({{"temperature", 0}})},
  }));
  axllm::AxGen outline = axllm::ax("topic:string -> outline:string");
  axllm::AxFlow program = axllm::flow(axllm::object({{"id", "examples.openaiApiFlow"}}))
      .execute("outline", outline)
      .map("summary",
           [](axllm::Value) {
             return axllm::object({{"summary", "Generated outline with typed Ax program steps."}});
           })
      .returns(axllm::object({{"outline", "outline"}, {"summary", "summary"}}));
  axllm::Value output = program.forward(
      client,
      axllm::object({{"topic", "how Ax composes typed LLM programs"}}));
  std::cout << axllm::stringify(output) << "\n";
}
`

const cppAudioResponsesMappingExample = `#include "axllm/axllm.hpp"

#include <iostream>
#include <string>

struct ScriptedTransport : axllm::Transport {
  axllm::Array requests;

  axllm::Value call(axllm::Value request) override {
    requests.push_back(request);
    std::string url = axllm::stringify(axllm::Core::get(request, "url"));
    if (url.find("/audio/speech") != std::string::npos) {
      return axllm::object({{"status", 200}, {"json", axllm::object({{"audio", "base64-speech"}})}});
    }
    if (url.find("/audio/transcriptions") != std::string::npos) {
      return axllm::object({
          {"status", 200},
          {"json", axllm::object({{"text", "hello world"}, {"language", "en"}, {"duration", 1.25}})},
      });
    }
    throw axllm::AxError("fixture", "unexpected audio request");
  }
};

int main() {
  ScriptedTransport transport;
  axllm::OpenAIResponsesClient client(axllm::object({{"api_key", "test-key"}}), &transport);
  axllm::Value speech =
      client.speak(axllm::object({{"text", "hello"}, {"voice", "alloy"}, {"format", "mp3"}}));
  axllm::Value transcript = client.transcribe(axllm::object({
      {"audio", "base64-audio"},
      {"language", "en"},
      {"model", "whisper-1"},
      {"format", "json"},
  }));
  if (!axllm::equal(axllm::Core::get(speech, "audio"), "base64-speech")) return 1;
  if (!axllm::equal(axllm::Core::get(transcript, "text"), "hello world")) return 2;

  std::cout << "normalized output:\n"
            << axllm::stringify(axllm::object({{"speak", speech}, {"transcribe", transcript}})) << "\n";
  std::cout << "transport requests:\n" << axllm::stringify(axllm::Value(transport.requests)) << "\n";
}
`

const cppRealtimeAudioEventsExample = `#include "axllm/axllm.hpp"

#include <iostream>

int main() {
  axllm::GrokClient grok(axllm::object({
      {"model", "grok-voice-think-fast-1.0"},
      {"api_key", "test-key"},
  }));
  axllm::Value grok_request = axllm::object({
      {"model", "grok-voice-think-fast-1.0"},
      {"chat_prompt",
       axllm::array({
           axllm::object({{"role", "system"}, {"content", "You are a concise voice agent."}}),
           axllm::object({{"role", "user"}, {"content", "Say hello."}}),
       })},
      {"audio",
       axllm::object({
           {"input", axllm::object({{"sampleRate", 24000}})},
           {"output", axllm::object({{"sampleRate", 24000}, {"voice", "eve"}})},
       })},
  });
  axllm::Value grok_events = axllm::array({
      axllm::object({{"type", "response.output_audio_transcript.delta"}, {"response_id", "grok_rt"}, {"delta", "hello "}}),
      axllm::object({{"type", "response.output_audio.delta"}, {"response_id", "grok_rt"}, {"delta", "AQI="}}),
      axllm::object({
          {"type", "response.done"},
          {"response",
           axllm::object({
               {"id", "grok_rt"},
               {"usage", axllm::object({{"input_tokens", 3}, {"output_tokens", 2}, {"total_tokens", 5}})},
           })},
      }),
  });

  axllm::GoogleGeminiClient gemini(axllm::object({
      {"model", "gemini-2.5-flash-native-audio-preview-12-2025"},
      {"api_key", "test-key"},
  }));
  axllm::Value gemini_request = axllm::object({
      {"model", "gemini-2.5-flash-native-audio-preview-12-2025"},
      {"chat_prompt",
       axllm::array({
           axllm::object({{"role", "system"}, {"content", "Answer with audio."}}),
           axllm::object({
               {"role", "user"},
               {"content",
                axllm::array({
                    axllm::object({{"type", "text"}, {"text", "Realtime question"}}),
                    axllm::object({{"type", "audio"}, {"data", "AAAA"}, {"format", "pcm16"}, {"sampleRate", 16000}}),
                })},
           }),
       })},
      {"audio", axllm::object({{"output", axllm::object({{"transcript", true}, {"voice", "Kore"}})}})},
  });
  axllm::Value gemini_audio_part = axllm::object({
      {"inlineData", axllm::object({{"data", "AQI="}, {"mimeType", "audio/pcm"}})},
  });
  axllm::Value gemini_turn_event = axllm::object({
      {"id", "gemini_live_2"},
      {"serverContent",
       axllm::object({
           {"modelTurn", axllm::object({{"parts", axllm::array({gemini_audio_part})}})},
       })},
  });
  axllm::Value gemini_tool_event = axllm::object({
      {"id", "gemini_live_3"},
      {"toolCall",
       axllm::object({
           {"functionCalls",
            axllm::array({axllm::object({{"name", "lookup"}, {"args", axllm::object({{"q", "ax"}})}})})},
       })},
  });
  axllm::Value gemini_events = axllm::array({
      axllm::object({{"id", "gemini_live_1"}, {"serverContent", axllm::object({{"outputTranscription", axllm::object({{"text", "spoken "}})}})}}),
      gemini_turn_event,
      gemini_tool_event,
      axllm::object({
          {"id", "gemini_live_done"},
          {"serverContent", axllm::object({{"turnComplete", true}})},
          {"usageMetadata", axllm::object({{"promptTokenCount", 3}, {"candidatesTokenCount", 4}, {"totalTokenCount", 7}})},
      }),
  });

  std::cout << "grok setup:\n" << axllm::stringify(grok.realtime_audio_setup(grok_request)) << "\n";
  std::cout << "grok normalized events:\n" << axllm::stringify(axllm::Value(grok.realtime(grok_events))) << "\n";
  std::cout << "gemini setup:\n" << axllm::stringify(gemini.realtime_audio_setup(gemini_request)) << "\n";
  std::cout << "gemini input messages:\n" << axllm::stringify(gemini.realtime_audio_input(gemini_request)) << "\n";
  std::cout << "gemini normalized events:\n" << axllm::stringify(axllm::Value(gemini.realtime(gemini_events))) << "\n";
}
`

const cppGEPALocalOptimizerExample = `#include "axllm/axllm.hpp"

#include <iostream>

struct LocalEvaluator : axllm::OptimizerEvaluator {
  axllm::Value evaluate(axllm::Value candidate_map, axllm::Value options = axllm::Value::object()) override {
    axllm::Value rows = axllm::Value::array();
    double total = 0.0;
    axllm::Value examples = axllm::Core::get(axllm::Core::get(options, "dataset"), "train", axllm::Value::array());
    std::string instruction = axllm::stringify(axllm::Core::get(candidate_map, "qa::instruction"));
    for (const auto& example : axllm::Core::iter(examples)) {
      double quality = instruction.find("concise") != std::string::npos ? 0.9 : 0.65;
      double brevity = 0.8;
      double scalar = (quality + brevity) / 2.0;
      total += scalar;
      axllm::Core::append(
          rows,
          axllm::object({
              {"input", example},
              {"prediction", axllm::object({{"answer", "Ax composes typed LLM programs."}})},
              {"scores", axllm::object({{"quality", quality}, {"brevity", brevity}})},
              {"scalar", scalar},
          }));
    }
    double count = axllm::Core::iter(rows).size();
    return axllm::object({{"rows", rows}, {"avg", total / count}, {"sum", total}, {"count", count}});
  }
};

int main() {
  axllm::Value request = axllm::object({
      {"programKind", "axgen"},
      {"components",
       axllm::array({
           axllm::object({
               {"id", "qa::instruction"},
               {"owner", "qa"},
               {"kind", "instruction"},
               {"current", "Answer clearly and concisely."},
           }),
       })},
      {"dataset",
       axllm::object({
           {"train",
            axllm::array({
                axllm::object({{"question", "What is Ax?"}}),
                axllm::object({{"question", "Why use typed signatures?"}}),
            })},
           {"validation", axllm::array({axllm::object({{"question", "Summarize Ax."}})})},
       })},
      {"options", axllm::object({{"numTrials", 0}, {"maxMetricCalls", 8}, {"seed", 7}})},
  });

  LocalEvaluator evaluator;
  axllm::AxGEPA gepa(nullptr, axllm::object({{"seed", 7}}));
  axllm::Value artifact = gepa.optimize(request, &evaluator);
  std::cout << axllm::stringify(axllm::object({
                   {"componentMap", axllm::Core::get(artifact, "componentMap")},
                   {"metadata", axllm::Core::get(artifact, "metadata")},
               }))
            << "\n";
}
`
