// ax-example:start
// title: Rust Text To Speech
// group: audio
// description: Generates speech audio through OpenAI.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: beginner
// order: 10
// story: 40
// ax-example:end
use axllm::{ax, AxAIClient, AxResult, OpenAICompatibleClient};
use serde_json::json;
use std::{env, fs};


fn openai_client() -> AxResult<OpenAICompatibleClient> {
    let api_key = env::var("OPENAI_API_KEY").or_else(|_| env::var("OPENAI_APIKEY")).map_err(|_| axllm::AxError::runtime("Set OPENAI_API_KEY or OPENAI_APIKEY to run this example."))?;
    let model = env::var("AX_OPENAI_MODEL").unwrap_or_else(|_| "gpt-4.1-mini".to_string());
    Ok(OpenAICompatibleClient::new(api_key, model).with_model_config(json!({"temperature": 0})))
}

fn main() -> AxResult<()> {
    let mut client = openai_client()?;
    let speech = client.speak(json!({"text": "Ax turns LLM prompts into typed programs.", "voice": "alloy", "format": "mp3"}))?;
    println!("{}", serde_json::to_string_pretty(&speech)?);
    Ok(())
}
