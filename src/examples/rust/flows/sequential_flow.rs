// ax-example:start
// title: Rust Sequential Flow
// group: flows
// description: Runs a two-step Ax flow against OpenAI.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: beginner
// order: 10
// story: 30
// ax-example:end
use axllm::{ax, flow, AxResult, OpenAICompatibleClient};
use serde_json::json;
use std::env;


fn openai_client() -> AxResult<OpenAICompatibleClient> {
    let api_key = env::var("OPENAI_API_KEY").or_else(|_| env::var("OPENAI_APIKEY")).map_err(|_| axllm::AxError::runtime("Set OPENAI_API_KEY or OPENAI_APIKEY to run this example."))?;
    let model = env::var("AX_OPENAI_MODEL").unwrap_or_else(|_| "gpt-5.4-mini".to_string());
    Ok(OpenAICompatibleClient::new(api_key, model).with_model_config(json!({"temperature": 0})))
}

fn main() -> AxResult<()> {
    let mut client = openai_client()?;
    let step = ax("documentText:string -> summaryText:string")?;
    let mut program = axllm::flow("examples.sequentialFlow").execute("step", step).returns(json!({"step": "step"}));
    let output = program.forward(&mut client, json!({"documentText": "Ax gives developers signatures, provider clients, agents, flows, tracing, and optimization."}))?;
    println!("{}", serde_json::to_string_pretty(&output)?);
    Ok(())
}
