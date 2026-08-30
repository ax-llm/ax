// ax-example:start
// title: Rust Gemini Flex Inference
// group: generation
// description: Sends latency-tolerant work through Gemini Flex and reports the applied tier.
// provider: google-gemini
// env: GOOGLE_API_KEY, GOOGLE_APIKEY
// level: intermediate
// order: 50
// ax-example:end
use axllm::{ai, AxAIClient, AxError, AxResult};
use serde_json::json;
use std::env;

fn api_key() -> AxResult<String> {
    env::var("GOOGLE_API_KEY")
        .or_else(|_| env::var("GOOGLE_APIKEY"))
        .map_err(|_| AxError::runtime("Set GOOGLE_API_KEY or GOOGLE_APIKEY to run this example."))
}

fn main() -> AxResult<()> {
    let model = env::var("AX_GEMINI_MODEL").unwrap_or_else(|_| "gemini-3.7-flash".to_string());
    let mut client = ai(
        "google-gemini",
        json!({
            "api_key": api_key()?,
            "model": model,
        }),
    )?;
    let out = client.chat_with_options(
        json!({
            "chat_prompt": [{
                "role": "user",
                "content": "Explain in one sentence why batch evaluations save time."
            }]
        }),
        json!({"service_tier": "flex"}),
    )?;
    println!("{}", serde_json::to_string_pretty(&out)?);
    Ok(())
}
