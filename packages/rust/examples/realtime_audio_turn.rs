// Drive a realtime audio TURN through the productized realtime_chat driver using
// ScriptedRealtimeTransport: the deterministic, credential-free path that
// exercises the full send-setup -> send-input -> fold -> merge loop without a
// live socket (the live socket path is verified separately against the real
// API). Exits non-zero on any mismatch so `axir verify` fails if it regresses.

use axllm::{ai, AxResult, RealtimeTransport, ScriptedRealtimeTransport};
use serde_json::{json, Value};

fn fail(message: &str, detail: &Value) -> ! {
    println!("realtime-audio-turn FAIL: {message} {detail}");
    std::process::exit(1);
}

fn main() -> AxResult<()> {
    let client = ai(
        "grok",
        json!({"api_key": "test-key", "model": "grok-voice-think-fast-1.0"}),
    )?;
    let request = json!({
        "model": "grok-voice-think-fast-1.0",
        "chat_prompt": [
            {"role": "system", "content": "You are a concise voice agent."},
            {"role": "user", "content": "Say hello."}
        ],
        "audio": {"output": {"voice": "eve"}}
    });
    // Canned server frames: session handshake, two transcript deltas, an audio
    // delta, then the terminal response.done.
    let inbound = vec![
        json!({"type": "session.created"}),
        json!({"type": "session.updated"}),
        json!({"type": "response.output_audio_transcript.delta", "response_id": "rt", "delta": "hel"}),
        json!({"type": "response.output_audio_transcript.delta", "response_id": "rt", "delta": "lo"}),
        json!({"type": "response.output_audio.delta", "response_id": "rt", "delta": "AQI="}),
        json!({"type": "response.done", "response": {"id": "rt", "usage": {"input_tokens": 3, "output_tokens": 2, "total_tokens": 5}}}),
    ];

    let transport = RealtimeTransport::Scripted(ScriptedRealtimeTransport::new(inbound));
    let final_response = client.realtime_chat(request, Some(transport))?;
    println!("merged result: {final_response}");
    let result = &final_response["results"][0];

    // Transcript deltas concatenated, audio chunk surfaced, turn finished.
    if result.get("content").and_then(|c| c.as_str()) != Some("hello") {
        fail("transcript not concatenated", &final_response);
    }
    if result.get("finish_reason").and_then(|f| f.as_str()) != Some("stop") {
        fail("turn did not finish", &final_response);
    }
    if result
        .get("audio")
        .and_then(|a| a.get("data"))
        .and_then(|d| d.as_str())
        != Some("AQI=")
    {
        fail("audio chunk not surfaced", &final_response);
    }
    println!("realtime-audio-turn-ok");
    Ok(())
}
