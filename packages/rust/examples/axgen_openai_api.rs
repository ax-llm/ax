use axllm::{ax, AxResult, OpenAICompatibleClient};
use serde_json::json;
use std::env;

fn main() -> AxResult<()> {
    let api_key = env::var("OPENAI_API_KEY")
        .or_else(|_| env::var("OPENAI_APIKEY"))
        .map_err(|_| {
            axllm::AxError::runtime(
                "Set OPENAI_API_KEY or OPENAI_APIKEY to run this provider API example.",
            )
        })?;
    let model = env::var("AX_OPENAI_MODEL").unwrap_or_else(|_| "gpt-5.4-mini".to_string());
    let mut client =
        OpenAICompatibleClient::new(api_key, model).with_model_config(json!({"temperature": 0}));
    let mut program = ax("question:string -> answer:string")?;
    let output = program.forward(
        &mut client,
        json!({"question": "In one sentence, explain Ax as a language-agnostic LLM programming library."}),
    )?;
    println!("{}", serde_json::to_string_pretty(&output)?);
    Ok(())
}
