use axllm::{ai, AxResult};
use serde_json::json;

fn main() -> AxResult<()> {
    let grok = ai("grok", json!({
        "api_key": "test-key",
        "model": "grok-voice-think-fast-1.0"
    }))?;
    let grok_request = json!({
        "model": "grok-voice-think-fast-1.0",
        "chat_prompt": [
            {"role": "system", "content": "You are a concise voice agent."},
            {"role": "user", "content": "Say hello."}
        ],
        "audio": {
            "input": {"sampleRate": 24000},
            "output": {"sampleRate": 24000, "voice": "eve"}
        }
    });
    let grok_events = json!([
        {"type": "response.output_audio_transcript.delta", "response_id": "grok_rt", "delta": "hello "},
        {"type": "response.output_audio.delta", "response_id": "grok_rt", "delta": "AQI="},
        {
            "type": "response.done",
            "response": {
                "id": "grok_rt",
                "usage": {"input_tokens": 3, "output_tokens": 2, "total_tokens": 5}
            }
        }
    ]);

    let gemini = ai("google-gemini", json!({
        "api_key": "test-key",
        "model": "gemini-2.5-flash-native-audio-preview-12-2025"
    }))?;
    let gemini_request = json!({
        "model": "gemini-2.5-flash-native-audio-preview-12-2025",
        "chat_prompt": [
            {"role": "system", "content": "Answer with audio."},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "Realtime question"},
                    {"type": "audio", "data": "AAAA", "format": "pcm16", "sampleRate": 16000}
                ]
            }
        ],
        "audio": {"output": {"transcript": true, "voice": "Kore"}}
    });
    let gemini_events = json!([
        {"id": "gemini_live_1", "serverContent": {"outputTranscription": {"text": "spoken "}}},
        {
            "id": "gemini_live_2",
            "serverContent": {
                "modelTurn": {
                    "parts": [{"inlineData": {"data": "AQI=", "mimeType": "audio/pcm"}}]
                }
            }
        },
        {
            "id": "gemini_live_3",
            "toolCall": {"functionCalls": [{"name": "lookup", "args": {"q": "ax"}}]}
        },
        {
            "id": "gemini_live_done",
            "serverContent": {"turnComplete": true},
            "usageMetadata": {"promptTokenCount": 3, "candidatesTokenCount": 4, "totalTokenCount": 7}
        }
    ]);

    let output = json!({
        "grokSetup": grok.realtime_audio_setup(grok_request)?,
        "grokEvents": grok.realtime_events(grok_events)?,
        "geminiSetup": gemini.realtime_audio_setup(gemini_request.clone())?,
        "geminiInput": gemini.realtime_audio_input(gemini_request)?,
        "geminiEvents": gemini.realtime_events(gemini_events)?
    });
    println!("{}", serde_json::to_string_pretty(&output)?);
    Ok(())
}
