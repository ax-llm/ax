// ax-example:start
// title: Rust Structured Extraction
// group: generation
// description: Extracts structured fields and labels from support text with OpenAI.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: intermediate
// order: 20
// ax-example:end
use axllm::{ax, AxResult, OpenAICompatibleClient};
use serde_json::json;
use std::env;


fn openai_client() -> AxResult<OpenAICompatibleClient> {
    let api_key = env::var("OPENAI_API_KEY").or_else(|_| env::var("OPENAI_APIKEY")).map_err(|_| axllm::AxError::runtime("Set OPENAI_API_KEY or OPENAI_APIKEY to run this example."))?;
    let model = env::var("AX_OPENAI_MODEL").unwrap_or_else(|_| "gpt-4.1-mini".to_string());
    Ok(OpenAICompatibleClient::new(api_key, model).with_model_config(json!({"temperature": 0})))
}

fn main() -> AxResult<()> {
    let mut client = openai_client()?;
    let mut program = ax("ticket:string -> priority:class \"high, normal, low\", summary:string, labels:string[]")?;
    let output = program.forward(&mut client, json!({"ticket": "Checkout has failed for enterprise customers since 09:00. Support wants a concise summary and tags."}))?;
    println!("{}", serde_json::to_string_pretty(&output)?);
    Ok(())
}
