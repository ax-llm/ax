use axllm::{
    set_usage_observer, AxAIClient, AxResult, AxUsageEvent, OpenAICompatibleClient,
    ScriptedTransport,
};
use serde_json::json;
use std::sync::{Arc, Mutex};

fn main() -> AxResult<()> {
    let transport = ScriptedTransport::new(vec![json!({
        "status": 200,
        "json": {
            "id": "chatcmpl_example",
            "model": "gpt-5.4-mini",
            "choices": [{
                "index": 0,
                "finish_reason": "stop",
                "message": {"role": "assistant", "content": "Ax is a toolkit."}
            }],
            "usage": {"prompt_tokens": 8, "completion_tokens": 4, "total_tokens": 12}
        }
    })]);
    let events = Arc::new(Mutex::new(Vec::<AxUsageEvent>::new()));
    let captured = Arc::clone(&events);
    set_usage_observer(Some(Arc::new(move |event| {
        captured.lock().unwrap().push(event);
    })));
    let mut client = OpenAICompatibleClient::new("test-key", "gpt-5.4-mini")
        .with_transport(transport)
        .with_options(json!({
            "usageContext": {"tenantId": "tenant-1", "feature": "no-key-example"}
        }));
    let result = client.chat_with_options(
        json!({
            "chat_prompt": [
                {"role": "system", "content": "Answer briefly."},
                {"role": "user", "content": "What is Ax?"}
            ],
            "model_config": {"temperature": 0}
        }),
        json!({
            "usageContext": {"userId": "user-1", "requestId": "request-1"}
        }),
    )?;
    set_usage_observer(None);
    let captured = events.lock().unwrap();
    assert_eq!(captured.len(), 1);
    assert_eq!(captured[0]["context"]["tenantId"], "tenant-1");
    println!(
        "rust-provider-mapping-no-key {}",
        result["results"][0]["content"].as_str().unwrap_or("")
    );
    Ok(())
}
