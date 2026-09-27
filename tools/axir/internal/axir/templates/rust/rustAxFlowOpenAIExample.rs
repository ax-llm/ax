use axllm::{ai, ax, flow, AxResult};
use serde_json::json;
use std::env;

fn main() -> AxResult<()> {
    let api_key = env::var("OPENAI_API_KEY")
        .or_else(|_| env::var("OPENAI_APIKEY"))
        .map_err(|_| axllm::AxError::runtime("Set OPENAI_API_KEY or OPENAI_APIKEY to run this provider API example."))?;
    let model = env::var("AX_OPENAI_MODEL").unwrap_or_else(|_| "gpt-5.4-mini".to_string());
    let mut client = ai("openai", json!({"api_key": api_key, "model": model, "model_config": {"temperature": 0}}))?;
    let outline = ax("topic:string -> outline:string")?;
    let mut program = flow("examples.openaiApiFlow")
        .execute("outline", outline)
        .returns(json!({"outline": "outline"}));
    let output = program.forward(&mut client, json!({"topic": "how Ax composes typed LLM programs"}))?;
    for key in ["outline"] {
        let value = &output[key];
        assert!(!value.is_null() && value != "" && *value != json!([]), "flow output field {key} is empty: {output}");
    }
    println!("{}", serde_json::to_string_pretty(&output)?);
    Ok(())
}
