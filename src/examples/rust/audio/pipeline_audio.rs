// ax-example:start
// title: Rust Audio Summary Pipeline
// group: audio
// description: Transcribes audio and summarizes the transcript with an OpenAI-backed generator.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: advanced
// order: 30
// ax-example:end
use axllm::{ax, AxAIClient, AxResult, OpenAICompatibleClient};
use serde_json::json;
use std::{env, fs};


fn openai_client() -> AxResult<OpenAICompatibleClient> {
    let api_key = env::var("OPENAI_API_KEY").or_else(|_| env::var("OPENAI_APIKEY")).map_err(|_| axllm::AxError::runtime("Set OPENAI_API_KEY or OPENAI_APIKEY to run this example."))?;
    let model = env::var("AX_OPENAI_MODEL").unwrap_or_else(|_| "gpt-4.1-mini".to_string());
    Ok(OpenAICompatibleClient::new(api_key, model).with_model_config(json!({"temperature": 0})))
}

fn main() -> AxResult<()> {
    let mut client = openai_client()?;
    let wav = fs::read("src/examples/assets/presentation.wav").map_err(|err| axllm::AxError::runtime(err.to_string()))?;
    let transcript = client.transcribe(json!({"audio": String::from_utf8_lossy(&wav).to_string(), "language": "en", "model": "gpt-4o-mini-transcribe", "format": "json"}))?;
    let mut summarize = ax("transcript:string -> summary:string, followUps:string[]")?;
    let result = summarize.forward(&mut client, json!({"transcript": transcript["text"]}))?;
    println!("{}", serde_json::to_string_pretty(&json!({"transcript": transcript["text"], "result": result}))?);
    Ok(())
}
