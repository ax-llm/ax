from axllm import ax, f, fn


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
