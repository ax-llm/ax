// ax-example:start
// title: Rust AxGen Optimization
// group: optimization
// description: Runs a baseline OpenAI prediction and applies an optimizer artifact.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: beginner
// order: 10
// story: 50
// ax-example:end
use axllm::{ax, AxResult, OpenAICompatibleClient, OptimizerEngine};
use serde_json::{json, Value};
use std::env;

struct ExampleOptimizer;
impl OptimizerEngine for ExampleOptimizer {
    fn optimize(&mut self, _request: Value, _evaluator: &mut dyn FnMut(Value) -> AxResult<Value>) -> AxResult<Value> {
        Ok(json!({"componentMap": {"priority::instruction": "Classify operational risk. Use high for production-impacting urgency."}, "metadata": {"source": "axgen"}}))
    }
}

fn openai_client() -> AxResult<OpenAICompatibleClient> {
    let api_key = env::var("OPENAI_API_KEY").or_else(|_| env::var("OPENAI_APIKEY")).map_err(|_| axllm::AxError::runtime("Set OPENAI_API_KEY or OPENAI_APIKEY to run this example."))?;
    let model = env::var("AX_OPENAI_MODEL").unwrap_or_else(|_| "gpt-5.4-mini".to_string());
    Ok(OpenAICompatibleClient::new(api_key, model).with_model_config(json!({"temperature": 0})))
}

fn main() -> AxResult<()> {
    let mut client = openai_client()?;
    let mut program = ax("emailText:string -> priority:class \"high, normal, low\", rationale:string")?;
    let baseline = program.forward(&mut client, json!({"emailText": "Production checkout is failing for enterprise customers."}))?;
    let mut optimizer = ExampleOptimizer;
    let artifact = optimizer.optimize(json!({"candidate": "priority"}), &mut |_candidate| Ok(json!({"score": 1.0})))?;
    println!("{}", serde_json::to_string_pretty(&json!({"baseline": baseline, "artifact": artifact}))?);
    Ok(())
}
