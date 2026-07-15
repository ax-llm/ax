# ax-example:start
# title: Python MCP Task Continuation
# group: mcp
# description: Creates an owned continuation and resumes an AxFlow from real MCP progress and terminal task notifications.
# provider: openai
# env: OPENAI_API_KEY, OPENAI_APIKEY, AX_MCP_ENDPOINT
# level: advanced
# order: 30
# story: 62
# ax-example:end
import os
import threading
import urllib.request

from axllm import (
    AxEventEnvelope,
    AxEventRoute,
    AxEventRuntime,
    AxEventTarget,
    AxMCPClient,
    AxMCPEventSource,
    AxMCPStreamableHTTPTransport,
    AxPushEventSource,
    OpenAICompatibleClient,
    ax,
    flow,
)

api_key = os.getenv("OPENAI_API_KEY") or os.getenv("OPENAI_APIKEY")
if not api_key:
    raise SystemExit("Set OPENAI_API_KEY.")

endpoint = os.environ.get("AX_MCP_ENDPOINT")
if not endpoint:
    raise SystemExit("Set AX_MCP_ENDPOINT to a Streamable HTTP MCP server.")
transport = AxMCPStreamableHTTPTransport(
    endpoint,
    {
        "ssrfProtection": {
            "requireHttps": not endpoint.startswith("http://127.0.0.1"),
            "allowLocalhost": endpoint.startswith("http://127.0.0.1"),
            "allowPrivateNetworks": endpoint.startswith("http://127.0.0.1"),
        }
    },
)
client = AxMCPClient(transport, {"namespace": "inventory"})
mcp = AxMCPEventSource(
    client, "inventory", identity_scope="tenant:demo", trust="authenticated"
)
started = AxPushEventSource("task-started")
llm = OpenAICompatibleClient(api_key=api_key, model="gpt-5.4-mini")
step = ax("taskId:string -> status:string")
program = (
    flow({"id": "reindex-flow"}).execute("status", step).returns({"status": "status"})
)
completed = threading.Event()
calls = 0


def invoke(input, _context):
    global calls
    output = program.forward(llm, input)
    calls += 1
    print(output)
    if calls >= 2:
        completed.set()
    return output


target = AxEventTarget(
    "reindex-flow",
    invoke,
    mapInput=lambda event, continuation: {
        "taskId": (
            continuation.metadata["taskId"] if continuation else event.data["taskId"]
        )
    },
    retrySafety="idempotent",
    waitFor=[{"kind": "mcp.task", "value": "taskKey", "metadata": {"taskId": "42"}}],
)
runtime = AxEventRuntime(
    [
        AxEventRoute(
            "task-start", "wake", {"types": ["app.task.started"]}, "reindex-flow"
        ),
        AxEventRoute("task-progress", "observe", {"types": ["mcp.progress"]}),
        AxEventRoute(
            "task-resume", "resume", {"types": ["mcp.task.status"]}, "reindex-flow"
        ),
    ],
    {"targets": [target], "sources": [started, mcp]},
)
runtime.start()
task_id = client.call_tool("start_reindex", {"scope": "all"})["task"]["taskId"]
target.waitFor[0]["metadata"] = {"taskId": task_id}
started.publish(
    AxEventEnvelope(
        "task-start",
        "app://tasks",
        "app.task.started",
        {"taskId": task_id, "taskKey": f"inventory:{task_id}"},
    ),
    identity_scope="tenant:demo",
    trust="authenticated",
)
print(f"Task {task_id} is waiting for a terminal MCP notification.")
if os.getenv("AX_MCP_DEMO_AUTO") == "1":
    urllib.request.urlopen(
        urllib.request.Request(
            endpoint.replace("/mcp", "/control/task/complete"), data=b"", method="POST"
        )
    ).close()
if not completed.wait(60):
    raise RuntimeError("Timed out waiting for the MCP task continuation")
runtime.close()
client.close()
