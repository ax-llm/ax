// ax-example:start
// title: Rust Portable Cancellation
// group: generation
// description: Cancels a provider request before transport and preserves the first cancellation reason.
// provider: openai-compatible
// env: none
// level: intermediate
// order: 46
// ax-example:end
use axllm::{AxAIClient, AxCancellationToken, AxResult, AxTransport, OpenAICompatibleClient};
use serde_json::{json, Value};
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};

struct CountingTransport(Arc<AtomicUsize>);

impl AxTransport for CountingTransport {
    fn send(&mut self, _request: Value) -> AxResult<Value> {
        self.0.fetch_add(1, Ordering::SeqCst);
        Ok(json!({"status": 200, "json": {}}))
    }
}

fn main() -> AxResult<()> {
    let calls = Arc::new(AtomicUsize::new(0));
    let mut client = OpenAICompatibleClient::new("test-key", "gpt-5.6-luna")
        .with_transport(CountingTransport(calls.clone()));
    let token = AxCancellationToken::default();
    assert!(token.cancel("user stopped") && !token.cancel("later reason"));

    let error = client
        .chat_with_cancellation(
            json!({"chat_prompt": [{"role": "user", "content": "This must not be sent."}]}),
            json!({}), &token,
        )
        .expect_err("pre-cancelled request unexpectedly completed");
    assert_eq!(error.error_type.as_deref(), Some("AxAIServiceAbortedError"));
    assert!(!error.retryable && error.to_string().contains("user stopped"));
    assert_eq!(calls.load(Ordering::SeqCst), 0);
    println!("cancelled before transport: user stopped");
    Ok(())
}
