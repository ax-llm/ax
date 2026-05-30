package axir

const pySignatureSchemaExample = `from ax import s

sig = s("question:string -> answer:string")
schema = sig.to_json_schema("outputs")
assert "answer" in schema["properties"], schema
print("python-signature-schema-ok")
`

const pyAxGenFakeClientToolExample = `from ax import ax, f, fn


class FakeClient:
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
qa.add_assertion({"field": "answer", "contains": "Ax", "message": "answer should mention Ax"})
qa.add_field_processor("answer", "trim")
out = qa.forward(FakeClient(), {"query": "ax docs"})
assert out == {"answer": "Found Ax docs"}, out
assert qa.get_traces()[-1]["output"] == out
print("python-axgen-ok")
`

const pyAxAIFakeTransportExample = `from ax import ai


def fake_transport(request):
    return {
        "status": 200,
        "json": {
            "id": "chatcmpl_example",
            "model": "gpt-4.1-mini",
            "choices": [
                {
                    "index": 0,
                    "finish_reason": "stop",
                    "message": {"content": "hello from fake transport"},
                }
            ],
            "usage": {"prompt_tokens": 1, "completion_tokens": 2, "total_tokens": 3},
        },
    }


service = ai("openai", model="gpt-4.1-mini", api_key="test-key", transport=fake_transport)
response = service.chat({"chat_prompt": [{"role": "user", "content": "hello"}]})
assert response["results"][0]["content"] == "hello from fake transport", response
print("python-axai-ok")
`

const pyAxAgentPipelineExample = `from ax import AxCodeRuntime, AxCodeSession, agent


class FakeService:
    def __init__(self):
        self.responses = [
            {"content": "{\"completion\":{\"type\":\"final\",\"args\":[\"Answer\",{}]}}"},
            {"content": "{\"completion\":{\"type\":\"final\",\"args\":[\"Answer\",{\"answer\":\"Paris\"}]}}"},
            {"content": "{\"answer\":\"Paris\"}"},
        ]

    def chat(self, request):
        if not self.responses:
            raise RuntimeError("fake service exhausted")
        raw = self.responses.pop(0)
        return {"results": [{"content": raw["content"], "function_calls": []}]}


class FakeSession(AxCodeSession):
    def execute(self, code, options=None):
        return {"type": "final", "args": [{"answer": "runtime"}]}

    def inspect_globals(self, options=None):
        return {}

    def export_state(self, options=None):
        return {"globals": {}}

    def restore_state(self, snapshot, options=None):
        return snapshot


class FakeRuntime(AxCodeRuntime):
    def create_session(self, globals, options=None):
        return FakeSession()


qa = agent("question:string -> answer:string", {"contextFields": []})
out = qa.forward(FakeService(), {"question": "Capital of France?"})
assert out == {"answer": "Paris"}, out
assert qa.get_chat_log()[-1]["name"] == "responder"
runtime_out = qa.test(FakeRuntime(), "final({answer: 'runtime'})", {"question": "runtime?"})
assert runtime_out["kind"] == "final", runtime_out
print("python-axagent-ok")
`

const pyAxFlowProgramGraphExample = `from ax import ax, flow


class FakeClient:
    def complete(self, request):
        return {"content": "{\"answer\":\"Paris\"}"}


qa = ax("question:string -> answer:string")
program = flow({"id": "example.flow"}).execute("qa", qa).returns({"answer": "answer"})
out = program.forward(FakeClient(), {"question": "Capital of France?"})
assert out == {"answer": "Paris"}, out
assert program.get_plan()["steps"][0]["name"] == "qa"
print("python-axflow-ok")
`

const pyRuntimeAdapterExample = `from ax import AxCodeRuntime, AxCodeSession, RuntimeCapabilities, RuntimeEnvelope, agent


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

const pyOptimizerArtifactExample = `import json

from ax import OptimizerEngine, ax


class FakeOptimizer(OptimizerEngine):
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
artifact = qa.optimize_with(FakeOptimizer(), [], {"apply": False})
assert any(item["id"] == "qa::instruction" and item["current"] == "Base." for item in qa.get_optimizable_components())
qa.apply_optimization(json.dumps(artifact))
assert any(
    item["id"] == "qa::instruction" and item["current"] == "Prefer artifact-backed answers."
    for item in qa.get_optimizable_components()
)
print("python-optimizer-artifact-ok")
`

const javaSignatureSchemaExample = `import dev.ax.*;
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

