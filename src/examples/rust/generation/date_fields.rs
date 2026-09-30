// ax-example:start
// title: Rust Date Fields
// group: generation
// description: Parses date, datetime and range outputs into ISO 8601 by default as TypeScript does; named zones read the platform tz database.
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
    let model = env::var("AX_OPENAI_MODEL").unwrap_or_else(|_| "gpt-6-luna".to_string());
    let mut client = ai("openai", json!({"api_key": api_key, "model": model}))?;

    // Date outputs parse by default; set parseDates (or parse_dates) to false to keep text.
    let mut planner = ax(
        r#"emailText:string, sentAt:datetime -> meetingStartsAt:datetime "Start time with its time zone", meetingDay:date, travelWindow:dateRange "First and last day away""#,
    )?;
    let out = planner.forward_with_options(
        &mut client,
        json!({
            "emailText": "Can we meet next Tuesday at 3pm New York time? I'm travelling from the 8th to the 12th.",
            "sentAt": "2024-05-02T16:30:00Z",
        }),
        json!({}),
    )?;
    println!("{}", out["meetingStartsAt"]); // e.g. "2024-05-07T19:00:00.000Z"
    println!("{}", out["meetingDay"]); // e.g. "2024-05-07T00:00:00.000Z"
    println!("{}", out["travelWindow"]); // {"start":"2024-05-08T00:00:00.000Z","end":...}
    Ok(())
}
