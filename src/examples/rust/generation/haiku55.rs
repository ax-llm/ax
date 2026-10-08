// ax-example:start
// title: Rust Haiku 5.5 Adaptive Thinking
// group: generation
// description: Uses Haiku 5.5 adaptive thinking at low effort for a short response.
// provider: anthropic
// env: ANTHROPIC_API_KEY, ANTHROPIC_APIKEY
// level: intermediate
// order: 47
// ax-example:end
use axllm::{ai, AxAIClient, AxResult};
use serde_json::json;
use std::env;

fn main() -> AxResult<()> {
    let api_key = env::var("ANTHROPIC_API_KEY").or_else(|_| env::var("ANTHROPIC_APIKEY")).map_err(|_| axllm::AxError::runtime("Set ANTHROPIC_API_KEY or ANTHROPIC_APIKEY to run this example."))?;
    let mut client = ai("anthropic", json!({"api_key": api_key, "model": "claude-haiku-5-5"}))?;
    let response = client.chat(json!({
        "chat_prompt": [{"role": "user", "content": "Reply with exactly: Haiku 5.5 works"}],
        "model_config": {"thinkingTokenBudget": "low", "showThoughts": false, "maxTokens": 2048}
    }))?;
    println!("{}", response["results"][0]["content"].as_str().unwrap_or_default());
    Ok(())
}
