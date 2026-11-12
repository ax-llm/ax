// ax-example:start
// title: Rust Native Google Gemini Decisions
// group: generation
// description: Evaluate named yes/no, choice and score questions with native probabilities and confidence.
// provider: google-gemini-decisions
// env: GEMINI_API_KEY, GOOGLE_API_KEY, GOOGLE_APIKEY
// level: intermediate
// order: 48
// ax-example:end
use axllm::{google_gemini_decisions, AxResult};
use serde_json::json;
use std::env;
fn main() -> AxResult<()> {
  let key = env::var("GEMINI_API_KEY").or_else(|_| env::var("GOOGLE_API_KEY")).or_else(|_| env::var("GOOGLE_APIKEY")).expect("Set a Google API key.");
  let mut client = google_gemini_decisions(json!({"api_key": key}))?;
  let result = client.create(serde_json::from_str(r#"{"input": "Checkout is unavailable for all customers after the latest deployment.", "questions": {"urgent": {"type": "noul", "instructions": "Are customers unable to complete a core task?"}, "team": {"type": "choice", "instructions": "Which team should investigate?", "criteria": {"support": "Usage guidance", "billing": "Individual invoice disputes", "engineering": "Broken functionality or service outages"}}, "severity": {"type": "score", "instructions": "How severe is the customer impact?", "criteria": ["Minor inconvenience", "Feature impaired", "Core task blocked"]}}}"#)?)?;
  println!("{}", serde_json::to_string_pretty(&result)?);
  Ok(())
}
