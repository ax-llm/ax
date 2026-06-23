use axllm::{ai, AxResult};
use serde_json::json;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

// Drive transcribe()/speak() through the REAL reqwest transport against an
// in-process loopback server, exercising the wire-level encoders the
// conformance ScriptedTransport bypasses: the multipart/form-data request body
// (transcribe) and binary (non-UTF8) response handling (speak). Panics on any
// mismatch so `axir verify` fails if either regresses.

fn find_subsequence(haystack: &[u8], needle: &[u8]) -> bool {
    if needle.is_empty() {
        return true;
    }
    haystack
        .windows(needle.len())
        .any(|window| window == needle)
}

fn read_request(stream: &mut TcpStream) -> (String, String, Vec<u8>) {
    stream.set_read_timeout(Some(Duration::from_secs(5))).ok();
    let mut buf: Vec<u8> = Vec::new();
    let mut tmp = [0u8; 4096];
    let header_end = loop {
        if let Some(pos) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            break pos + 4;
        }
        let n = stream.read(&mut tmp).unwrap_or(0);
        if n == 0 {
            break buf.len();
        }
        buf.extend_from_slice(&tmp[..n]);
    };
    let header_text = String::from_utf8_lossy(&buf[..header_end]).to_string();
    let request_line = header_text.lines().next().unwrap_or("").to_string();
    let mut content_type = String::new();
    let mut content_length = 0usize;
    for line in header_text.lines() {
        let lower = line.to_ascii_lowercase();
        if lower.starts_with("content-type:") {
            content_type = line.splitn(2, ':').nth(1).unwrap_or("").trim().to_string();
        } else if lower.starts_with("content-length:") {
            content_length = line
                .splitn(2, ':')
                .nth(1)
                .unwrap_or("")
                .trim()
                .parse()
                .unwrap_or(0);
        }
    }
    let mut body = buf[header_end..].to_vec();
    while body.len() < content_length {
        let n = stream.read(&mut tmp).unwrap_or(0);
        if n == 0 {
            break;
        }
        body.extend_from_slice(&tmp[..n]);
    }
    (request_line, content_type, body)
}

fn write_response(stream: &mut TcpStream, content_type: &str, body: &[u8]) {
    let header = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: {}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        content_type,
        body.len()
    );
    let _ = stream.write_all(header.as_bytes());
    let _ = stream.write_all(body);
    let _ = stream.flush();
}

fn main() -> AxResult<()> {
    // Deliberately non-UTF8 bytes so a UTF-8/JSON decode regression corrupts them.
    let audio_bytes: Vec<u8> = vec![0, 1, 2, 255, 254, 16, 127];
    let audio_b64 = "AAEC//4Qfw==";
    let speech_bytes: Vec<u8> = vec![255, 216, 255, 0, 17, 34, 254];
    let want_audio = "/9j/ABEi/g==";

    let listener = TcpListener::bind("127.0.0.1:0").expect("bind loopback");
    let port = listener.local_addr().unwrap().port();

    let audio_probe = audio_bytes.clone();
    let speech_resp = speech_bytes.clone();
    let (tx, rx) = mpsc::channel::<(bool, bool)>();
    thread::spawn(move || {
        let mut saw_multipart = false;
        let mut file_present = false;
        let mut handled = 0;
        for stream in listener.incoming() {
            let mut stream = match stream {
                Ok(s) => s,
                Err(_) => break,
            };
            let (request_line, content_type, body) = read_request(&mut stream);
            if request_line.contains("/audio/transcriptions") {
                saw_multipart = content_type.starts_with("multipart/form-data; boundary=");
                file_present = find_subsequence(&body, &audio_probe);
                write_response(
                    &mut stream,
                    "application/json",
                    b"{\"text\":\"hello world\",\"language\":\"en\",\"duration\":1.25}",
                );
            } else if request_line.contains("/audio/speech") {
                write_response(&mut stream, "audio/mpeg", &speech_resp);
            } else {
                write_response(&mut stream, "text/plain", b"");
            }
            handled += 1;
            if handled >= 2 {
                break;
            }
        }
        let _ = tx.send((saw_multipart, file_present));
    });

    // Set only base_url (the documented proxy/gateway knob) to prove the audio
    // transport honors it for transcribe()/speak(), not just chat/embed.
    let base = format!("http://127.0.0.1:{port}");
    let mut client = ai(
        "openai-responses",
        json!({"api_key": "test-key", "base_url": base}),
    )?;
    let transcript = client.transcribe(json!({
        "audio": audio_b64,
        "language": "en",
        "model": "gpt-4o-mini-transcribe",
        "format": "json"
    }))?;
    let speech = client.speak(json!({
        "text": "hello",
        "voice": "alloy",
        "format": "mp3",
        "model": "gpt-4o-mini-tts"
    }))?;

    let (saw_multipart, file_present) = rx.recv().expect("server result");
    assert!(
        saw_multipart,
        "loopback server never received a multipart transcribe request"
    );
    assert!(
        file_present,
        "multipart body did not contain the decoded file bytes"
    );
    assert!(
        transcript["text"] == "hello world",
        "transcribe response not normalized: {transcript}"
    );
    assert!(
        speech["audio"] == want_audio,
        "speak binary response not base64-encoded as expected: {speech}"
    );

    println!("audio-http-roundtrip-ok");
    Ok(())
}
