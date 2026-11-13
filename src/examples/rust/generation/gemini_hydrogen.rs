// ax-example:start
// title: Rust Gemini 4 Hydrogen
// group: generation
// description: Uses Hydrogen with a thinking level and an explicit output limit.
// provider: google-gemini
// env: GOOGLE_API_KEY, GOOGLE_APIKEY
// level: beginner
// order: 51
// ax-example:end
use axllm::{ai, AxAIClient, AxError, AxResult};
use serde_json::json;
use std::env;

fn main() -> AxResult<()> {
    let api_key = env::var("GOOGLE_API_KEY")
        .or_else(|_| env::var("GOOGLE_APIKEY"))
        .map_err(|_| {
            AxError::runtime("Set GOOGLE_API_KEY or GOOGLE_APIKEY to run this example.")
        })?;
    let mut client = ai(
        "google-gemini",
        json!({"api_key": api_key, "model": "gemini-4-hydrogen"}),
    )?;
    let result = client.chat_with_options(json!({
        "chat_prompt": [{"role": "user", "content": "Why does a hash table usually provide fast lookups?"}],
        "model_config": {"max_tokens": 4096},
    // Use "highest" for Hydrogen's xhigh level; "low" keeps this example quick.
    }), json!({"thinking_token_budget": "low"}))?;
    println!(
        "{}",
        result["results"][0]["content"].as_str().unwrap_or_default()
    );
    Ok(())
}
