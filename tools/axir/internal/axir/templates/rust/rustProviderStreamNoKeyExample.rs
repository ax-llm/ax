use axllm::{
    set_usage_observer, AxAIClient, AxResult, AxTransport, AxTransportStream, AxUsageEvent,
    OpenAICompatibleClient, ScriptedTransport,
};
use serde_json::json;
use std::io::{Cursor, Read};
use std::sync::{
    atomic::{AtomicBool, AtomicUsize, Ordering},
    Arc, Mutex,
};

struct TrackingReader {
    inner: Cursor<Vec<u8>>,
    closed: Arc<AtomicBool>,
}

impl Read for TrackingReader {
    fn read(&mut self, target: &mut [u8]) -> std::io::Result<usize> {
        let length = target.len().min(1);
        self.inner.read(&mut target[..length])
    }
}

impl Drop for TrackingReader {
    fn drop(&mut self) {
        self.closed.store(true, Ordering::SeqCst);
    }
}

struct IncrementalTransport {
    closed: Arc<AtomicBool>,
}

struct FailingReader {
    inner: Cursor<Vec<u8>>,
}

impl Read for FailingReader {
    fn read(&mut self, target: &mut [u8]) -> std::io::Result<usize> {
        let count = self.inner.read(target)?;
        if count > 0 {
            Ok(count)
        } else {
            Err(std::io::Error::new(
                std::io::ErrorKind::UnexpectedEof,
                "upstream closed",
            ))
        }
    }
}

struct FailingTransport {
    attempts: Arc<AtomicUsize>,
}

impl AxTransport for FailingTransport {
    fn send(&mut self, _request: serde_json::Value) -> AxResult<serde_json::Value> {
        Ok(json!({"status": 200, "body": ""}))
    }

    fn stream(&mut self, _request: serde_json::Value) -> AxResult<AxTransportStream> {
        self.attempts.fetch_add(1, Ordering::SeqCst);
        let body = b"data: {\"id\":\"chatcmpl_failure\",\"model\":\"gpt-5.4-mini\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"delivered\"}}]}\n\n".to_vec();
        Ok(AxTransportStream::Reader {
            status: 200,
            body: Box::new(FailingReader {
                inner: Cursor::new(body),
            }),
        })
    }
}

impl AxTransport for IncrementalTransport {
    fn send(&mut self, _request: serde_json::Value) -> AxResult<serde_json::Value> {
        Ok(json!({"status": 200, "body": ""}))
    }

    fn stream(&mut self, _request: serde_json::Value) -> AxResult<AxTransportStream> {
        let body = "data: {\"id\":\"chatcmpl_cancel\",\"model\":\"gpt-5.4-mini\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"first 🌍\"}}]}\r\n\r\ndata: {\"id\":\"chatcmpl_cancel\",\"model\":\"gpt-5.4-mini\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"second\"}}]}\r\n\r\n".as_bytes().to_vec();
        Ok(AxTransportStream::Reader {
            status: 200,
            body: Box::new(TrackingReader {
                inner: Cursor::new(body),
                closed: self.closed.clone(),
            }),
        })
    }
}

fn main() -> AxResult<()> {
    let transport = ScriptedTransport::new(vec![json!({
        "status": 200,
        "body": "data: {\"id\":\"chatcmpl_stream\",\"model\":\"gpt-5.4-mini\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"hel\"}}]}\n\ndata: {\"id\":\"chatcmpl_stream\",\"model\":\"gpt-5.4-mini\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"lo\"},\"finish_reason\":\"stop\"}]}\n\ndata: {\"id\":\"chatcmpl_stream\",\"model\":\"gpt-5.4-mini\",\"choices\":[],\"usage\":{\"prompt_tokens\":1,\"completion_tokens\":2,\"total_tokens\":3}}\n\ndata: [DONE]\n\n"
    })]);
    let usage_events = Arc::new(Mutex::new(Vec::<AxUsageEvent>::new()));
    let captured = usage_events.clone();
    set_usage_observer(Some(Arc::new(move |event| {
        captured.lock().unwrap().push(event)
    })));
    let mut client =
        OpenAICompatibleClient::new("test-key", "gpt-5.4-mini").with_transport(transport);
    let events = client.stream(json!({
        "chat_prompt": [{"role": "user", "content": "stream"}]
    }))?;
    set_usage_observer(None);
    let text = events
        .iter()
        .filter_map(|event| event["results"][0]["content"].as_str())
        .collect::<String>();
    assert_eq!(text, "hello");
    assert_eq!(
        usage_events.lock().unwrap().len(),
        1,
        "usage was not delivered after completion"
    );
    let closed = Arc::new(AtomicBool::new(false));
    let mut cancel_client = OpenAICompatibleClient::new("test-key", "gpt-5.4-mini").with_transport(
        IncrementalTransport {
            closed: closed.clone(),
        },
    );
    let mut stream = cancel_client.stream_iter(json!({
        "chat_prompt": [{"role": "user", "content": "cancel"}]
    }))?;
    assert!(stream.next().transpose()?.is_some());
    drop(stream);
    assert!(
        closed.load(Ordering::SeqCst),
        "consumer cancellation did not close the upstream stream"
    );
    let attempts = Arc::new(AtomicUsize::new(0));
    let mut failure_client = OpenAICompatibleClient::new("test-key", "gpt-5.4-mini")
        .with_transport(FailingTransport {
            attempts: attempts.clone(),
        });
    let mut failure_stream = failure_client.stream_iter(json!({
        "chat_prompt": [{"role": "user", "content": "fail"}]
    }))?;
    assert!(failure_stream.next().transpose()?.is_some());
    assert!(
        failure_stream.next().transpose().is_err(),
        "mid-stream failure was not surfaced"
    );
    assert_eq!(
        attempts.load(Ordering::SeqCst),
        1,
        "mid-stream failure replayed the request"
    );
    println!("rust-provider-stream-no-key {text}");
    Ok(())
}
