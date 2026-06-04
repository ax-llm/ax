import json

from axllm import ax, flow


class FakeClient:
    def __init__(self):
        self.responses = [
            {"content": '{"outline":"1. Define Ax. 2. Show one concrete use."}'},
            {"content": '{"title":"Ax in two steps"}'},
        ]

    def complete(self, _request):
        if not self.responses:
            raise RuntimeError("fake service exhausted")
        return self.responses.pop(0)


outline = ax("topic:string -> outline:string")
program = (
    flow({"id": "examples.flow"})
    .execute("outline", outline)
    .map("title", lambda state: {"title": "Ax in two steps", "outlineLength": len(state["outline"])})
    .returns({"outline": "outline", "title": "title"})
)
output = program.forward(FakeClient(), {"topic": "Ax"})

print("flow output:")
print(json.dumps(output, indent=2, sort_keys=True))
print("flow plan:")
print(json.dumps(program.get_plan(), indent=2, sort_keys=True))
