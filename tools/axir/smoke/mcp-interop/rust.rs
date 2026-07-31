use axllm::{AxMCPClient, AxMCPStreamableHTTPTransport, AxResult};
use serde_json::json;
use std::env;

fn main() -> AxResult<()> {
    let endpoint = env::var("AX_MCP_ENDPOINT").expect("AX_MCP_ENDPOINT is required");
    let transport = AxMCPStreamableHTTPTransport::new(
        endpoint,
        json!({
            "ssrfProtection": {
                "requireHttps": false,
                "allowLocalhost": true,
                "allowPrivateNetworks": true
            }
        }),
    )?;
    let mut client = AxMCPClient::new(
        Box::new(transport),
        json!({"namespace": "foreign", "era": "auto"}),
    );
    let catalog = client.inspect_catalog(false)?;
    if client.get_era() != Some("legacy")
        || catalog.protocol_version.as_deref() != Some("2025-11-25")
    {
        panic!(
            "unexpected MCP classification: era={:?} version={:?}",
            client.get_era(),
            catalog.protocol_version
        );
    }
    if catalog.tools.is_empty() {
        panic!("foreign MCP catalog has no tools");
    }
    println!("AX_MCP_INTEROP_READY");
    let result = client.call_tool("echo", json!({"message": "ax-interop-rust"}))?;
    if !result.to_string().contains("Echo: ax-interop-rust") {
        panic!("unexpected echo result: {result}");
    }
    client.close()?;
    println!("AX_MCP_INTEROP_OK");
    Ok(())
}
