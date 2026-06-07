from axllm import ax, flow


class ScriptedClient:
    def complete(self, request):
        return {"content": "{\"answer\":\"Paris\"}"}


qa = ax("question:string -> answer:string")
program = flow({"id": "example.flow"}).execute("qa", qa).returns({"answer": "answer"})
out = program.forward(ScriptedClient(), {"question": "Capital of France?"})
assert out == {"answer": "Paris"}, out
assert program.get_plan()["steps"][0]["name"] == "qa"
print("python-axflow-ok")
