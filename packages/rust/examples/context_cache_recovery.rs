use axllm::{AxAIClient, AxError, AxResult, AxTransport, OpenAICompatibleClient};
use serde_json::{json, Value};
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Clone)]
struct Script(Arc<Mutex<State>>);
struct State {
    responses: VecDeque<Value>,
    requests: Vec<Value>,
}
impl Script {
    fn new(responses: Vec<Value>) -> Self {
        Self(Arc::new(Mutex::new(State {
            responses: responses.into(),
            requests: vec![],
        })))
    }
    fn methods(&self) -> Vec<String> {
        self.0
            .lock()
            .unwrap()
            .requests
            .iter()
            .map(|value| value["method"].as_str().unwrap().to_string())
            .collect()
    }
}
impl AxTransport for Script {
    fn send(&mut self, request: Value) -> AxResult<Value> {
        let mut state = self.0.lock().unwrap();
        state.requests.push(request);
        state
            .responses
            .pop_front()
            .ok_or_else(|| AxError::runtime("script exhausted"))
    }
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}
fn success(text: &str) -> Value {
    json!({"status":200,"json":{"candidates":[{"content":{"parts":[{"text":text}]},"finishReason":"STOP"}]}})
}
fn cache(name: &str, seconds: u64) -> Value {
    json!({"status":200,"json":{"name":name,"expireTime":now()+seconds*1000}})
}
fn failure(status: u16, message: &str) -> Value {
    json!({"status":status,"json":{"error":{"message":message}}})
}
fn service(script: Script) -> OpenAICompatibleClient {
    OpenAICompatibleClient::new("gemini-key", "gemini-3.5-flash")
        .with_profile("google-gemini")
        .with_options(
            json!({"contextCache":{"minTokens":0,"ttlSeconds":3600,"refreshWindowSeconds":300}}),
        )
        .with_transport(script)
}
fn main() -> AxResult<()> {
    let request = json!({"chat_prompt":[{"role":"system","content":"stable context"},{"role":"user","content":"answer briefly"}]});
    let recovery = Script::new(vec![
        cache("cachedContents/cache-1", 3600),
        failure(400, "cachedContent is invalid"),
        success("uncached recovery"),
    ]);
    service(recovery.clone()).chat(request.clone())?;
    assert_eq!(recovery.methods(), vec!["POST", "POST", "POST"]);
    let refresh = Script::new(vec![
        cache("cachedContents/old", 1),
        success("old"),
        failure(500, "refresh failed"),
        cache("cachedContents/new", 3600),
        success("recreated"),
    ]);
    let mut refresh_client = service(refresh.clone());
    refresh_client.chat(request.clone())?;
    refresh_client.chat(request.clone())?;
    assert_eq!(
        refresh.methods(),
        vec!["POST", "POST", "PATCH", "POST", "POST"]
    );
    let fallback = Script::new(vec![
        cache("cachedContents/old", 1),
        success("old"),
        failure(500, "refresh failed"),
        failure(500, "recreate failed"),
        success("uncached fallback"),
    ]);
    let mut fallback_client = service(fallback.clone());
    fallback_client.chat(request.clone())?;
    fallback_client.chat(request)?;
    assert_eq!(
        fallback.methods(),
        vec!["POST", "POST", "PATCH", "POST", "POST"]
    );
    println!("rust-context-cache-recovery-ok");
    Ok(())
}
