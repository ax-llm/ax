use axllm::{AxAIClient, AxResult, ScriptedTransport, OpenAICompatibleClient};
use serde_json::json;

fn main() -> AxResult<()> {
    let transport = ScriptedTransport::new(vec![json!({
        "status": 200,
        "json": {
            "id": "chatcmpl_example",
            "model": "gpt-4.1-mini",
            "choices": [{
                "index": 0,
                "finish_reason": "stop",
                "message": {"role": "assistant", "content": "Ax is a toolkit."}
            }],
            "usage": {"prompt_tokens": 8, "completion_tokens": 4, "total_tokens": 12}
        }
    })]);
    let mut client = OpenAICompatibleClient::new("test-key", "gpt-4.1-mini").with_transport(transport);
    let result = client.chat(json!({
        "chat_prompt": [
            {"role": "system", "content": "Answer briefly."},
            {"role": "user", "content": "What is Ax?"}
        ],
        "model_config": {"temperature": 0}
    }))?;
    println!("rust-provider-mapping-no-key {}", result["results"][0]["content"].as_str().unwrap_or(""));
    Ok(())
}
