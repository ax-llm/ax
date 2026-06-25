// ax-example:start
// title: Rust Typed Generation
// group: generation
// description: Runs a small typed generation program against OpenAI.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: beginner
// order: 10
// story: 10
// ax-example:end
use axllm::{ax, AxResult, OpenAICompatibleClient};
use serde_json::json;
use std::env;


fn openai_client() -> AxResult<OpenAICompatibleClient> {
    let api_key = env::var("OPENAI_API_KEY").or_else(|_| env::var("OPENAI_APIKEY")).map_err(|_| axllm::AxError::runtime("Set OPENAI_API_KEY or OPENAI_APIKEY to run this example."))?;
    let model = env::var("AX_OPENAI_MODEL").unwrap_or_else(|_| "gpt-5.4-mini".to_string());
    Ok(OpenAICompatibleClient::new(api_key, model).with_model_config(json!({"temperature": 0})))
}

fn main() -> AxResult<()> {
    let mut client = openai_client()?;
    let mut program = ax("question:string -> answer:string")?;
    let output = program.forward(&mut client, json!({"question": "In one sentence, explain Ax as a language-agnostic LLM programming library."}))?;
    println!("{}", serde_json::to_string_pretty(&output)?);
    Ok(())
}
