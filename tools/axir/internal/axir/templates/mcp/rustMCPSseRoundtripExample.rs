use axllm::{AxMCPStreamableHTTPTransport, AxMCPTransport, AxResult};
use serde_json::json;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::thread;
use std::time::Duration;

// Drive AxMCPStreamableHTTPTransport::send() through the REAL reqwest transport
// against an in-process loopback server that answers the JSON-RPC POST with
// Content-Type: text/event-stream — the Streamable HTTP SSE path the
// ScriptedTransport conformance fixtures bypass. The SSE body interleaves a
// notification ahead of the id-matched response, so a transport that ignored
// the Content-Type (JSON-decoding the raw stream) or returned the first `data:`
// frame would fail. Panics on any mismatch so `axir verify` fails if the SSE
// branch regresses.

const SSE_BODY: &str = ": keepalive\nevent: message\ndata: {\"jsonrpc\":\"2.0\",\"method\":\"notifications/message\",\"params\":{\"level\":\"info\"}}\n\nevent: message\ndata: {\"jsonrpc\":\"2.0\",\"id\":\"ax-sse-1\",\"result\":{\"ok\":true,\"protocolVersion\":\"2025-11-25\"}}\n\n";

fn main() -> AxResult<()> {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind loopback");
    let port = listener.local_addr().unwrap().port();

    thread::spawn(move || {
        if let Some(Ok(mut stream)) = listener.incoming().next() {
            stream.set_read_timeout(Some(Duration::from_secs(5))).ok();
            // Drain the request so the client's write completes before we reply;
            // the request body content is irrelevant to this test.
            let mut tmp = [0u8; 4096];
            let _ = stream.read(&mut tmp);
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                SSE_BODY.len(),
                SSE_BODY
            );
            let _ = stream.write_all(response.as_bytes());
            let _ = stream.flush();
        }
    });

    let endpoint = format!("http://127.0.0.1:{port}/mcp");
    let mut transport = AxMCPStreamableHTTPTransport::new(
        endpoint,
        json!({"ssrfProtection": {"requireHttps": false, "allowLocalhost": true, "allowPrivateNetworks": true}}),
    )?;
    let response = transport.send(json!({
        "jsonrpc": "2.0",
        "id": "ax-sse-1",
        "method": "tools/call",
        "params": {"name": "noop"}
    }))?;

    assert_eq!(
        response["id"].as_str(),
        Some("ax-sse-1"),
        "SSE selector did not return the id-matched JSON-RPC response: {response}"
    );
    assert_eq!(
        response["result"]["ok"].as_bool(),
        Some(true),
        "SSE response not decoded from text/event-stream body: {response}"
    );

    println!("mcp-sse-roundtrip-ok");
    Ok(())
}
