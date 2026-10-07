// ax-example:start
// title: Rust OpenAI Signature Decisions
// group: generation
// description: Converts OpenAI probabilities into boolean and class outputs with a provider threshold.
// provider: openai-decisions
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: beginner
// order: 44
// ax-example:end
use axllm::{ai, ax, AxResult};
use serde_json::json;
use std::env;

fn main() -> AxResult<()> {
    let mut model = ai(
        "openai-decisions",
        json!({"api_key":env::var("OPENAI_API_KEY").or_else(|_| env::var("OPENAI_APIKEY")).expect("Set OPENAI_API_KEY or OPENAI_APIKEY"),"trueThreshold":0.9}),
    )?;
    let decision = ax("ticket:string -> urgent:boolean(true \"Customers cannot complete a core task\", false \"Routine request\") \"Needs immediate attention?\", team:class \"support, billing, engineering\"")?.forward(&mut model,json!({"ticket":"Checkout is unavailable for all customers after the latest deployment."}))?;
    assert!(decision["urgent"].is_boolean());
    let output = decision;
    println!("{}", serde_json::to_string_pretty(&output)?);
    Ok(())
}
