// ax-example:start
// title: Rust Jev Hybrid Reply
// group: generation
// description: Passes Jev decisions to a second Ax program to generate a customer reply.
// provider: typesafe, openai
// env: TYPESAFE_APIKEY, OPENAI_APIKEY, OPENAI_API_KEY
// level: intermediate
// order: 37
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
    let key = env::var("OPENAI_API_KEY")
        .or_else(|_| env::var("OPENAI_APIKEY"))
        .expect("Set OPENAI_APIKEY");
    let mut writer = ai(
        "openai",
        json!({"api_key":key,"model":"gpt-5.6-luna","model_config":{"temperature":1}}),
    )?;
    let reply = ax("ticket:string, urgent:boolean, team:string -> reply:string")?.forward(&mut writer,json!({"ticket":"Checkout is unavailable for all customers after the latest deployment.","urgent":decision["urgent"],"team":decision["team"]}))?;
    assert!(!reply["reply"].as_str().unwrap().trim().is_empty());
    let output = json!({"decision":decision,"reply":reply});
    println!("{}", serde_json::to_string_pretty(&output)?);
    Ok(())
}
