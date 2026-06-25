// ax-example:start
// title: Rust GEPA Optimization
// group: optimization
// description: Pairs a real OpenAI baseline with a local GEPA optimization pass.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: intermediate
// order: 20
// ax-example:end
use axllm::{ax, AxResult, OpenAICompatibleClient, OptimizerEngine};
use serde_json::{json, Value};
use std::env;


fn openai_client() -> AxResult<OpenAICompatibleClient> {
    let api_key = env::var("OPENAI_API_KEY").or_else(|_| env::var("OPENAI_APIKEY")).map_err(|_| axllm::AxError::runtime("Set OPENAI_API_KEY or OPENAI_APIKEY to run this example."))?;
    let model = env::var("AX_OPENAI_MODEL").unwrap_or_else(|_| "gpt-5.4-mini".to_string());
    Ok(OpenAICompatibleClient::new(api_key, model).with_model_config(json!({"temperature": 0})))
}

fn main() -> AxResult<()> {
    let mut client = openai_client()?;
    let mut program = ax("emailText:string -> priority:class \"high, normal, low\", rationale:string")?;
    let baseline = program.forward(&mut client, json!({"emailText": "Production checkout is failing for enterprise customers."}))?;
    let mut engine = axllm::AxGEPA::new();
    let artifact = engine.optimize(json!({"candidate": {"priority::instruction": "Classify priority clearly."}, "dataset": {"train": [{"emailText": "URGENT: checkout is down"}]}, "options": {"numTrials": 0, "maxMetricCalls": 4, "seed": 7}}), &mut |_candidate| Ok(json!({"rows": [{"prediction": {"answer": "Ax composes typed LLM programs."}, "scores": {"quality": 0.9}, "scalar": 0.9}], "avg": 0.9, "count": 1})))?;
    println!("{}", serde_json::to_string_pretty(&json!({"baseline": baseline, "artifact": artifact}))?);
    Ok(())
}
