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