const javaAxGenFakeClientToolExample = `import dev.ax.*;
import java.util.*;

public final class AxGenFakeClientToolExample {
  static final class FakeClient implements AiClient {
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
      .addAssertion(Map.of("field", "answer", "contains", "Ax", "message", "answer should mention Ax"))
      .addFieldProcessor("answer", "trim");
    Map<String, Object> out = qa.forward(new FakeClient(), Map.of("query", "ax docs"));
    if (!"Found Ax docs".equals(out.get("answer"))) throw new RuntimeException("bad output: " + out);
    if (qa.getTraces().isEmpty()) throw new RuntimeException("missing trace");
    System.out.println("java-axgen-ok");
  }
}
`

const javaAxAIFakeTransportExample = `import dev.ax.*;
import java.util.*;

public final class AxAIFakeTransportExample {
  public static void main(String[] args) throws Exception {
    OpenAICompatibleClient.Transport transport = request -> Map.of(
      "status", 200,
      "json", Map.of(
        "id", "chatcmpl_example",
        "model", "gpt-4.1-mini",
        "choices", List.of(Map.of(
          "index", 0,
          "finish_reason", "stop",
          "message", Map.of("content", "hello from fake transport")
        )),
        "usage", Map.of("prompt_tokens", 1, "completion_tokens", 2, "total_tokens", 3)
      )
    );
    AxAIService service = Ax.ai("openai", Map.of("model", "gpt-4.1-mini", "api_key", "test-key", "transport", transport));
    Map<String, Object> response = service.chat(Map.of("chat_prompt", List.of(Map.of("role", "user", "content", "hello"))));
    List<?> results = (List<?>) response.get("results");
    Map<?, ?> first = (Map<?, ?>) results.get(0);
    if (!"hello from fake transport".equals(first.get("content"))) {
      throw new RuntimeException("bad response: " + response);
    }
    System.out.println("java-axai-ok");
  }
}
`

const javaAxAgentPipelineExample = `import dev.ax.*;
import java.util.*;

public final class AxAgentPipelineExample {
  static final class FakeService implements AiClient {
    final List<Map<String, Object>> responses = new ArrayList<>(List.of(
      Map.of("content", "{\"completion\":{\"type\":\"final\",\"args\":[\"Answer\",{}]}}"),
      Map.of("content", "{\"completion\":{\"type\":\"final\",\"args\":[\"Answer\",{\"answer\":\"Paris\"}]}}"),
      Map.of("content", "{\"answer\":\"Paris\"}")
    ));

    public Map<String, Object> complete(Map<String, Object> request) {
      if (responses.isEmpty()) throw new RuntimeException("fake service exhausted");
      return responses.remove(0);
    }
  }

  static final class FakeRuntime implements AxCodeRuntime {
    public AxCodeSession createSession(Map<String, Object> globals, Map<String, Object> options) {
      return new FakeSession();
    }
  }

  static final class FakeSession implements AxCodeSession {
    public Object execute(String code, Map<String, Object> options) {
      return Map.of("type", "final", "args", List.of(Map.of("answer", "runtime")));
    }
    public Object inspectGlobals(Map<String, Object> options) { return Map.of(); }
    public Object exportState(Map<String, Object> options) { return Map.of("globals", Map.of()); }
    public Object restoreState(Object snapshot, Map<String, Object> options) { return snapshot; }
    public Object close() { return Map.of("closed", true); }
  }

  public static void main(String[] args) {
    AxAgent qa = Ax.agent("question:string -> answer:string", Map.of("contextFields", List.of()));
    Map<String, Object> out = qa.forward(new FakeService(), Map.of("question", "Capital of France?"));
    if (!"Paris".equals(out.get("answer"))) throw new RuntimeException("bad output: " + out);
    if (!"responder".equals(((Map<?, ?>) qa.getChatLog().get(qa.getChatLog().size() - 1)).get("name"))) throw new RuntimeException("bad chat log");
    Map<String, Object> runtimeOut = qa.test(new FakeRuntime(), "final({answer:'runtime'})");
    if (!"final".equals(runtimeOut.get("kind"))) throw new RuntimeException("bad runtime output: " + runtimeOut);
    System.out.println("java-axagent-ok");
  }
}
`

