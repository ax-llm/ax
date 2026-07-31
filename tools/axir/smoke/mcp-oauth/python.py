import json
import os
import urllib.request

from axllm import AxMCPStreamableHTTPTransport


def authorize(url):
    with urllib.request.urlopen(url) as response:
        return json.load(response)


endpoint = os.environ["AX_MCP_ENDPOINT"]
expected_error = os.environ.get("AX_MCP_EXPECT_ERROR", "")
protection = {
    "requireHttps": False,
    "allowLocalhost": True,
    "allowPrivateNetworks": True,
}
transport = AxMCPStreamableHTTPTransport(
    endpoint,
    {
        "ssrfProtection": protection,
        "oauth": {
            "clientId": "ax-port-client",
            "redirectUri": "http://localhost:8787/callback",
            "scopes": ["mcp:read"],
            "requireIss": True,
            "ssrfProtection": protection,
            "tokenStore": {},
            "onAuthCode": authorize,
        },
    },
)
try:
    for request_id, method in enumerate(("initialize", "tools/list"), 1):
        transport.send(
            {"jsonrpc": "2.0", "id": request_id, "method": method, "params": {}}
        )
except Exception as error:
    if expected_error and expected_error.lower() in str(error).lower():
        print("AX_MCP_OAUTH_EXPECTED_ERROR")
    else:
        raise
else:
    if expected_error:
        raise RuntimeError(f"expected {expected_error!r} error")
    print("AX_MCP_OAUTH_OK")
