from axllm import AxCodeRuntime, AxCodeSession, agent


class ScriptedService:
    def __init__(self):
        self.responses = [
            {"content": "{\"completion\":{\"type\":\"final\",\"args\":[\"Answer\",{}]}}"},
            {"content": "{\"completion\":{\"type\":\"final\",\"args\":[\"Answer\",{\"answer\":\"Paris\"}]}}"},
            {"content": "{\"answer\":\"Paris\"}"},
        ]

    def chat(self, request):
        if not self.responses:
            raise RuntimeError("scripted service exhausted")
        raw = self.responses.pop(0)
        return {"results": [{"content": raw["content"], "function_calls": []}]}


class ScriptedSession(AxCodeSession):
    def execute(self, code, options=None):
        return {"type": "final", "args": [{"answer": "runtime"}]}

    def inspect_globals(self, options=None):
        return {}

    def export_state(self, options=None):
        return {"globals": {}}

    def restore_state(self, snapshot, options=None):
        return snapshot


class ScriptedRuntime(AxCodeRuntime):
    def create_session(self, globals, options=None):
        return ScriptedSession()


qa = agent("question:string -> answer:string", {"contextFields": []})
out = qa.forward(ScriptedService(), {"question": "Capital of France?"})
assert out == {"answer": "Paris"}, out
assert qa.get_chat_log()[-1]["name"] == "responder"
runtime_out = qa.test(ScriptedRuntime(), "final({answer: 'runtime'})", {"question": "runtime?"})
assert runtime_out["kind"] == "final", runtime_out
print("python-axagent-ok")
