// ax-example:start
// title: Rust Meta Muse Spark
// group: generation
// description: Selects any of Meta's three protocols through the existing chat API.
// provider: meta
// env: MODEL_API_KEY
// level: beginner
// order: 52
// ax-example:end
use axllm::{ai, AxAIClient, AxResult};
use serde_json::json;

fn main() -> AxResult<()> {
    let key = std::env::var("MODEL_API_KEY")
        .map_err(|_| axllm::AxError::runtime("Set MODEL_API_KEY to run this example."))?;
    for profile in ["meta", "meta-chat", "meta-messages"] {
        let mut client = ai(profile, json!({"api_key": key, "model": "muse-spark-1.3"}))?;
        let response = client.chat(json!({
            "chat_prompt": [{"role": "user", "content": "Name a solar-powered sailboat."}],
            "model_config": {"thinking_token_budget": "highest"}
        }))?;
        println!("{profile} {response}");
    }
    Ok(())
}
