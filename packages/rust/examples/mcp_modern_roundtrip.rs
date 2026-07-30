use axllm::{AxMCPClient, AxMCPStreamableHTTPTransport, AxResult};
use serde_json::{json, Value};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::thread;
use std::time::Duration;

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
            if let Some(end) = request.windows(4).position(|value| value == b"\r\n\r\n") {
                let headers = String::from_utf8_lossy(&request[..end + 4]);
                let length = headers
                    .lines()
                    .find_map(|line| {
                        line.to_ascii_lowercase()
                            .strip_prefix("content-length:")
                            .map(|value| value.trim().parse::<usize>().unwrap_or(0))
                    })
                    .unwrap_or(0);
                expected = Some(end + 4 + length);
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
    let server = thread::spawn(move || {
        let mut calls = 0usize;
        let mut tool_lists = 0usize;
        let mut failures = Vec::new();
        loop {
            let (mut stream, _) = listener.accept().expect("accept loopback");
            let raw = read_request(&mut stream);
            let body = raw.split("\r\n\r\n").nth(1).unwrap_or("{}");
            let request: Value = serde_json::from_str(body).expect("JSON-RPC request");
            let method = request["method"].as_str().unwrap_or_default();
            let params = request.get("params").cloned().unwrap_or_else(|| json!({}));
            if method == "initialize" {
                failures.push("modern client sent initialize".to_string());
            }
            if method != "server/discover" && params.get("_meta").is_none() {
                failures.push(format!("{method} omitted request _meta"));
            }
            calls += 1;
            let meta = json!({"io.modelcontextprotocol/serverInfo":{"name":"modern-loopback","version":format!("1.0.{calls}")}});
            let mut result = json!({"resultType":"complete","_meta":meta});
            let mut done = false;
            match method {
                "server/discover" => {
                    result = json!({"resultType":"complete","supportedVersions":["2026-07-28"],"capabilities":{"tools":{},"extensions":{"io.modelcontextprotocol/tasks":{}}},"ttlMs":60000,"cacheScope":"public","_meta":meta})
                }
                "tools/list" => {
                    tool_lists += 1;
                    result = json!({"resultType":"complete","tools":[
                        {"name":"start_reindex","inputSchema":{"type":"object","properties":{"scope":{"type":"string","x-mcp-header":"Scope"}}}},
                        {"name":"mrtr_roots_round","inputSchema":{"type":"object","properties":{}}}
                    ],"ttlMs":60000,"cacheScope":"public","_meta":meta});
                }
                "tools/call" if params["name"] == "start_reindex" => {
                    if !raw.to_ascii_lowercase().contains("mcp-param-scope: all") {
                        failures.push("Mcp-Param-Scope was not propagated".into());
                    }
                    result = json!({"resultType":"task","taskId":"task-1","status":"working","createdAt":"2026-07-29T00:00:00Z","lastUpdatedAt":"2026-07-29T00:00:00Z","ttlMs":null,"_meta":meta});
                }
                "tasks/get" => {
                    result = json!({"taskId":"task-1","status":"completed","createdAt":"2026-07-29T00:00:00Z","lastUpdatedAt":"2026-07-29T00:00:01Z","ttlMs":null,"result":{"resultType":"complete","structuredContent":{"indexed":42},"_meta":meta},"_meta":meta})
                }
                "tools/call" if params.get("requestState").is_none() => {
                    result = json!({"resultType":"input_required","inputRequests":{"roots":{"method":"roots/list"}},"requestState":"opaque-roots-state","_meta":meta})
                }
                "tools/call" => {
                    if params["requestState"] != "opaque-roots-state"
                        || params["inputResponses"]["roots"]["roots"][0]["uri"]
                            != "file:///workspace"
                    {
                        failures.push("roots MRTR response was not echoed".into());
                    }
                    result = json!({"resultType":"complete","structuredContent":{"roots":1},"_meta":meta});
                    done = true;
                }
                _ => failures.push(format!("unexpected method {method}")),
            }
            let envelope = json!({"jsonrpc":"2.0","id":request["id"],"result":result}).to_string();
            let response = format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", envelope.len(), envelope);
            stream.write_all(response.as_bytes()).unwrap();
            stream.flush().unwrap();
            if done {
                break;
            }
        }
        (tool_lists, calls, failures)
    });

    let transport = AxMCPStreamableHTTPTransport::new(
        format!("http://127.0.0.1:{port}/mcp"),
        json!({"ssrfProtection":{"requireHttps":false,"allowLocalhost":true,"allowPrivateNetworks":true}}),
    )?;
    let mut client = AxMCPClient::new(
        Box::new(transport),
        json!({"era":"modern","roots":[{"uri":"file:///workspace","name":"workspace"}]}),
    );
    client.init()?;
    assert_eq!(client.get_era(), Some("modern"));
    client.refresh_with_force(false)?;
    let task = client.call_tool("start_reindex", json!({"scope":"all"}))?;
    assert_eq!(task["structuredContent"]["indexed"], 42);
    let roots = client.call_tool("mrtr_roots_round", json!({}))?;
    assert_eq!(roots["structuredContent"]["roots"], 1);
    let catalog = client.inspect_catalog(false)?;
    client.close()?;
    let (tool_lists, calls, failures) = server.join().unwrap();
    assert_eq!(tool_lists, 1, "cacheable tools/list was fetched again");
    assert!(
        calls >= 6 && failures.is_empty(),
        "modern roundtrip failures: {failures:?}"
    );
    assert_ne!(
        catalog.server_info["version"], "1.0.1",
        "serverInfo did not refresh"
    );
    println!("mcp-modern-roundtrip-ok");
    Ok(())
}
