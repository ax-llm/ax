use axllm::{ai, AxResult, ScriptedTransport};
use serde_json::json;

fn main() -> AxResult<()> {
    let transport = ScriptedTransport::new(vec![
        json!({"status": 200, "json": {"audio": "base64-speech"}}),
        json!({"status": 200, "json": {"text": "hello world", "language": "en", "duration": 1.25}}),
    ]);
    let mut client =
        ai("openai-responses", json!({"api_key": "test-key"}))?.with_transport(transport);
    let speech = client.speak(json!({"text": "hello", "voice": "alloy", "format": "mp3"}))?;
    let transcript = client.transcribe(json!({
        "audio": "base64-audio",
        "language": "en",
        "model": "whisper-1",
        "format": "json"
    }))?;
    assert_eq!(speech["audio"], "base64-speech");
    assert_eq!(transcript["text"], "hello world");
    println!(
        "{}",
        serde_json::to_string_pretty(&json!({"speak": speech, "transcribe": transcript}))?
    );
    Ok(())
}
