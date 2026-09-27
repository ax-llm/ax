use axllm::{ai, ax, typesafe, AxAIClient, AxResult, OpenAICompatibleClient};
use serde_json::{json, Value};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

// Send requests through the REAL reqwest transport to in-process loopback
// servers that fail the way networks do, and check that the failures surface
// as TypeScript's apiCall reports fetch's: a refused or dropped connection is
// AxAIServiceNetworkError ("Network Error: ..."), which the request layer
// retries under the call's retry options; a timeout is
// AxAIServiceTimeoutError ("Request timed out after <ms>ms", the client's
// timeout in milliseconds), which the request layer never retries; and AxGen
// retries both as infrastructure errors. Panics on any mismatch so
// `axir verify` fails if it regresses.

const GATEWAY_BODY: &str = r#"{"error":{"message":"upstream timed out","type":"server_error"}}"#;
const DROP_EVENT: &str = "data: {\"id\":\"chatcmpl_drop\",\"object\":\"chat.completion.chunk\",\"created\":0,\"model\":\"gpt-5.4-mini\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"Hel\"},\"finish_reason\":null}]}\n\n";

fn client(port: u16, options: Value) -> OpenAICompatibleClient {
    let mut config = json!({"api_key": "test-key", "base_url": format!("http://127.0.0.1:{port}"), "model": "gpt-5.4-mini"});
    for (key, value) in options.as_object().into_iter().flatten() {
        config[key] = value.clone();
    }
    ai("openai", config).expect("client")
}

// The error must be of the Ax error type with a message that starts with prefix.
fn expect<T>(label: &str, error_type: &str, prefix: &str, result: AxResult<T>) {
    let Err(error) = result else {
        panic!("{label}: no error")
    };
    assert_eq!(
        error.error_type.as_deref(),
        Some(error_type),
        "{label}: {error:?}"
    );
    assert!(
        error.message.starts_with(prefix),
        "{label}: {:?} does not start with {prefix:?}",
        error.message
    );
}

fn drain(
    mut client: OpenAICompatibleClient,
    options: Value,
    delivered: &mut usize,
) -> AxResult<()> {
    let request = json!({"chat_prompt": [{"role": "user", "content": "hi"}]});
    for event in client.stream_iter_with_options(request, options)? {
        event?;
        *delivered += 1;
    }
    Ok(())
}

// A loopback port nothing listens on.
fn closed_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

// Read the request headers and its Content-Length body.
fn read_request(stream: &mut TcpStream) {
    let mut data = Vec::new();
    let mut buffer = [0u8; 4096];
    let header_end = loop {
        if let Some(at) = data.windows(4).position(|window| window == b"\r\n\r\n") {
            break at + 4;
        }
        match stream.read(&mut buffer) {
            Ok(0) | Err(_) => return,
            Ok(n) => data.extend_from_slice(&buffer[..n]),
        }
    };
    let head = String::from_utf8_lossy(&data[..header_end]).to_ascii_lowercase();
    let length = head
        .lines()
        .find_map(|line| line.strip_prefix("content-length:"))
        .and_then(|value| value.trim().parse::<usize>().ok())
        .unwrap_or(0);
    while data.len() < header_end + length {
        match stream.read(&mut buffer) {
            Ok(0) | Err(_) => return,
            Ok(n) => data.extend_from_slice(&buffer[..n]),
        }
    }
}

// Accept connections and count them: "close" closes each one without a
// response, "drop" sends one stream event and drops it, "headers" sends the
// response headers and drops it, "gateway" answers 504, "hold" never answers.
fn serve(mode: &'static str) -> (u16, Arc<AtomicUsize>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let connections = Arc::new(AtomicUsize::new(0));
    let counter = connections.clone();
    thread::spawn(move || {
        let mut held = Vec::new();
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { continue };
            counter.fetch_add(1, Ordering::SeqCst);
            if mode == "hold" {
                held.push(stream);
                continue;
            }
            read_request(&mut stream);
            if mode == "drop" {
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\n\r\n{:x}\r\n{DROP_EVENT}\r\n",
                    DROP_EVENT.len()
                );
                let _ = stream.write_all(response.as_bytes());
                let _ = stream.flush();
                thread::sleep(Duration::from_millis(50));
            }
            if mode == "headers" {
                let _ = stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\n\r\n");
                let _ = stream.flush();
                thread::sleep(Duration::from_millis(50));
            }
            if mode == "gateway" {
                let response = format!(
                    "HTTP/1.1 504 Gateway Timeout\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{GATEWAY_BODY}",
                    GATEWAY_BODY.len()
                );
                let _ = stream.write_all(response.as_bytes());
                let _ = stream.flush();
            }
        }
    });
    (port, connections)
}

