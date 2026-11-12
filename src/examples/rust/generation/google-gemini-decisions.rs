// ax-example:start
// title: Rust Google Gemini Decision Evidence
// group: generation
// description: Classify a support ticket through signatures with native decision evidence.
// provider: google-gemini-decisions
// env: GEMINI_API_KEY, GOOGLE_API_KEY, GOOGLE_APIKEY
// level: intermediate
// order: 47
// ax-example:end
use axllm::{ai, ax, AxResult};
use serde_json::json;
use std::env;
fn main() -> AxResult<()> {
  let key = env::var("GEMINI_API_KEY").or_else(|_| env::var("GOOGLE_API_KEY")).or_else(|_| env::var("GOOGLE_APIKEY")).expect("Set a Google API key.");
  let mut model = ai("google-gemini-decisions", json!({"api_key": key}))?;
  let result = ax(r#"ticket:string -> urgent:boolean(evidence, threshold 0.9) "Does a core task fail for all customers?", team:class "support, billing, engineering"(evidence) "Which team should investigate?", severity:score "Minor inconvenience, Feature impaired, Core task blocked"(evidence) "How severe is the customer impact?""#)?.forward(&mut model, json!({"ticket": "Checkout is unavailable for all customers after the latest deployment."}))?;
  println!("{}", serde_json::to_string_pretty(&result)?);
  Ok(())
}
