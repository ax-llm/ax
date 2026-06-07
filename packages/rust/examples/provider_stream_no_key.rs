use axllm::{AxAIClient, AxResult, OpenAICompatibleClient, ScriptedTransport};
use serde_json::json;

fn main() -> AxResult<()> {
    let transport = ScriptedTransport::new(vec![json!({
        "status": 200,
        "body": "data: {\"id\":\"chatcmpl_stream\",\"model\":\"gpt-4.1-mini\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"hel\"}}]}\n\ndata: {\"id\":\"chatcmpl_stream\",\"model\":\"gpt-4.1-mini\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"lo\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n"
    })]);
    let mut client =
        OpenAICompatibleClient::new("test-key", "gpt-4.1-mini").with_transport(transport);
    let events = client.stream(json!({
        "chat_prompt": [{"role": "user", "content": "stream"}]
    }))?;
    let text = events
        .iter()
        .filter_map(|event| event["results"][0]["content"].as_str())
        .collect::<String>();
    assert_eq!(text, "hello");
    println!("rust-provider-stream-no-key {text}");
    Ok(())
}
