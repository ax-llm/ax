use axllm::{ai, AxAIClient, AxError, AxResult};
use serde_json::json;
use std::env;

fn required(name: &str) -> AxResult<String> {
    env::var(name).map_err(|_| {
        AxError::runtime(format!(
            "Set {name} to run this Vertex provider API example."
        ))
    })
}

fn main() -> AxResult<()> {
    let model = env::var("AX_VERTEX_MODEL").unwrap_or_else(|_| "gemini-3.5-flash".to_string());
    let mut client = ai(
        "google-gemini",
        json!({
            "api_key": required("GOOGLE_VERTEX_ACCESS_TOKEN")?,
            "project_id": required("GOOGLE_PROJECT_ID")?,
            "region": required("GOOGLE_REGION")?,
            "model": model,
        }),
    )?;
    let output = client.chat(json!({
        "chat_prompt": [{"role": "user", "content": "Reply with the word ready."}]
    }))?;
    println!("{}", serde_json::to_string_pretty(&output)?);
    Ok(())
}
