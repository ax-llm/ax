// ax-example:start
// title: Rust Composed Flow
// group: flows
// description: Composes multiple typed programs into one OpenAI-backed flow.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: advanced
// order: 30
// ax-example:end
use axllm::{ax, flow, AxResult, OpenAICompatibleClient};
use serde_json::json;
use std::env;


fn openai_client() -> AxResult<OpenAICompatibleClient> {
    let api_key = env::var("OPENAI_API_KEY").or_else(|_| env::var("OPENAI_APIKEY")).map_err(|_| axllm::AxError::runtime("Set OPENAI_API_KEY or OPENAI_APIKEY to run this example."))?;
    let model = env::var("AX_OPENAI_MODEL").unwrap_or_else(|_| "gpt-4.1-mini".to_string());
    Ok(OpenAICompatibleClient::new(api_key, model).with_model_config(json!({"temperature": 0})))
}

fn main() -> AxResult<()> {
    let mut client = openai_client()?;
    let step = ax("topic:string -> outline:string[]")?;
    let mut program = axllm::flow("examples.composedFlow").execute("step", step).returns(json!({"step": "step"}));
    let output = program.forward(&mut client, json!({"topic": "How Ax moves from typed generation to agents, flows, and optimization"}))?;
    println!("{}", serde_json::to_string_pretty(&output)?);
    Ok(())
}
