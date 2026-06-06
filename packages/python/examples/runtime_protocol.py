import os
from pathlib import Path

from axllm import ProcessCodeRuntime, agent


repo_root = Path(os.environ["AXIR_REPO_ROOT"])
server = os.environ["AXIR_AXJS_RUNTIME_SERVER"]
runtime = ProcessCodeRuntime(
    ["node", "--import=tsx", server],
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
