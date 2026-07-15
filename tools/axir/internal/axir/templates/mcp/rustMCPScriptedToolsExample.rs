use axllm::{mcp::AxMCPScriptedTransport, AxMCPClient, AxResult};
use serde_json::json;

fn main() -> AxResult<()> {
    let responses = vec![
        json!({"method":"initialize","result":{"protocolVersion":"2025-11-25","capabilities":{"tools":{}},"serverInfo":{"name":"scripted-mcp","version":"1.0.0"}}}),
        json!({"method":"tools/list","result":{"tools":[{"name":"echo","description":"Echo text","inputSchema":{"type":"object"}}]}}),
        json!({"method":"tools/call","result":{"structuredContent":{"echo":"hello"}}}),
    ];
    let mut client = AxMCPClient::new(Box::new(AxMCPScriptedTransport::new(responses)), json!({}));
    client.init()?;
    let result = client.native_tools()[0].call(json!({"text":"hello"}))?;
    assert_eq!(result["structuredContent"]["echo"], "hello");
    println!("rust-mcp-ok");
    Ok(())
}
