# ax-example:start
# title: Python MCP Resource Wake
# group: mcp
# description: Subscribes over real Streamable HTTP and lets AxEventRuntime wake an authenticated Agent automatically.
# provider: openai
# env: OPENAI_API_KEY, OPENAI_APIKEY, AX_MCP_ENDPOINT
# level: intermediate
# order: 20
# story: 61
# ax-example:end
import os
import threading
import urllib.request

from axllm import (
    AxEventRoute,
    AxEventRuntime,
    AxEventTarget,
    AxMCPClient,
    AxMCPEventSource,
    AxMCPStreamableHTTPTransport,
    OpenAICompatibleClient,
    agent,
)
from axllm.runtime_quickjs import AxQuickJsCodeRuntime

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
source = AxMCPEventSource(
    client,
    "inventory",
    identity_scope="tenant:demo",
    trust="authenticated",
    subscriptions=["demo://inventory"],
)
llm = OpenAICompatibleClient(api_key=api_key, model="gpt-5.4-mini")
program = agent("uri:string -> summary:string", {"runtime": {"language": "JavaScript"}})
completed = threading.Event()


def invoke(input, _context):
    output = program.forward(llm, input, {"runtime": AxQuickJsCodeRuntime()})
    print(output)
    completed.set()
    return output


target = AxEventTarget(
    "inventory-agent",
    invoke,
    mapInput=lambda event, _continuation: {"uri": event.data["uri"]},
    retrySafety="idempotent",
)
runtime = AxEventRuntime(
    [
        AxEventRoute(
            "resource-wake",
            "wake",
            {"types": ["mcp.resource.updated"]},
            "inventory-agent",
            True,
        )
    ],
    {"targets": [target], "sources": [source]},
)
runtime.start()
if os.getenv("AX_MCP_DEMO_AUTO") == "1":
    urllib.request.urlopen(
        urllib.request.Request(
            endpoint.replace("/mcp", "/control/resource"), data=b"", method="POST"
        )
    ).close()
if not completed.wait(60):
    raise RuntimeError("Timed out waiting for an MCP resource notification")
runtime.close()
client.close()