const javaAxFlowProgramGraphExample = `import dev.ax.*;
import java.util.*;

public final class AxFlowProgramGraphExample {
  static final class FakeClient implements AiClient {
    public Map<String, Object> complete(Map<String, Object> request) {
      return Map.of("content", "{\"answer\":\"Paris\"}");
    }
  }

  public static void main(String[] args) {
    AxGen qa = Ax.ax("question:string -> answer:string");
    AxFlow program = Ax.flow(Map.of("id", "example.flow")).execute("qa", qa).returns(Map.of("answer", "answer"));
    Map<String, Object> out = program.forward(new FakeClient(), Map.of("question", "Capital of France?"));
    if (!"Paris".equals(out.get("answer"))) throw new RuntimeException("bad output: " + out);
    if (!"qa".equals(((Map<?, ?>) ((List<?>) program.getPlan().get("steps")).get(0)).get("name"))) throw new RuntimeException("bad plan");
    System.out.println("java-axflow-ok");
  }
}
`

const javaRuntimeAdapterExample = `import dev.ax.*;
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

const javaOptimizerArtifactExample = `import dev.ax.*;
import java.util.*;

public final class OptimizerArtifactExample {
  static final class FakeOptimizer implements OptimizerEngine {
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
    Map<String, Object> artifact = qa.optimizeWith(new FakeOptimizer(), List.of(), Map.of("apply", false));
    if (!hasInstruction(qa, "Base.")) throw new RuntimeException("apply=false mutated components");
    qa.applyOptimization(Json.stringify(artifact));
    if (!hasInstruction(qa, "Prefer artifact-backed answers.")) throw new RuntimeException("artifact not applied");
    System.out.println("java-optimizer-artifact-ok");
  }
}
`

const cppSignatureSchemaExample = `#include "ax/ax.hpp"
#include <iostream>

int main() {
  ax::Value sig = ax::s("question:string -> answer:string");
  ax::Value schema = ax::to_json_schema(ax::Core::get(sig, "outputs"));
  if (!ax::Core::truthy(ax::Core::get(ax::Core::get(schema, "properties"), "answer"))) return 1;
  std::cout << "cpp-signature-schema-ok\n";
}
`

const cppAxGenFakeClientToolExample = `#include "ax/ax.hpp"
#include <iostream>

struct FakeClient : ax::AIClient {
  int calls = 0;

  ax::Value complete(ax::Value) override {
    calls += 1;
    if (calls == 1) {
      return ax::object({
        {"content", ""},
        {"function_calls", ax::array({
          ax::object({{"id", "call_1"}, {"name", "search"}, {"params", ax::object({{"query", "ax docs"}})}})
        })}
      });
    }
    return ax::object({{"content", "{\"answer\":\"Found Ax docs\"}"}});
  }
};

int main() {
  ax::Value parameters = ax::object({
    {"type", "object"},
    {"properties", ax::object({{"query", ax::object({{"type", "string"}})}})},
    {"required", ax::array({"query"})}
  });
  ax::Tool search("search", "Search docs", parameters, [](ax::Value) {
    return ax::object({{"title", "Ax docs"}});
  });
  auto qa = ax::ax("query:string -> answer:string")
      .add_tool(search)
      .add_assertion(ax::object({{"field", "answer"}, {"contains", "Ax"}, {"message", "answer should mention Ax"}}))
      .add_field_processor("answer", "trim");
  FakeClient client;
  ax::Value out = qa.forward(client, ax::object({{"query", "ax docs"}}));
  if (!ax::equal(ax::Core::get(out, "answer"), "Found Ax docs")) return 1;
  if (ax::Core::truthy(ax::Core::is_none(ax::Core::get(qa.get_traces(), 0)))) return 1;
  std::cout << "cpp-axgen-ok\n";
}
`

const cppAxAIFakeTransportExample = `#include "ax/ax.hpp"
#include <iostream>

struct FakeTransport : ax::Transport {
  ax::Value call(ax::Value) override {
    return ax::object({
      {"status", 200},
      {"json", ax::object({
        {"id", "chatcmpl_example"},
        {"model", "gpt-4.1-mini"},
        {"choices", ax::array({
          ax::object({
            {"index", 0},
            {"finish_reason", "stop"},
            {"message", ax::object({{"content", "hello from fake transport"}})}
          })
        })},
        {"usage", ax::object({{"prompt_tokens", 1}, {"completion_tokens", 2}, {"total_tokens", 3}})}
      })}
    });
  }
};

