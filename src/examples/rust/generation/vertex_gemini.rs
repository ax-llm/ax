// ax-example:start
// title: Rust Vertex Gemini Routing
// group: generation
// description: Calls Gemini through Vertex with project and multi-region routing.
// provider: google-gemini
// env: GOOGLE_VERTEX_ACCESS_TOKEN, GOOGLE_PROJECT_ID, GOOGLE_REGION
// level: intermediate
// order: 35
// ax-example:end
use axllm::{ai, AxAIClient, AxError, AxResult};
use serde_json::json;
use std::env;

fn required(name: &str) -> AxResult<String> {
    env::var(name).map_err(|_| AxError::runtime(format!("Set {name} to run this example.")))
}

fn main() -> AxResult<()> {
    let model = env::var("AX_VERTEX_MODEL").unwrap_or_else(|_| "gemini-3.5-flash".to_string());
    let mut client = ai("google-gemini", json!({
        "api_key": required("GOOGLE_VERTEX_ACCESS_TOKEN")?,
        "project_id": required("GOOGLE_PROJECT_ID")?,
        "region": required("GOOGLE_REGION")?,
        "model": model,
    }))?;
    let out = client.chat(json!({
        "chat_prompt": [{"role": "user", "content": "Reply with the word ready."}]
    }))?;
    println!("{}", serde_json::to_string_pretty(&out)?);
    Ok(())
}
