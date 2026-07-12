# ax-example:start
# title: Python MCP Task Continuation
# group: mcp
# description: Correlates a terminal MCP task event and dispatches a resume command to the owning AxFlow host.
# provider: openai
# env: OPENAI_API_KEY, OPENAI_APIKEY
# level: advanced
# order: 30
# story: 62
# ax-example:end
import os

from axllm import AxEventEnvelope, AxEventRoute, AxEventRuntime, OpenAICompatibleClient, ax, flow

api_key = os.getenv("OPENAI_API_KEY") or os.getenv("OPENAI_APIKEY")
if not api_key:
    raise SystemExit("Set OPENAI_API_KEY.")

runtime = AxEventRuntime([
    AxEventRoute("task-resume", "resume", {"types": ["mcp.task.status"]}, "reindex-flow")
])
normalized = runtime.normalize_mcp(
    "inventory", "notifications/tasks/status", {"task": {"taskId": "42", "status": "completed"}}
)
commands = runtime.publish(
    AxEventEnvelope("task-42-complete", normalized["source"], normalized["type"], normalized["data"], "inventory:42"),
    identity_scope="tenant:demo",
    trust="authenticated",
)
if any(command.action == "resume" for command in commands):
    llm = OpenAICompatibleClient(api_key=api_key, model="gpt-5.4-mini")
    step = ax('taskId:string -> status:string')
    program = flow({"id": "reindex-flow"}).execute("status", step).returns({"status": "status"})
    print(program.forward(llm, {"taskId": "42"}))
