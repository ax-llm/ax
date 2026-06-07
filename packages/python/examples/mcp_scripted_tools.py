from axllm import AxMCPClient
from axllm.mcp import AxMCPScriptedTransport


responses = [
    {
        "method": "initialize",
        "result": {
            "protocolVersion": "2025-11-25",
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "scripted-mcp", "version": "1.0.0"},
        },
    },
    {
        "method": "tools/list",
        "result": {
            "tools": [
                {
                    "name": "echo",
                    "description": "Echo text",
                    "inputSchema": {
                        "type": "object",
                        "properties": {"text": {"type": "string"}},
                    },
                }
            ]
        },
    },
    {"method": "tools/call", "result": {"structuredContent": {"echo": "hello"}}},
]

client = AxMCPClient(AxMCPScriptedTransport(responses))
client.init()
result = client.to_function()[0].call({"text": "hello"})
assert result["echo"] == "hello"
print("python-mcp-ok")
