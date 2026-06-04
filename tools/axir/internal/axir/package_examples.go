package axir

const pySignatureSchemaExample = `from axllm import s

sig = s("question:string -> answer:string")
schema = sig.to_json_schema("outputs")
assert "answer" in schema["properties"], schema
print("python-signature-schema-ok")
`

const pyAxGenFakeClientToolExample = `from axllm import ax, f, fn


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

const pyAxGenLiveOpenAIExample = `import json
import os

from axllm import OpenAICompatibleClient, ax


api_key = os.getenv("OPENAI_API_KEY") or os.getenv("OPENAI_APIKEY")
if not api_key:
    raise SystemExit("Set OPENAI_API_KEY to run this live example.")

client = OpenAICompatibleClient(
    api_key=api_key,
    model=os.getenv("AX_LIVE_MODEL", "gpt-4.1-mini"),
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

const pyAxAIFakeTransportExample = `from axllm import ai


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

const pyAxAgentPipelineExample = `from axllm import AxCodeRuntime, AxCodeSession, agent


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

const pyAxFlowProgramGraphExample = `from axllm import ax, flow


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
    ["node", "--env-file=.env", "--import=tsx", server],
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

const javaAxGenFakeClientToolExample = `import dev.axllm.ax.*;
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

const javaAxGenLiveOpenAIExample = `import dev.axllm.ax.*;
import java.util.*;

public final class AxGenLiveOpenAIExample {
  public static void main(String[] args) throws Exception {
    String apiKey = System.getenv("OPENAI_API_KEY");
    if (apiKey == null || apiKey.isBlank()) apiKey = System.getenv("OPENAI_APIKEY");
    if (apiKey == null || apiKey.isBlank()) {
      throw new IllegalStateException("Set OPENAI_API_KEY to run this live example.");
    }
    OpenAICompatibleClient client = new OpenAICompatibleClient(Map.of(
      "api_key", apiKey,
      "model", System.getenv().getOrDefault("AX_LIVE_MODEL", "gpt-4.1-mini"),
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

const javaAxAIFakeTransportExample = `import dev.axllm.ax.*;
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

const javaAxAgentPipelineExample = `import dev.axllm.ax.*;
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

const javaAxFlowProgramGraphExample = `import dev.axllm.ax.*;
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
      List.of("node", "--env-file=.env", "--import=tsx", server),
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

const cppSignatureSchemaExample = `#include "axllm/axllm.hpp"
#include <iostream>

int main() {
  axllm::Value sig = axllm::s("question:string -> answer:string");
  axllm::Value schema = axllm::to_json_schema(axllm::Core::get(sig, "outputs"));
  if (!axllm::Core::truthy(axllm::Core::get(axllm::Core::get(schema, "properties"), "answer"))) return 1;
  std::cout << "cpp-signature-schema-ok\n";
}
`

const cppAxGenFakeClientToolExample = `#include "axllm/axllm.hpp"
#include <iostream>

struct FakeClient : axllm::AIClient {
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
      .add_assertion(axllm::object({{"field", "answer"}, {"contains", "Ax"}, {"message", "answer should mention Ax"}}))
      .add_field_processor("answer", "trim");
  FakeClient client;
  axllm::Value out = qa.forward(client, axllm::object({{"query", "ax docs"}}));
  if (!axllm::equal(axllm::Core::get(out, "answer"), "Found Ax docs")) return 1;
  if (axllm::Core::truthy(axllm::Core::is_none(axllm::Core::get(qa.get_traces(), 0)))) return 1;
  std::cout << "cpp-axgen-ok\n";
}
`

const cppAxGenLiveOpenAIExample = `#include "axllm/axllm.hpp"
#include <cstdlib>
#include <iostream>

int main() {
  const char* key = std::getenv("OPENAI_API_KEY");
  if (key == nullptr || std::string(key).empty()) key = std::getenv("OPENAI_APIKEY");
  if (key == nullptr || std::string(key).empty()) {
    std::cerr << "Set OPENAI_API_KEY to run this live example.\n";
    return 2;
  }

  axllm::OpenAICompatibleClient client(axllm::object({
    {"api_key", key},
    {"model", std::getenv("AX_LIVE_MODEL") ? std::getenv("AX_LIVE_MODEL") : "gpt-4.1-mini"},
    {"model_config", axllm::object({{"temperature", 0}})}
  }));
  auto program = axllm::ax("question:string -> answer:string");
  axllm::Value out = program.forward(client, axllm::object({
    {"question", "In one sentence, explain Ax as a language-agnostic LLM programming library."}
  }));
  std::cout << axllm::stringify(out) << "\n";
}
`

const cppAxAIFakeTransportExample = `#include "axllm/axllm.hpp"
#include <iostream>

struct FakeTransport : axllm::Transport {
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
            {"message", axllm::object({{"content", "hello from fake transport"}})}
          })
        })},
        {"usage", axllm::object({{"prompt_tokens", 1}, {"completion_tokens", 2}, {"total_tokens", 3}})}
      })}
    });
  }
};

int main() {
  FakeTransport transport;
  axllm::OpenAICompatibleClient service(axllm::object({{"model", "gpt-4.1-mini"}, {"api_key", "test-key"}}), &transport);
  axllm::Value response = service.chat(axllm::object({
    {"chat_prompt", axllm::array({axllm::object({{"role", "user"}, {"content", "hello"}})})}
  }));
  axllm::Value first = axllm::Core::get(axllm::Core::get(response, "results"), 0);
  if (!axllm::equal(axllm::Core::get(first, "content"), "hello from fake transport")) return 1;
  std::cout << "cpp-axai-ok\n";
}
`

const cppAxAgentPipelineExample = `#include "axllm/axllm.hpp"
#include <iostream>

struct FakeService : axllm::AIClient {
  axllm::Array responses = {
    axllm::object({{"content", "{\"completion\":{\"type\":\"final\",\"args\":[\"Answer\",{}]}}"}}),
    axllm::object({{"content", "{\"completion\":{\"type\":\"final\",\"args\":[\"Answer\",{\"answer\":\"Paris\"}]}}"}}),
    axllm::object({{"content", "{\"answer\":\"Paris\"}"}})
  };

  axllm::Value complete(axllm::Value) override {
    if (responses.empty()) throw axllm::AxError("fixture", "fake service exhausted");
    axllm::Value out = responses.front();
    responses.erase(responses.begin());
    return out;
  }
};

struct FakeSession : axllm::AxCodeSession {
  axllm::Value execute(axllm::Value, axllm::Value = axllm::Value::object()) override {
    return axllm::object({{"type", "final"}, {"args", axllm::array({axllm::object({{"answer", "runtime"}})})}});
  }
  axllm::Value inspect(axllm::Value = axllm::Value::object()) override { return axllm::Value::object(); }
  axllm::Value export_state(axllm::Value = axllm::Value::object()) override { return axllm::object({{"globals", axllm::Value::object()}}); }
  axllm::Value restore_state(axllm::Value snapshot, axllm::Value = axllm::Value::object()) override { return snapshot; }
  axllm::Value close() override { return axllm::object({{"closed", true}}); }
};

struct FakeRuntime : axllm::AxCodeRuntime {
  FakeSession session;
  axllm::AxCodeSession* create_session(axllm::Value, axllm::Value = axllm::Value::object()) override { return &session; }
};

int main() {
  auto qa = axllm::agent("question:string -> answer:string", axllm::object({{"contextFields", axllm::array({})}}));
  FakeService service;
  axllm::Value out = qa.forward(service, axllm::object({{"question", "Capital of France?"}}));
  if (!axllm::equal(axllm::Core::get(out, "answer"), "Paris")) return 1;
  axllm::Value last = axllm::Core::get(qa.get_chat_log(), 2);
  if (!axllm::equal(axllm::Core::get(last, "name"), "responder")) return 2;
  FakeRuntime runtime;
  axllm::Value runtime_out = qa.test(runtime, "final({answer:'runtime'})");
  if (!axllm::equal(axllm::Core::get(runtime_out, "kind"), "final")) return 3;
  std::cout << "cpp-axagent-ok\n";
}
`

const cppAxFlowProgramGraphExample = `#include "axllm/axllm.hpp"
#include <iostream>

struct FakeClient : axllm::AIClient {
  axllm::Value complete(axllm::Value) override {
    return axllm::object({{"content", "{\"answer\":\"Paris\"}"}});
  }
};

int main() {
  axllm::AxGen qa = axllm::ax("question:string -> answer:string");
  axllm::AxFlow program = axllm::flow(axllm::object({{"id", "example.flow"}})).execute("qa", qa).returns(axllm::object({{"answer", "answer"}}));
  FakeClient client;
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

struct FakeRuntimeTransport : axllm::RuntimeTransport {
  int next_session = 0;

  axllm::Value call(axllm::Value message) override {
    axllm::Value id = axllm::Core::get(message, "id");
    axllm::Value op = axllm::Core::get(message, "op");
    if (axllm::equal(op, "capabilities")) {
      return axllm::object({{"id", id}, {"ok", true}, {"result", axllm::object({{"language", "JavaScript"}, {"usage_instructions", "fake protocol"}})}});
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
  FakeRuntimeTransport transport;
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

struct FakeOptimizer : axllm::OptimizerEngine {
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
  FakeOptimizer engine;
  axllm::Value artifact = qa.optimize_with(engine, axllm::Value::array(), axllm::object({{"apply", false}}));
  if (!has_instruction(qa, "Base.")) return 1;
  qa.apply_optimization(axllm::Value(axllm::stringify(artifact)));
  if (!has_instruction(qa, "Prefer artifact-backed answers.")) return 2;
  std::cout << "cpp-optimizer-artifact-ok\n";
}
`
