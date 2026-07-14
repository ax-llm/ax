# ax-example:start
# title: Python Native MCP Tools
# group: mcp
# description: Attaches a live MCP client directly to AxGen without a lossy function adapter.
# provider: openai
# env: OPENAI_API_KEY, OPENAI_APIKEY, MCP_URL
# level: beginner
# order: 10
# story: 60
# ax-example:end
import os

from axllm import AxMCPClient, AxMCPStreamableHTTPTransport, OpenAICompatibleClient, ax

api_key = os.getenv("OPENAI_API_KEY") or os.getenv("OPENAI_APIKEY")
endpoint = os.getenv("MCP_URL")
if not api_key or not endpoint:
    raise SystemExit("Set OPENAI_API_KEY and MCP_URL.")

mcp = AxMCPClient(AxMCPStreamableHTTPTransport(endpoint), {"namespace": "inventory"})
llm = OpenAICompatibleClient(api_key=api_key, model="gpt-5.4-mini")
program = ax(
    'request:string -> answer:string "Use the inventory MCP tool."',
    {"mcp": mcp},
)
try:
    print(program.forward(llm, {"request": "Reindex inventory."}))
finally:
    mcp.close()
