// ax-example:start
// title: Rust Jev Signature Decisions
// group: generation
// description: Converts Jev probabilities into boolean and class outputs with a provider threshold.
// provider: typesafe
// env: TYPESAFE_APIKEY
// level: beginner
// order: 35
// ax-example:end
use axllm::{ai, ax, AxResult};
use serde_json::json;
use std::env;

fn main() -> AxResult<()> {
    let mut model = ai(
        "typesafe",
        json!({"api_key":env::var("TYPESAFE_APIKEY").expect("Set TYPESAFE_APIKEY"),"trueThreshold":0.9}),
    )?;
    let decision = ax("ticket:string -> urgent:boolean(true \"Customers cannot complete a core task\", false \"Routine request\") \"Needs immediate attention?\", team:class \"support, billing, engineering\"")?.forward(&mut model,json!({"ticket":"Checkout is unavailable for all customers after the latest deployment."}))?;
    assert!(decision["urgent"].is_boolean());
    let output = decision;
    println!("{}", serde_json::to_string_pretty(&output)?);
    Ok(())
}
