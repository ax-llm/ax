// ax-example:start
// title: Rust Tool Result Formatting
// group: generation
// description: Formats a structured inventory tool result as concise text for the model.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: intermediate
// order: 48
// ax-example:end
use axllm::{ai, ax, tool, AxResult};
use serde_json::json;
use std::env;

fn main() -> AxResult<()> {
    let key = env::var("OPENAI_API_KEY")
        .or_else(|_| env::var("OPENAI_APIKEY"))
        .expect("Set OPENAI_API_KEY or OPENAI_APIKEY.");
    let model = env::var("AX_OPENAI_MODEL").unwrap_or_else(|_| "gpt-6-luna".into());
    let mut client = ai("openai", json!({"api_key":key, "model":model}))?;
    let inventory = tool("inventory")
        .description("Read the current stock count.")
        .handler(|_| Ok(json!({"available":12, "warehouse":"A"})));
    // The model receives this text; tool traces retain the original object.
    let mut program = ax("question:string -> answer:string")?
        .with_tool(inventory)
        .with_function_result_formatter(|result| {
            Ok(format!("{} units available", result["available"]))
        });
    let result = program.forward(
        &mut client,
        json!({"question":"Call inventory and report how many units are available."}),
    )?;
    println!("{}", result["answer"].as_str().unwrap_or_default());
    Ok(())
}
