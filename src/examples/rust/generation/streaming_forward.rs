// ax-example:start
// title: Rust Streaming Field Deltas
// group: generation
// description: Streams AxGen output as TypeScript-style {version, index, delta} field deltas and merges them as they arrive.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: intermediate
// order: 46
// ax-example:end
use axllm::{ai, ax, AxResult};
use serde_json::{json, Map, Value};
use std::cell::RefCell;
use std::env;
use std::io::Write;
use std::rc::Rc;

fn main() -> AxResult<()> {
    let api_key = env::var("OPENAI_API_KEY")
        .or_else(|_| env::var("OPENAI_APIKEY"))
        .map_err(|_| {
            axllm::AxError::runtime("Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.")
        })?;
    let model = env::var("AX_OPENAI_MODEL").unwrap_or_else(|_| "gpt-5.4-mini".to_string());
    let mut client = ai("openai", json!({"api_key": api_key, "model": model}))?;
    let mut story = ax(r#"topic:string -> title:string, story:string "Three short sentences""#)?;

    // Each delta holds the new text of one field. Merge a sample's deltas
    // (strings and arrays append, other values replace) and start over when
    // the version changes: a retry or a replaced step starts a new version.
    let merged = Rc::new(RefCell::new(Map::new()));
    let view = merged.clone();
    let mut version = 0;
    story.streaming_forward(
        &mut client,
        json!({"topic": "a lighthouse keeper's cat"}),
        json!({}),
        move |update| {
            let mut merged = view.borrow_mut();
            if update.version != version {
                merged.clear();
                version = update.version;
                println!("\n[retry: starting over]");
            }
            for (field, value) in update.delta.as_object().into_iter().flatten() {
                match (merged.get_mut(field), value) {
                    (Some(Value::String(text)), Value::String(more)) => text.push_str(more),
                    (Some(Value::Array(items)), Value::Array(more)) => {
                        items.extend(more.iter().cloned())
                    }
                    _ => {
                        merged.insert(field.clone(), value.clone());
                    }
                }
                if let (true, Some(text)) = (field == "story", value.as_str()) {
                    print!("{text}");
                    std::io::stdout().flush()?;
                }
            }
            Ok(())
        },
    )?;
    let title = merged.borrow().get("title").cloned().unwrap_or(Value::Null);
    println!("\nTitle: {}", title.as_str().unwrap_or_default());
    Ok(())
}