int main() {
  FakeTransport transport;
  ax::OpenAICompatibleClient service(ax::object({{"model", "gpt-4.1-mini"}, {"api_key", "test-key"}}), &transport);
  ax::Value response = service.chat(ax::object({
    {"chat_prompt", ax::array({ax::object({{"role", "user"}, {"content", "hello"}})})}
  }));
  ax::Value first = ax::Core::get(ax::Core::get(response, "results"), 0);
  if (!ax::equal(ax::Core::get(first, "content"), "hello from fake transport")) return 1;
  std::cout << "cpp-axai-ok\n";
}
`

const cppAxAgentPipelineExample = `#include "ax/ax.hpp"
#include <iostream>

struct FakeService : ax::AIClient {
  ax::Array responses = {
    ax::object({{"content", "{\"completion\":{\"type\":\"final\",\"args\":[\"Answer\",{}]}}"}}),
    ax::object({{"content", "{\"completion\":{\"type\":\"final\",\"args\":[\"Answer\",{\"answer\":\"Paris\"}]}}"}}),
    ax::object({{"content", "{\"answer\":\"Paris\"}"}})
  };

  ax::Value complete(ax::Value) override {
    if (responses.empty()) throw ax::AxError("fixture", "fake service exhausted");
    ax::Value out = responses.front();
    responses.erase(responses.begin());
    return out;
  }
};

struct FakeSession : ax::AxCodeSession {
  ax::Value execute(ax::Value, ax::Value = ax::Value::object()) override {
    return ax::object({{"type", "final"}, {"args", ax::array({ax::object({{"answer", "runtime"}})})}});
  }
  ax::Value inspect(ax::Value = ax::Value::object()) override { return ax::Value::object(); }
  ax::Value export_state(ax::Value = ax::Value::object()) override { return ax::object({{"globals", ax::Value::object()}}); }
  ax::Value restore_state(ax::Value snapshot, ax::Value = ax::Value::object()) override { return snapshot; }
  ax::Value close() override { return ax::object({{"closed", true}}); }
};

struct FakeRuntime : ax::AxCodeRuntime {
  FakeSession session;
  ax::AxCodeSession* create_session(ax::Value, ax::Value = ax::Value::object()) override { return &session; }
};

int main() {
  auto qa = ax::agent("question:string -> answer:string", ax::object({{"contextFields", ax::array({})}}));
  FakeService service;
  ax::Value out = qa.forward(service, ax::object({{"question", "Capital of France?"}}));
  if (!ax::equal(ax::Core::get(out, "answer"), "Paris")) return 1;
  ax::Value last = ax::Core::get(qa.get_chat_log(), 2);
  if (!ax::equal(ax::Core::get(last, "name"), "responder")) return 2;
  FakeRuntime runtime;
  ax::Value runtime_out = qa.test(runtime, "final({answer:'runtime'})");
  if (!ax::equal(ax::Core::get(runtime_out, "kind"), "final")) return 3;
  std::cout << "cpp-axagent-ok\n";
}
`

const cppAxFlowProgramGraphExample = `#include "ax/ax.hpp"
#include <iostream>

struct FakeClient : ax::AIClient {
  ax::Value complete(ax::Value) override {
    return ax::object({{"content", "{\"answer\":\"Paris\"}"}});
  }
};

int main() {
  ax::AxGen qa = ax::ax("question:string -> answer:string");
  ax::AxFlow program = ax::flow(ax::object({{"id", "example.flow"}})).execute("qa", qa).returns(ax::object({{"answer", "answer"}}));
  FakeClient client;
  ax::Value out = program.forward(client, ax::object({{"question", "Capital of France?"}}));
  if (!ax::equal(ax::Core::get(out, "answer"), "Paris")) return 1;
  if (!ax::equal(ax::Core::get(ax::Core::get(ax::Core::get(program.get_plan(), "steps"), 0), "name"), "qa")) return 2;
  std::cout << "cpp-axflow-ok\n";
}
`

const cppRuntimeAdapterExample = `#include "ax/ax.hpp"
#include <iostream>

struct DemoSession : ax::AxCodeSession {
  ax::Value globals;
  ax::Value create_options;
  bool closed = false;

  DemoSession(ax::Value globals_, ax::Value options_) : globals(std::move(globals_)), create_options(std::move(options_)) {}

