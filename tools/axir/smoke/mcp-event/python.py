import os
import threading
import time

from axllm import (
    AxEventEnvelope,
    AxEventRoute,
    AxEventRuntime,
    AxEventTarget,
    AxMCPClient,
    AxMCPEventSource,
    AxMCPStreamableHTTPTransport,
)


endpoint = os.environ["AX_MCP_ENDPOINT"]
transport = AxMCPStreamableHTTPTransport(
    endpoint,
    {
        "ssrfProtection": {
            "requireHttps": False,
            "allowLocalhost": True,
            "allowPrivateNetworks": True,
        },
        "reconnectDelay": 0.05,
    },
)
client = AxMCPClient(transport, {"namespace": "inventory"})

condition = threading.Condition()
state = {"resource": 0, "task": 0, "progress": 0}


def mark(name):
    with condition:
        state[name] += 1
        condition.notify_all()


client.add_notification_listener(
    lambda message: (
        mark("progress") if message.get("method") == "notifications/progress" else None
    )
)

resource_target = AxEventTarget(
    "resource-target",
    lambda value, _context: (mark("resource"), value)[1],
    retrySafety="idempotent",
)
task_target = AxEventTarget(
    "task-target",
    lambda value, _context: (mark("task"), value)[1],
    mapInput=lambda event, continuation: {
        "taskId": continuation.metadata["taskId"]
        if continuation
        else event.data["taskId"]
    },
    retrySafety="idempotent",
    waitFor=[{"kind": "mcp.task", "value": "taskKey", "metadata": {}}],
)
source = AxMCPEventSource(
    client,
    "inventory",
    identity_scope="tenant:smoke",
    trust="authenticated",
    subscriptions=["demo://inventory"],
)
runtime = AxEventRuntime(
    [
        AxEventRoute(
            "resource-wake",
            "wake",
            {"types": ["mcp.resource.updated"]},
            "resource-target",
            True,
        ),
        AxEventRoute(
            "task-start", "wake", {"types": ["app.task.started"]}, "task-target"
        ),
        AxEventRoute("task-progress", "observe", {"types": ["mcp.progress"]}),
        AxEventRoute(
            "task-resume", "resume", {"types": ["mcp.task.status"]}, "task-target"
        ),
    ],
    {"targets": [resource_target, task_target], "sources": [source]},
)

runtime.start()
task = client.call_tool("start_reindex", {"scope": "all"})["task"]
task_id = task["taskId"]
task_target.waitFor[0]["metadata"] = {"taskId": task_id}
runtime.publish(
    AxEventEnvelope(
        "task-start",
        "app://smoke",
        "app.task.started",
        {"taskId": task_id, "taskKey": f"inventory:{task_id}"},
    ),
    identity_scope="tenant:smoke",
    trust="authenticated",
)
print("AX_MCP_SMOKE_READY", flush=True)

deadline = time.monotonic() + 20
with condition:
    while not (
        state["resource"] >= 1 and state["task"] >= 2 and state["progress"] >= 1
    ):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise RuntimeError(f"MCP event smoke timed out: {state}")
        condition.wait(remaining)

source.close()
client.close()
runtime.close()
print(
    f"AX_MCP_SMOKE_OK resource={state['resource']} task={state['task']} progress={state['progress']}",
    flush=True,
)
