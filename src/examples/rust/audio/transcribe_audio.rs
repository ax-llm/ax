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


// transcribe() expects the audio as a base64 string (same contract as the
// TypeScript/Python/Go/Java examples). Rust's std has no base64, so encode here.
fn b64encode(input: &[u8]) -> String {
    const T: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for chunk in input.chunks(3) {
        let b0 = chunk[0];
        let b1 = *chunk.get(1).unwrap_or(&0);
        let b2 = *chunk.get(2).unwrap_or(&0);
        out.push(T[(b0 >> 2) as usize] as char);
        out.push(T[(((b0 & 0x03) << 4) | (b1 >> 4)) as usize] as char);
        out.push(if chunk.len() > 1 { T[(((b1 & 0x0f) << 2) | (b2 >> 6)) as usize] as char } else { '=' });
        out.push(if chunk.len() > 2 { T[(b2 & 0x3f) as usize] as char } else { '=' });
    }
    out
}

fn openai_client() -> AxResult<OpenAICompatibleClient> {
    let api_key = env::var("OPENAI_API_KEY").or_else(|_| env::var("OPENAI_APIKEY")).map_err(|_| axllm::AxError::runtime("Set OPENAI_API_KEY or OPENAI_APIKEY to run this example."))?;
    let model = env::var("AX_OPENAI_MODEL").unwrap_or_else(|_| "gpt-5.4-mini".to_string());
    Ok(OpenAICompatibleClient::new(api_key, model).with_model_config(json!({"temperature": 0})))
}

fn main() -> AxResult<()> {
    let mut client = openai_client()?;
    let wav = fs::read("src/examples/assets/presentation.wav").map_err(|err| axllm::AxError::runtime(err.to_string()))?;
    let transcript = client.transcribe(json!({"audio": b64encode(&wav), "language": "en", "model": "gpt-4o-mini-transcribe", "format": "json"}))?;
    println!("{}", serde_json::to_string_pretty(&transcript)?);
    Ok(())
}
