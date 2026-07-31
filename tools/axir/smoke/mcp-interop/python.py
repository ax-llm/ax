import os

from axllm import AxMCPClient, AxMCPStreamableHTTPTransport


endpoint = os.environ["AX_MCP_ENDPOINT"]
transport = AxMCPStreamableHTTPTransport(
    endpoint,
    {
        "ssrfProtection": {
            "requireHttps": False,
            "allowLocalhost": True,
            "allowPrivateNetworks": True,
        }
    },
)
client = AxMCPClient(transport, {"namespace": "foreign", "era": "auto"})
catalog = client.inspect_catalog()
if client.get_era() != "legacy" or catalog["protocolVersion"] != "2025-11-25":
    raise RuntimeError(
        f"unexpected MCP classification: era={client.get_era()} version={catalog['protocolVersion']}"
    )
if not catalog["tools"]:
    raise RuntimeError("foreign MCP catalog has no tools")
print("AX_MCP_INTEROP_READY", flush=True)
result = client.call_tool("echo", {"message": "ax-interop-python"})
if "Echo: ax-interop-python" not in str(result):
    raise RuntimeError(f"unexpected echo result: {result}")
client.close()
print("AX_MCP_INTEROP_OK", flush=True)
