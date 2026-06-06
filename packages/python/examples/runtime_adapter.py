from axllm import AxCodeRuntime, AxCodeSession, RuntimeCapabilities, RuntimeEnvelope, agent


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
