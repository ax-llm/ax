// ax-example:start
// title: Rust Field Processor Feedback
// group: generation
// description: Sends a field processor's note back to the model for another step, as TypeScript does, and trims the final answer with a field transform.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: intermediate
// order: 47
// ax-example:end
use axllm::{ai, ax, AxResult};
use serde_json::json;
use std::env;

fn main() -> AxResult<()> {
    let api_key = env::var("OPENAI_API_KEY")
        .or_else(|_| env::var("OPENAI_APIKEY"))
        .map_err(|_| {
            axllm::AxError::runtime("Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.")
        })?;
    let model = env::var("AX_OPENAI_MODEL").unwrap_or_else(|_| "gpt-5.4-mini".to_string());
    let mut client = ai("openai", json!({"api_key": api_key, "model": model}))?;
    let mut summarize =
        ax("text:string -> summary:string")?.with_field_transform("summary", "trim");

    // A Some(..) result goes back to the model as a user message, and the
    // next step's answer replaces this one.
    summarize.add_field_processor("summary", |value, _context| {
        let words = value
            .as_str()
            .unwrap_or_default()
            .split_whitespace()
            .count();
        Ok((words > 12).then(|| {
            json!(format!(
                "That summary has {words} words; answer again in at most 12 words."
            ))
        }))
    })?;

    let text = "The committee met on Tuesday to review the budget. After a long debate about \
        the new library wing, they approved the plan and asked staff to find a builder \
        who can start in spring, while keeping the reading room open during the work.";
    let output = summarize.forward(&mut client, json!({"text": text}))?;
    println!("{}", output["summary"].as_str().unwrap_or_default());
    Ok(())
}
