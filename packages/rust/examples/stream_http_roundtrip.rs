use axllm::{AxAIClient, AxResult, OpenAICompatibleClient};
use serde_json::json;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::thread;
use std::time::{Duration, Instant};

// Drive a streaming stream() through the REAL reqwest transport against an
// in-process loopback server that returns a spec-legal text/event-stream body
// with a MULTI-LINE data: event and CRLF line endings. The conformance
// ScriptedTransport only ever feeds single-line data: JSON, so this is the only
// end-to-end coverage for the SSE line-folding that src/ax/util/sse.ts performs.
// Panics on any mismatch so `axir verify` fails if the folding regresses.

fn drain_request(stream: &mut TcpStream) {
    stream.set_read_timeout(Some(Duration::from_secs(5))).ok();
    let mut buf: Vec<u8> = Vec::new();
    let mut tmp = [0u8; 4096];
    let header_end = loop {
        if let Some(pos) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            break pos + 4;
        }
        let n = stream.read(&mut tmp).unwrap_or(0);
        if n == 0 {
            break buf.len();
        }
        buf.extend_from_slice(&tmp[..n]);
    };
    let header_text = String::from_utf8_lossy(&buf[..header_end]).to_string();
    let mut content_length = 0usize;
    for line in header_text.lines() {
        if line.to_ascii_lowercase().starts_with("content-length:") {
            content_length = line
                .splitn(2, ':')
                .nth(1)
                .unwrap_or("")
                .trim()
                .parse()
                .unwrap_or(0);
        }
    }
    let mut body_len = buf.len() - header_end;
    while body_len < content_length {
        let n = stream.read(&mut tmp).unwrap_or(0);
        if n == 0 {
            break;
        }
        body_len += n;
    }
}

fn main() -> AxResult<()> {
    // One logical chat-completion delta whose JSON is split across two data:
    // lines (folded with "\n" into ...,"delta":\n{"content":"Hello "}}), then a
    // normal single-line delta, then [DONE]. Every line uses CRLF.
    let event1a =
        r#"{"id":"chatcmpl_stream","model":"gpt-5.4-mini","choices":[{"index":0,"delta":"#;
    let event1b = r#"{"content":"Hello 🌍 "}}]}"#;
    let event2 = r#"{"id":"chatcmpl_stream","model":"gpt-5.4-mini","choices":[{"index":0,"delta":{"content":"world"},"finish_reason":"stop"}]}"#;
    let sse_first =
        format!("\u{feff}database: ignored\r\ndata: {event1a}\r\ndata: {event1b}\r\n\r\n");
    let sse_rest = format!("data: {event2}");

    let listener = TcpListener::bind("127.0.0.1:0").expect("bind loopback");
    let port = listener.local_addr().unwrap().port();

    let first_body = sse_first.clone();
    let rest_body = sse_rest.clone();
    thread::spawn(move || {
        if let Ok((mut stream, _)) = listener.accept() {
            drain_request(&mut stream);
            let header = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                first_body.len() + rest_body.len()
            );
            let _ = stream.write_all(header.as_bytes());
            for byte in first_body.as_bytes() {
                let _ = stream.write_all(&[*byte]);
                let _ = stream.flush();
            }
            thread::sleep(Duration::from_millis(300));
            let _ = stream.write_all(rest_body.as_bytes());
            let _ = stream.flush();
        }
    });

    // base_url_override is the documented proxy/gateway knob; point it at the
    // loopback so the real reqwest transport streams from our server.
    let mut client = OpenAICompatibleClient::new("test-key", "gpt-5.4-mini");
    client.base_url_override = Some(format!("http://127.0.0.1:{port}"));
    let started = Instant::now();
    let mut stream = client.stream_iter(json!({
        "chat_prompt": [{"role": "user", "content": "stream"}]
    }))?;
    let first = stream.next().expect("first event before completion")?;
    let ttft = started.elapsed();
    let mut events = vec![first];
    for event in &mut stream {
        events.push(event?);
    }
    let completion = started.elapsed();
    assert!(
        completion.saturating_sub(ttft) >= Duration::from_millis(200),
        "first event was not incremental: ttft={ttft:?} completion={completion:?}"
    );

    let deltas: Vec<String> = events
        .iter()
        .filter_map(|event| event["results"][0]["content"].as_str().map(str::to_string))
        .filter(|content| !content.is_empty())
        .collect();
    assert!(
        deltas.first().map(String::as_str) == Some("Hello 🌍 "),
        "multi-line data: event was not folded into one JSON value: {deltas:?}"
    );
    assert_eq!(
        deltas.concat(),
        "Hello 🌍 world",
        "bad stream fold: {deltas:?}"
    );

    println!("stream-http-roundtrip-ok");
    Ok(())
}
