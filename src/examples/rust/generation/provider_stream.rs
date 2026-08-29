// ax-example:start
// title: Rust Incremental Provider Stream
// group: generation
// description: Iterates OpenAI SSE events incrementally; dropping the iterator closes the response.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: intermediate
// order: 45
// ax-example:end
use axllm::{ai, AxAIClient, AxResult};
use serde_json::json;
use std::{env, time::Instant};

fn main() -> AxResult<()> {
    let api_key = env::var("OPENAI_API_KEY")
        .or_else(|_| env::var("OPENAI_APIKEY"))
        .map_err(|_| {
            axllm::AxError::runtime("Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.")
        })?;
    let model = env::var("AX_OPENAI_MODEL").unwrap_or_else(|_| "gpt-5.6-luna".to_string());
    let mut client = ai(
        "openai",
        json!({"api_key": api_key, "model": model}),
    )?;
    let started = Instant::now();
    for event in client.stream_iter(json!({
        "chat_prompt": [{"role": "user", "content": "Reply with exactly: streaming works"}],
        "model_config": {"temperature": 1}
    }))? {
        let event = event?;
        if let Some(content) = event["results"][0]["content"]
            .as_str()
            .filter(|value| !value.is_empty())
        {
            print!("[{} ms] {content}", started.elapsed().as_millis());
        }
    }
    println!();
    Ok(())
}
