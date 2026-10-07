// ax-example:start
// title: Rust OpenAI Native Decisions
// group: generation
// description: Uses ordered predicate, choice, and score questions with explicit rubrics and raw probabilities.
// provider: openai-decisions
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: advanced
// order: 45
// ax-example:end
use axllm::{openai_decisions, AxResult};
use serde_json::json;
use std::env;
fn main() -> AxResult<()> {
 let mut client = openai_decisions(json!({"api_key": env::var("OPENAI_API_KEY").or_else(|_| env::var("OPENAI_APIKEY")).expect("Set OPENAI_API_KEY or OPENAI_APIKEY")}))?;
 let response = client.create(serde_json::from_str(r#"{"input": "Checkout is unavailable for all customers after the latest deployment.", "questions": [{"type": "predicate", "name": "urgent", "instructions": "Are customers unable to complete a core task?"}, {"type": "choice", "name": "team", "instructions": "Who should handle the ticket?", "choices": [{"value": "support", "description": "Usage guidance"}, {"value": "billing", "description": "Invoices and payments"}, {"value": "engineering", "description": "Product failures"}]}, {"type": "score", "name": "severity", "instructions": "Rate customer impact", "levels": [{"label": "Minor inconvenience"}, {"label": "One task blocked"}, {"label": "Core task unavailable"}, {"label": "Widespread outage"}]}]}"#)?)?;
 // Handle per-question refusals before using probability, choice, or score.
 assert_eq!(response["answers"].as_array().unwrap().len(), 3);
 println!("{}", serde_json::to_string_pretty(&response)?);
 Ok(())
}
