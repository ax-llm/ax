import os

from axllm import ProcessCodeRuntime, agent


class ScriptedClient:
    def __init__(self, responses):
        self.responses = list(responses)
        self.requests = []

    def complete(self, request):
        self.requests.append(request)
        if not self.responses:
            raise RuntimeError("scripted client exhausted")
        return self.responses.pop(0)

server = os.environ.get("AXIR_PYODIDE_RUNTIME_SERVER")
if not server:
    raise RuntimeError("AXIR_PYODIDE_RUNTIME_SERVER is required for the python-pyodide profile example")

runtime = ProcessCodeRuntime(server, cwd=os.environ.get("AXIR_REPO_ROOT"))
try:
    qa = agent("question:string -> answer:string", {"runtime": {"language": "Python"}})
    out = qa.test(runtime, "answer = inputs['question']\nfinal({'answer': answer})", {"question": "pyodide"})
    assert out["kind"] == "final", out
    first = out["completion_payload"]["args"][0]
    assert first["answer"] == "pyodide", out

    forward_agent = agent(
        "question:string -> answer:string",
        {
            "runtime": {"language": "Python"},
            "functionDiscovery": True,
            "memoriesMode": True,
            "functions": [{"name": "search", "description": "Search docs"}],
            "memory_search_results": {
                "prefs": [{"id": "mem1", "content": "likes concise docs"}]
            },
        },
    )
    forward_client = ScriptedClient(
        [
            {"content": "{\"pythonCode\":\"final('Run actor', {})\"}"},
            {"content": "{\"pythonCode\":\"counter = 41\\ndiscover({'tools': ['search']})\"}"},
            {"content": "{\"pythonCode\":\"recall('prefs')\"}"},
            {
                "content": "{\"pythonCode\":\"hit = search({'query': inputs['question']})\\nfinal('Answer', {'answer': hit['title']})\"}"
            },
            {"content": "{\"answer\":\"Docs\"}"},
        ]
    )
    forward_out = forward_agent.forward(
        forward_client,
        {"question": "pyodide"},
        {"runtime": runtime, "max_actor_steps": 4},
    )
    assert forward_out["answer"] == "Docs", forward_out
    assert len(forward_client.requests) == 5, forward_client.requests
    action_log_text = str(forward_agent.get_action_log())
    assert "discover" in action_log_text and "recall" in action_log_text and "Docs" in action_log_text, action_log_text
    state_text = str(forward_agent.export_runtime_state())
    assert "likes concise docs" in state_text, state_text
    trace_kinds = [event.get("kind") for event in forward_agent.export_trace().get("events", [])]
    for kind in ["runtime_execute", "discover", "recall", "final"]:
        assert kind in trace_kinds, trace_kinds
    restored_agent = agent("question:string -> answer:string", {"runtime": {"language": "Python"}})
    restored_agent.restore_runtime_state(forward_agent.export_runtime_state())
    assert "likes concise docs" in str(restored_agent.export_runtime_state()), restored_agent.export_runtime_state()

    guide_agent = agent("question:string -> answer:string", {"runtime": {"language": "Python"}})
    guide_client = ScriptedClient(
        [
            {"content": "{\"pythonCode\":\"final('Guide', {})\"}"},
            {"content": "{\"pythonCode\":\"guideAgent('Prefer concise final.')\"}"},
            {"content": "{\"pythonCode\":\"final('Answer', {'answer': 'Concise'})\"}"},
            {"content": "{\"answer\":\"Concise\"}"},
        ]
    )
    guide_out = guide_agent.forward(
        guide_client,
        {"question": "pyodide"},
        {"runtime": runtime, "max_actor_steps": 3},
    )
    assert guide_out["answer"] == "Concise", guide_out
    guide_text = str(guide_agent.get_action_log()) + str(guide_agent.export_trace()) + str(guide_client.requests)
    assert "guide_agent" in guide_text and "Prefer concise final." in guide_text, guide_text

    clarification_agent = agent("question:string -> answer:string", {"runtime": {"language": "Python"}})
    clarification_client = ScriptedClient(
        [
            {"content": "{\"pythonCode\":\"final('Ask', {})\"}"},
            {"content": "{\"pythonCode\":\"askClarification('Need detail?')\"}"},
        ]
    )
    try:
        clarification_agent.forward(
            clarification_client,
            {"question": "pyodide"},
            {"runtime": runtime, "max_actor_steps": 1},
        )
    except Exception as exc:
        assert "Need detail" in str(exc), exc
    else:
        raise AssertionError("expected runtime clarification")

    session = runtime.create_session(
        {
            "inputs": {"question": "pyodide"},
            "search": {"__ax_host_callable": True, "native": True},
            "badTool": {"__ax_host_callable": True, "native": True},
        },
        {"reservedNames": ["inputs"]},
    )
    try:
        step1 = session.execute("counter = globals().get('counter', 0) + 1\nfinal({'counter': counter})")
        step2 = session.execute("counter = counter + 1\nfinal({'counter': counter})")
        assert step1["type"] == "final", step1
        assert step2["args"][0]["counter"] == 2, step2
        assert session.execute("askClarification({'question': 'Need detail?'})")["type"] == "askClarification"
        assert session.execute("discover({'tools': ['search']})")["kind"] == "discover"
        assert session.execute("recall({'query': 'docs'})")["kind"] == "recall"
        assert session.execute("used('mem1', 'helpful')")["kind"] == "used"
        assert session.execute("reportSuccess('ok')")["kind"] == "status"
        assert session.execute("reportFailure('bad')")["kind"] == "status"
        assert session.execute("guideAgent('try this')")["type"] == "guide_agent"
        bridged = session.execute("hit = search({'query': inputs['question']})\nfinal({'title': hit['title']})")
        assert bridged["type"] == "final", bridged
        assert bridged["args"][0]["title"] == "Docs", bridged
        failed = session.execute("err = badTool({})\nfinal({'error': err['error']})")
        assert failed["args"][0]["error"] == "tool failed", failed
        diagnostic = session.execute("print('hello from pyodide')\nfinal({'ok': True})")
        assert "hello from pyodide" in str(diagnostic), diagnostic
        package_denied = session.execute("pkg = loadPackage('numpy')\nfinal({'error': pkg['error']})")
        assert "package loading is disabled" in package_denied["args"][0]["error"], package_denied
        snapshot = session.snapshot_globals()
        assert "inputs" not in snapshot["bindings"], snapshot
        session.patch_globals({"bindings": {"safe": 9}})
        inspected = session.inspect_globals()
        assert inspected["safe"] == 9, inspected
        runtime_error = session.execute("raise Exception('boom')")
        assert runtime_error["error_category"] == "runtime", runtime_error
    finally:
        session.close()
    closed = session.execute("final({'answer': 'closed'})")
    assert closed["error_category"] == "session_closed", closed
finally:
    runtime.shutdown()

print("python-pyodide-profile-ok runtime-behavior-parity-ok")
