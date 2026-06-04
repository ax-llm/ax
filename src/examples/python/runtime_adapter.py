import json

from axllm import AxCodeRuntime, AxCodeSession, RuntimeEnvelope, agent


class DemoSession(AxCodeSession):
    def __init__(self, globals, options=None):
        self.globals = dict(globals or {})
        self.create_options = dict(options or {})
        self.closed = False

    def execute(self, code, options=None):
        if "reservedNames" not in (options or {}):
            raise RuntimeError("reservedNames were not passed to the runtime")
        if code == "timeout()":
            return RuntimeEnvelope.timeout("demo timeout")
        self.globals["answer"] = "runtime final"
        return RuntimeEnvelope.final({"answer": self.globals["answer"]})

    def inspect_globals(self, options=None):
        return dict(self.globals)

    def snapshot_globals(self, options=None):
        return {"version": 1, "bindings": dict(self.globals), "closed": self.closed}

    def patch_globals(self, snapshot, options=None):
        self.globals = dict((snapshot or {}).get("bindings") or {})
        return self.snapshot_globals(options)

    def close(self):
        self.closed = True
        return {"closed": True}


class DemoRuntime(AxCodeRuntime):
    language = "Python"

    def __init__(self):
        self.sessions = []

    def create_session(self, globals, options=None):
        session = DemoSession(globals, options)
        self.sessions.append(session)
        return session


runtime = DemoRuntime()
runner = agent("question:string -> answer:string", {"runtime": {"language": "Python"}})
step = runner.execute_actor_step(runtime, "final()", {"question": "adapter"})
snapshot = runner.export_session_state()
runner.restore_session_state(snapshot)
timeout = runner.execute_actor_step(runtime, "timeout()", {"question": "adapter"})
closed = runner.close_runtime_session()

bindings = snapshot.get("bindings") or {}
print(
    json.dumps(
        {
            "stepKind": step["kind"],
            "finalArgs": step["completion_payload"]["args"],
            "snapshotKeys": sorted(bindings.keys()),
            "snapshotAnswer": bindings.get("answer"),
            "timeoutCategory": timeout["error_category"],
            "closed": closed,
        },
        indent=2,
        sort_keys=True,
    )
)