fn main() {
    let request = json!({"chat_prompt": [{"role": "user", "content": "hi"}]});
    let fast_retry = json!({"retry": {"maxRetries": 2, "initialDelayMs": 10, "maxDelayMs": 20}});
    let mut ignored = 0;

    // A refused connection.
    let refused = closed_port();
    expect(
        "refused chat",
        "AxAIServiceNetworkError",
        "Network Error: ",
        client(refused, json!({})).chat_with_options(request.clone(), json!({"stream": false, "retry": fast_retry["retry"]})),
    );
    expect(
        "refused stream",
        "AxAIServiceNetworkError",
        "Network Error: ",
        drain(client(refused, json!({})), fast_retry.clone(), &mut ignored),
    );

    // A server that closes each connection without a response. The stream's
    // request layer retries it under the call's retry options: the first
    // request and two retries.
    let (closing, closed) = serve("close");
    let before = closed.load(Ordering::SeqCst);
    expect(
        "closed chat",
        "AxAIServiceNetworkError",
        "Network Error: ",
        client(closing, json!({})).chat_with_options(request.clone(), json!({"stream": false, "retry": fast_retry["retry"]})),
    );
    assert_eq!(closed.load(Ordering::SeqCst) - before, 3, "closed chat requests");
    let before = closed.load(Ordering::SeqCst);
    expect(
        "closed stream",
        "AxAIServiceNetworkError",
        "Network Error: ",
        drain(client(closing, json!({})), fast_retry.clone(), &mut ignored),
    );
    assert_eq!(
        closed.load(Ordering::SeqCst) - before,
        3,
        "closed stream requests"
    );

    // A stream whose response began and dropped before its first event is not
    // retried: TS reads the first event after apiCall returns.
    let (started, began) = serve("headers");
    assert!(drain(client(started, json!({})), fast_retry.clone(), &mut ignored).is_err(), "started stream: no error");
    assert_eq!(began.load(Ordering::SeqCst), 1, "started stream requests");

    // A 504 response is retried by its status, as TS apiCall retries it: it is
    // not a timeout the request ran out of.
    let (gateway, answered) = serve("gateway");
    assert!(drain(client(gateway, json!({})), fast_retry.clone(), &mut ignored).is_err(), "gateway stream: no error");
    assert_eq!(answered.load(Ordering::SeqCst), 3, "gateway stream requests");

    // The client's own timeout (seconds) ends a chat or a stream whose
    // response has not started, in TS's words, and the request layer does not
    // retry it.
    let (silent, held) = serve("hold");
    let before = held.load(Ordering::SeqCst);
    expect(
        "timed-out chat",
        "AxAIServiceTimeoutError",
        "Request timed out after 300ms",
        client(silent, json!({"timeout": 0.3}))
            .chat_with_options(request.clone(), json!({"stream": false})),
    );
    expect(
        "timed-out stream",
        "AxAIServiceTimeoutError",
        "Request timed out after 300ms",
        drain(
            client(silent, json!({"timeout": 0.3})),
            fast_retry.clone(),
            &mut ignored,
        ),
    );
    assert_eq!(
        held.load(Ordering::SeqCst) - before,
        2,
        "a timed-out request was retried"
    );

    // A server that sends one event and drops the connection: the stream ends
    // in an infrastructure error after the event, and is not retried.
    let (dropping, dropped) = serve("drop");
    let mut delivered = 0;
    expect(
        "dropped stream",
        "AxAIServiceStreamTerminatedError",
        "",
        drain(
            client(dropping, json!({})),
            fast_retry.clone(),
            &mut delivered,
        ),
    );
    assert_eq!(delivered, 1, "dropped stream events");
    assert_eq!(dropped.load(Ordering::SeqCst), 1, "dropped stream requests");

    // The Typesafe client types the same failures, and does not retry a
    // timeout.
    let result = typesafe(json!({"api_key": "test-key", "base_url": format!("http://127.0.0.1:{}", closed_port()), "retry": fast_retry["retry"]}))
        .and_then(|mut client| client.list_models());
    expect("Typesafe refused", "AxAIServiceNetworkError", "Network Error: ", result);
    let before = held.load(Ordering::SeqCst);
    let result = typesafe(json!({"api_key": "test-key", "base_url": format!("http://127.0.0.1:{silent}"), "timeout": 0.3, "retry": fast_retry["retry"]}))
        .and_then(|mut client| client.list_models());
    expect("Typesafe timeout", "AxAIServiceTimeoutError", "Request timed out after 300ms", result);
    assert_eq!(held.load(Ordering::SeqCst) - before, 1, "a timed-out Typesafe request was retried");

    // AxGen retries a network error and a timeout as infrastructure errors.
    // The client's own retries are off, so each request is one AxGen attempt:
    // maxRetries 1 is the first attempt and one retry.
    let no_request_retry = json!({"retry": {"maxRetries": 0}});
    for stream in [false, true] {
        let before = closed.load(Ordering::SeqCst);
        let mut program = ax("question:string -> answer:string").expect("signature");
        let result = program.forward_with_options(
            &mut client(closing, no_request_retry.clone()),
            json!({"question": "hi"}),
            json!({"maxRetries": 1, "stream": stream}),
        );
        expect(
            &format!("AxGen network (stream {stream})"),
            "AxAIServiceNetworkError",
            "Network Error: ",
            result,
        );
        assert_eq!(
            closed.load(Ordering::SeqCst) - before,
            2,
            "AxGen network (stream {stream}) requests"
        );
        let before = held.load(Ordering::SeqCst);
        let mut program = ax("question:string -> answer:string").expect("signature");
        let result = program.forward_with_options(
            &mut client(silent, no_request_retry.clone()),
            json!({"question": "hi"}),
            json!({"maxRetries": 1, "stream": stream, "timeoutMs": 200}),
        );
        expect(
            &format!("AxGen timeout (stream {stream})"),
            "AxAIServiceTimeoutError",
            "Request timed out after 200ms",
            result,
        );
        assert_eq!(
            held.load(Ordering::SeqCst) - before,
            2,
            "AxGen timeout (stream {stream}) requests"
        );
    }
    println!("transport-errors-http-roundtrip-ok");
    std::process::exit(0);
}