  ax::Value execute(ax::Value code, ax::Value options = ax::Value::object()) override {
    if (!ax::Core::truthy(ax::Core::map_contains(options, "reservedNames"))) throw ax::AxError("fixture", "missing reservedNames");
    if (ax::equal(code, "timeout()")) return ax::RuntimeEnvelope::timeout("demo timeout");
    ax::Core::set(globals, "answer", "runtime");
    return ax::RuntimeEnvelope::final_payload({ax::object({{"answer", ax::Core::get(globals, "answer")}})});
  }

  ax::Value inspect(ax::Value = ax::Value::object()) override { return globals; }
  ax::Value snapshot_globals(ax::Value = ax::Value::object()) override {
    return ax::object({{"version", 1}, {"bindings", globals}, {"globals", globals}, {"closed", closed}});
  }
  ax::Value patch_globals(ax::Value snapshot, ax::Value options = ax::Value::object()) override {
    globals = ax::Core::get(snapshot, "bindings", ax::Value::object());
    return snapshot_globals(options);
  }
  ax::Value close() override {
    closed = true;
    return ax::object({{"closed", true}});
  }
};

struct DemoRuntime : ax::AxCodeRuntime {
  ax::RuntimeCapabilities capabilities;
  std::vector<std::unique_ptr<DemoSession>> sessions;

  DemoRuntime() {
    capabilities.language = "Python";
    capabilities.snapshot = true;
    capabilities.patch = true;
  }

  std::string language() const override { return "Python"; }
  ax::AxCodeSession* create_session(ax::Value globals, ax::Value options = ax::Value::object()) override {
    sessions.push_back(std::make_unique<DemoSession>(std::move(globals), std::move(options)));
    return sessions.back().get();
  }
};

int main() {
  DemoRuntime runtime;
  auto qa = ax::agent("question:string -> answer:string", ax::object({{"runtime", ax::object({{"language", "Python"}})}}));
  ax::Value out = qa.test(runtime, "final()", ax::object({{"question", "adapter"}}));
  if (!ax::equal(ax::Core::get(out, "kind"), "final")) return 1;
  if (!runtime.sessions.back()->closed) return 2;

  auto runner = ax::agent("question:string -> answer:string", ax::object({{"runtime", ax::object({{"language", "Python"}})}}));
  ax::Value step = runner.execute_actor_step(runtime, "final()", ax::object({{"question", "adapter"}}));
  if (!ax::equal(ax::Core::get(step, "kind"), "final")) return 3;
  ax::Value snapshot = runner.export_session_state();
  runner.restore_session_state(snapshot);
  ax::Value timeout = runner.execute_actor_step(runtime, "timeout()", ax::object({{"question", "adapter"}}));
  if (!ax::equal(ax::Core::get(timeout, "error_category"), "timeout")) return 4;
  std::cout << "cpp-runtime-adapter-ok\n";
}
`

const cppOptimizerArtifactExample = `#include "ax/ax.hpp"
#include <iostream>

struct FakeOptimizer : ax::OptimizerEngine {
  std::string name() const override { return "fixture"; }
  std::string version() const override { return "1"; }
  ax::Value optimize(ax::Value) override {
    return ax::object({
      {"componentMap", ax::object({{"qa::instruction", "Prefer artifact-backed answers."}})},
      {"metadata", ax::object({
        {"evidence", ax::object({{"avg", 1}})},
        {"provenance", ax::object({{"sourceProgramKind", "axgen"}})}
      })}
    });
  }
};

static bool has_instruction(const ax::AxGen& gen, const std::string& value) {
  ax::Value components = gen.get_optimizable_components();
  for (int i = 0; ; ++i) {
    ax::Value item = ax::Core::get(components, i);
    if (ax::Core::truthy(ax::Core::is_none(item))) break;
    if (ax::equal(ax::Core::get(item, "id"), "qa::instruction") &&
        ax::equal(ax::Core::get(item, "current"), value)) return true;
  }
  return false;
}

int main() {
  ax::AxGen qa = ax::ax("question:string -> answer:string", ax::object({{"id", "qa"}, {"instruction", "Base."}}));
  FakeOptimizer engine;
  ax::Value artifact = qa.optimize_with(engine, ax::Value::array(), ax::object({{"apply", false}}));
  if (!has_instruction(qa, "Base.")) return 1;
  qa.apply_optimization(ax::Value(ax::stringify(artifact)));
  if (!has_instruction(qa, "Prefer artifact-backed answers.")) return 2;
  std::cout << "cpp-optimizer-artifact-ok\n";
}
`
