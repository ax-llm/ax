// ax-example:start
// title: Rust Speech To Text
// group: audio
// description: Transcribes a checked-in WAV file through OpenAI.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: intermediate
// order: 20
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
    println!("{}", serde_json::to_string_pretty(&transcript)?);
    Ok(())
}
