import json

from axllm import agent


class FakeService:
    def __init__(self):
        self.responses = [
            {"content": '{"completion":{"type":"final","args":["Answer",{}]}}'},
            {"content": '{"completion":{"type":"final","args":["Answer",{"answer":"Paris"}]}}'},
            {"content": '{"answer":"Paris"}'},
        ]

    def chat(self, _request):
        if not self.responses:
            raise RuntimeError("fake service exhausted")
        raw = self.responses.pop(0)
        return {"results": [{"content": raw["content"], "function_calls": []}]}


qa = agent("question:string -> answer:string", {"contextFields": []})
output = qa.forward(FakeService(), {"question": "Capital of France?"})

print("final output:")
print(json.dumps(output, indent=2, sort_keys=True))
print("chat log evidence:")
print(json.dumps([entry["name"] for entry in qa.get_chat_log()], indent=2))
print("action log evidence:")
print(json.dumps([entry.get("type") for entry in qa.get_action_log()], indent=2))
