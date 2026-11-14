// ax-example:start
// title: Rust Anthropic Document Citations
// group: generation
// description: Preserve source locations and output passages through ordinary and streaming generation.
// provider: anthropic
// env: ANTHROPIC_API_KEY, ANTHROPIC_APIKEY
// level: intermediate
// order: 48
// ax-example:end
use axllm::{ax, AxResult};
use serde_json::json;
use std::env;

fn main() -> AxResult<()> {
    let key = env::var("ANTHROPIC_API_KEY").or_else(|_| env::var("ANTHROPIC_APIKEY"))
        .map_err(|_| axllm::AxError::runtime("Set ANTHROPIC_API_KEY."))?;
    let mut client = axllm::ai("anthropic", json!({"api_key": key, "model": "claude-haiku-5-5"}))?;
    for stream in [false, true] {
        let mut program = ax(r#"doc:file -> answer:string "State the opening year and closed day, citing the supplied document.""#)?;
        let answer = program.forward_with_options(&mut client, json!({"doc": {
            "source": {"type": "text", "data": "The museum opened in 1984. It is closed on Mondays."},
            "title": "Museum notes", "citations": {"enabled": true}
        }}), json!({"stream": stream}))?;
        let log = program.get_chat_log();
        println!("{}", serde_json::to_string_pretty(&json!({"stream": stream, "answer": answer,
            "text_blocks": log.last().map(|entry| &entry["text_blocks"])}))?);
    }
    Ok(())
}
