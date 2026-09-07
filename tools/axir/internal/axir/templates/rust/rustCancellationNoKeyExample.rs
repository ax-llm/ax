use axllm::{AxAIClient, AxCancellationToken, AxResult, AxTransport, OpenAICompatibleClient};
use serde_json::{json, Value};
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};

struct CountingTransport {
    calls: Arc<AtomicUsize>,
}

impl AxTransport for CountingTransport {
    fn send(&mut self, _request: Value) -> AxResult<Value> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        Ok(json!({"status": 200, "json": {}}))
    }
}

fn main() -> AxResult<()> {
    let calls = Arc::new(AtomicUsize::new(0));
    let mut client = OpenAICompatibleClient::new("test-key", "gpt-5.6-luna")
        .with_transport(CountingTransport { calls: calls.clone() });
    let token = AxCancellationToken::default();
    assert!(token.cancel("user stopped"));
    assert!(!token.cancel("later reason"));

    let error = client
        .chat_with_cancellation(
            json!({"chat_prompt": [{"role": "user", "content": "This must not be sent."}]}),
            json!({}),
            &token,
        )
        .expect_err("pre-cancelled request unexpectedly completed");
    assert_eq!(error.error_type.as_deref(), Some("AxAIServiceAbortedError"));
    assert!(!error.retryable);
    assert!(error.to_string().contains("user stopped"));
    assert_eq!(calls.load(Ordering::SeqCst), 0);
    println!("rust-cancellation-no-key user stopped");
    Ok(())
}
