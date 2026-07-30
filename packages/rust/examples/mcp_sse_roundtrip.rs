use axllm::{AxMCPClient, AxMCPStreamableHTTPTransport, AxResult};
use serde_json::json;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
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

fn read_request(stream: &mut TcpStream) -> String {
    stream.set_read_timeout(Some(Duration::from_secs(5))).ok();
    let mut request = Vec::new();
    let mut tmp = [0u8; 4096];
    let mut expected = None;
    loop {
        let read = stream.read(&mut tmp).unwrap_or(0);
        if read == 0 {
            break;
        }
        request.extend_from_slice(&tmp[..read]);
        if expected.is_none() {
            if let Some(headers_end) = request.windows(4).position(|value| value == b"\r\n\r\n") {
                let headers = String::from_utf8_lossy(&request[..headers_end + 4]);
                let content_length = headers
                    .lines()
                    .find_map(|line| {
                        line.to_ascii_lowercase()
                            .strip_prefix("content-length:")
                            .map(|value| value.trim().parse::<usize>().unwrap_or(0))
                    })
                    .unwrap_or(0);
                expected = Some(headers_end + 4 + content_length);
            }
        }
        if expected.is_some_and(|length| request.len() >= length) {
            break;
        }
    }
    String::from_utf8_lossy(&request).into_owned()
}

fn main() -> AxResult<()> {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind loopback");
    let port = listener.local_addr().unwrap().port();

    thread::spawn(move || {
        for incoming in listener.incoming() {
            let mut stream = incoming.expect("accept loopback");
            let request = read_request(&mut stream);
            let (content_type, body, done) = if request.contains("server/discover") {
                ("application/json", r#"{"jsonrpc":"2.0","id":1,"error":{"code":-32601,"message":"Method not found"}}"#.to_string(), false)
            } else if request.contains("\"method\":\"initialize\"") {
                ("application/json", r#"{"jsonrpc":"2.0","id":2,"result":{"protocolVersion":"2025-11-25","capabilities":{},"serverInfo":{"name":"legacy-loopback","version":"1.0.0"}}}"#.to_string(), false)
            } else if request.contains("notifications/initialized") || request.starts_with("GET ") {
                ("application/json", String::new(), false)
            } else {
                (
                    "text/event-stream",
                    SSE_BODY.replace("\"ax-sse-1\"", "3"),
                    true,
                )
            };
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            let _ = stream.write_all(response.as_bytes());
            let _ = stream.flush();
            if done {
                break;
            }
        }
    });

    let endpoint = format!("http://127.0.0.1:{port}/mcp");
    let transport = AxMCPStreamableHTTPTransport::new(
        endpoint,
        json!({"ssrfProtection": {"requireHttps": false, "allowLocalhost": true, "allowPrivateNetworks": true}}),
    )?;
    let mut client = AxMCPClient::new(Box::new(transport), json!({}));
    client.init()?;
    assert_eq!(
        client.get_era(),
        Some("legacy"),
        "auto discovery did not fall back"
    );
    let response = client.call_tool("noop", json!({}))?;
    assert_eq!(
        response["ok"].as_bool(),
        Some(true),
        "SSE response not decoded from text/event-stream body: {response}"
    );
    client.close()?;

    println!("mcp-sse-roundtrip-ok");
    Ok(())
}
