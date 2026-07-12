# ax-example:start
# title: Python MCP Resource Wake
# group: mcp
# description: Normalizes a subscribed resource notification and dispatches an authenticated wake command to an Agent.
# provider: openai
# env: OPENAI_API_KEY, OPENAI_APIKEY
# level: intermediate
# order: 20
# story: 61
# ax-example:end
import os

from axllm import AxEventEnvelope, AxEventRoute, AxEventRuntime, OpenAICompatibleClient, agent
from axllm.runtime_quickjs import AxQuickJsCodeRuntime

api_key = os.getenv("OPENAI_API_KEY") or os.getenv("OPENAI_APIKEY")
if not api_key:
    raise SystemExit("Set OPENAI_API_KEY.")

runtime = AxEventRuntime([
    AxEventRoute("resource-wake", "wake", {"types": ["mcp.resource.updated"]}, "inventory-agent", True)
])
normalized = runtime.normalize_mcp(
    "inventory", "notifications/resources/updated", {"uri": "demo://inventory"}
)
commands = runtime.publish(
    AxEventEnvelope("resource-1", normalized["source"], normalized["type"], normalized["data"], "tenant:demo"),
    identity_scope="tenant:demo",
    trust="authenticated",
)
if any(command.action == "wake" for command in commands):
    llm = OpenAICompatibleClient(api_key=api_key, model="gpt-5.4-mini")
    program = agent('uri:string -> summary:string', {"runtime": {"language": "JavaScript"}})
    print(program.forward(llm, {"uri": "demo://inventory"}, {"runtime": AxQuickJsCodeRuntime()}))
