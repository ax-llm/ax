// ax-example:start
// title: Rust Contextual Generation
// group: generation
// description: Answers from supplied context and returns compact citations with OpenAI.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: advanced
// order: 30
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
    let mut program = ax("context:string, question:string -> answer:string, citations:string[]")?;
    let output = program.forward(&mut client, json!({"context": "Ax uses signatures, ai(), ax(), agent(), flow(), and optimize().", "question": "How should a new developer think about Ax?"}))?;
    println!("{}", serde_json::to_string_pretty(&output)?);
    Ok(())
}
