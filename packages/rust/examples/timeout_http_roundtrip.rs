use axllm::{AxAIClient, AxResult, OpenAICompatibleClient};
use serde_json::{json, Value};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

// Time requests out through the REAL reqwest transport against in-process
// loopback servers. A call's timeout (TypeScript's per-call timeout, in
// milliseconds) ends a chat or a stream whose response has not started, and
// the request layer does not retry it. A stream whose response has started
// runs past it, because the timer stops at the response headers, as in
// TypeScript's apiCall. A stream also honors a per-call timeout in seconds,
// which Rust reads until the next major version. Panics on any mismatch so
// `axir verify` fails if it regresses.

fn client(port: u16) -> OpenAICompatibleClient {
    let mut client = OpenAICompatibleClient::new("test-key", "gpt-5.4-mini");
    client.base_url_override = Some(format!("http://127.0.0.1:{port}"));
    client
}

fn expect_timeout(label: &str, message: &str, run: impl FnOnce() -> AxResult<Value>) {
    let started = Instant::now();
    let error = run().expect_err(&format!("{label}: the request did not time out"));
    assert_eq!(
        error.error_type.as_deref(),
        Some("AxAIServiceTimeoutError"),
        "{label}: {error:?}"
    );
    assert!(error.message.contains(message), "{label}: {error:?}");
    assert!(
        started.elapsed() < Duration::from_secs(5),
        "{label}: timed out after {:?}",
        started.elapsed()
    );
}

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
    let content_length = header_text
        .lines()
        .find(|line| line.to_ascii_lowercase().starts_with("content-length:"))
        .and_then(|line| line.splitn(2, ':').nth(1))
        .and_then(|value| value.trim().parse::<usize>().ok())
        .unwrap_or(0);
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
    // A server that accepts connections and never answers.
    let silent = TcpListener::bind("127.0.0.1:0").expect("bind loopback");
    let silent_port = silent.local_addr().unwrap().port();
    let accepted = Arc::new(AtomicUsize::new(0));
    let counter = accepted.clone();
    thread::spawn(move || {
        let mut held = Vec::new();
        for stream in silent.incoming().flatten() {
            counter.fetch_add(1, Ordering::SeqCst);
            held.push(stream);
        }
    });
    let request = json!({"chat_prompt": [{"role": "user", "content": "hi"}]});

    let mut chat_client = client(silent_port);
    expect_timeout("chat", "Request timed out after 200ms", || {
        chat_client.chat_with_options(request.clone(), json!({"timeout": 200}))
    });
    let mut stream_client = client(silent_port);
    expect_timeout("stream", "Request timed out after 200ms", || {
        stream_client
            .stream_with_options(request.clone(), json!({"timeout": 200}))
            .map(Value::Array)
    });
    assert_eq!(
        accepted.load(Ordering::SeqCst),
        2,
        "a timed-out request was retried"
    );

    // A per-call timeout in seconds now bounds a stream too, instead of a
    // fixed 60 s.
    let mut seconds_client = client(silent_port);
    let started = Instant::now();
    assert!(
        seconds_client
            .stream_with_options(
                request.clone(),
                json!({"timeout": 0.2, "retry": {"maxRetries": 0}})
            )
            .is_err(),
        "a stream with a per-call timeout in seconds did not time out"
    );
    assert!(
        started.elapsed() < Duration::from_secs(5),
        "the stream ignored its per-call timeout: {:?}",
        started.elapsed()
    );

    // A stream whose headers arrive at once and whose second event comes after
    // more than the timeout.
    let slow = TcpListener::bind("127.0.0.1:0").expect("bind loopback");
    let slow_port = slow.local_addr().unwrap().port();
    let server = thread::spawn(move || {
        let Ok((mut stream, _)) = slow.accept() else {
            return;
        };
        drain_request(&mut stream);
        let event = |content: &str, finish: &str| {
            format!(
                r#"{{"id":"chatcmpl_slow","model":"gpt-5.4-mini","choices":[{{"index":0,"delta":{{"content":"{content}"}},"finish_reason":{finish}}}]}}"#
            )
        };
        let _ = stream.write_all(
            b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n",
        );
        let _ = stream.write_all(format!("data: {}\n\n", event("Hel", "null")).as_bytes());
        let _ = stream.flush();
        thread::sleep(Duration::from_millis(1500));
        let _ = stream
            .write_all(format!("data: {}\n\ndata: [DONE]\n\n", event("lo", "\"stop\"")).as_bytes());
        let _ = stream.flush();
    });
    let mut slow_client = client(slow_port);
    let events = slow_client
        .stream_with_options(request, json!({"timeout": 1000}))
        .expect("a started stream was cut off");
    server.join().expect("loopback server");
    let text: String = events
        .iter()
        .filter_map(|event| event["results"][0]["content"].as_str())
        .collect();
    assert_eq!(text, "Hello", "a started stream was cut off: {events:?}");

    println!("timeout-http-roundtrip-ok");
    Ok(())
}
